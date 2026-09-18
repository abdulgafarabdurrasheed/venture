import { pool } from "./db.js";
import { STACK_LAUNCH_UTC } from "./hackatimeAuth.js";

const STACK_LAUNCH_TIMESTAMPTZ = STACK_LAUNCH_UTC.toISOString();
import { hasAirtableProjectsConfig, syncProjectToAirtable, persistProjectAirtableRecordId } from "./airtableProjects.js";
import { hasAirtableUsersConfig, syncPostgresUserToAirtable } from "./airtableUsers.js";
import {
  getOrdersAirtableConfigStatus,
  hasAirtableOrdersConfig,
  syncAllShopOrdersToAirtable,
} from "./airtableOrders.js";
import { getYswsAirtableConfigStatus, hasAirtableYswsConfig, syncAllYswsSubmissions } from "./airtableYsws.js";

const syncIntervalMs = Number(process.env.AIRTABLE_SYNC_INTERVAL_MS || 5 * 60 * 1000);

let syncTimer = null;
let syncInProgress = false;
let lastPeriodicSync = null;

export function getPeriodicAirtableSyncStatus() {
  return {
    intervalMs: syncIntervalMs,
    running: syncInProgress,
    lastSync: lastPeriodicSync,
    usersConfigured: hasAirtableUsersConfig,
    projectsConfigured: hasAirtableProjectsConfig,
    yswsConfigured: hasAirtableYswsConfig,
    ysws: getYswsAirtableConfigStatus(),
    ordersConfigured: hasAirtableOrdersConfig,
    orders: getOrdersAirtableConfigStatus(),
  };
}

export async function syncAllUsersAndProjectsToAirtable() {
  if (!pool) {
    return { ok: false, reason: "DATABASE_URL is not set." };
  }

  if (!hasAirtableUsersConfig && !hasAirtableProjectsConfig && !hasAirtableYswsConfig && !hasAirtableOrdersConfig) {
    return { ok: false, reason: "Airtable not configured." };
  }

  if (syncInProgress) {
    return { ok: false, reason: "Periodic sync already running." };
  }

  syncInProgress = true;
  const startedAt = new Date().toISOString();
  const result = {
    ok: true,
    startedAt,
    users: { synced: 0, failed: 0, skipped: 0 },
    projects: { synced: 0, failed: 0, skipped: 0 },
    ysws: { synced: 0, failed: 0, skippedProjects: 0, total: 0 },
    orders: { synced: 0, failed: 0, total: 0 },
  };

  try {
    if (hasAirtableUsersConfig) {
      const usersResult = await pool.query(`
        SELECT
          id,
          email,
          name,
          slug,
          slack_id,
          role,
          hackatime_total_hours,
          created_at
        FROM users
        WHERE email IS NOT NULL OR slack_id IS NOT NULL
        ORDER BY id ASC
      `);

      for (const row of usersResult.rows) {
        try {
          const syncResult = await syncPostgresUserToAirtable(row);
          if (syncResult.skipped) {
            result.users.skipped += 1;
          } else {
            result.users.synced += 1;
          }
        } catch (error) {
          result.users.failed += 1;
          console.error("[airtable] periodic user sync failed:", {
            userId: row.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (hasAirtableProjectsConfig) {
      const projectsResult = await pool.query(`
        SELECT
          projects.*,
          COALESCE(SUM(journal_entries.hours_worked), 0) AS journal_hours,
          users.email AS user_email,
          users.slack_id AS user_slack_id
        FROM projects
        JOIN users ON users.id = projects.user_id
        LEFT JOIN journal_entries
          ON journal_entries.project_id = projects.id
          AND journal_entries.user_id = projects.user_id
          AND COALESCE(journal_entries.time_done, journal_entries.created_at) >= '${STACK_LAUNCH_TIMESTAMPTZ}'::timestamptz
        GROUP BY projects.id, users.id
        ORDER BY projects.id ASC
      `);

      for (const row of projectsResult.rows) {
        try {
          const syncResult = await syncProjectToAirtable(row);
          if (syncResult.ok && syncResult.recordId) {
            await persistProjectAirtableRecordId(row.id, syncResult.recordId);
          }
          if (syncResult.skipped) {
            result.projects.skipped += 1;
          } else {
            result.projects.synced += 1;
          }
        } catch (error) {
          result.projects.failed += 1;
          console.error("[airtable] periodic project sync failed:", {
            projectId: row.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (hasAirtableYswsConfig) {
      try {
        const yswsResult = await syncAllYswsSubmissions();
        result.ysws = {
          synced: yswsResult.synced ?? 0,
          failed: yswsResult.failed ?? 0,
          skippedProjects: yswsResult.skippedProjects ?? 0,
          total: yswsResult.total ?? 0,
          skipped: Boolean(yswsResult.skipped),
          reason: yswsResult.reason,
          lastError: yswsResult.lastError ?? null,
        };
        if ((yswsResult.failed ?? 0) > 0) {
          result.ok = false;
        }
      } catch (error) {
        result.ok = false;
        result.ysws.failed += 1;
        console.error("[ysws] periodic sync failed:", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (hasAirtableOrdersConfig) {
      try {
        const ordersResult = await syncAllShopOrdersToAirtable();
        result.orders = {
          synced: ordersResult.synced ?? 0,
          failed: ordersResult.failed ?? 0,
          total: ordersResult.total ?? 0,
          skipped: Boolean(ordersResult.skipped),
          reason: ordersResult.reason,
          lastError: ordersResult.lastError ?? null,
        };
        if ((ordersResult.failed ?? 0) > 0) {
          result.ok = false;
        }
      } catch (error) {
        result.ok = false;
        result.orders.failed += 1;
        result.orders.lastError = error instanceof Error ? error.message : String(error);
        console.error("[orders] periodic sync failed:", {
          message: result.orders.lastError,
        });
      }
    }

    result.finishedAt = new Date().toISOString();
    lastPeriodicSync = result;
    console.log("[airtable] periodic sync complete:", {
      users: result.users,
      projects: result.projects,
      ysws: result.ysws,
      orders: result.orders,
    });
    return result;
  } finally {
    syncInProgress = false;
  }
}

export function startPeriodicAirtableSync() {
  if (syncTimer) return;
  if (!hasAirtableUsersConfig && !hasAirtableProjectsConfig && !hasAirtableYswsConfig && !hasAirtableOrdersConfig) {
    console.warn(
      "[airtable] Periodic sync disabled: set AIRTABLE_TOKEN (or AIRTABLE_API_KEY) and AIRTABLE_APP (or AIRTABLE_BASE_ID)."
    );
    return;
  }

  syncAllUsersAndProjectsToAirtable().catch((error) => {
    console.error("[airtable] initial periodic sync failed:", error);
  });

  syncTimer = setInterval(() => {
    syncAllUsersAndProjectsToAirtable().catch((error) => {
      console.error("[airtable] scheduled periodic sync failed:", error);
    });
  }, syncIntervalMs);

  console.log(`[airtable] periodic users/projects sync every ${syncIntervalMs}ms`);
}
