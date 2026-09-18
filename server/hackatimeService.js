import { pool } from "./db.js";
import { syncPostgresUserToAirtable } from "./airtableUsers.js";
import {
  fetchHackatimeProjects,
  fetchHackatimeProjectsForStack,
  fetchHackatimeTotalHours,
  isHackatimeOAuthConfigured,
  isStackLaunched,
  sumHackatimeHoursForNames,
} from "./hackatimeAuth.js";
import { refreshHackatimeGithubUsernameForUser } from "./hackatimeGithubUsername.js";
import { syncAllProjectHoursForUser } from "./projects.js";

export function isHackatimeConnected(row) {
  return Boolean(row?.hackatime_access_token);
}

export async function saveHackatimeTokensForUser(userId, token) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const accessToken = token.access_token ?? null;
  const refreshToken = token.refresh_token ?? null;
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : null;
  let tokenExpiresAt = null;
  if (expiresIn) {
    tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  }

  const result = await pool.query(
    `
      UPDATE users
      SET
        hackatime_access_token = $1,
        hackatime_refresh_token = $2,
        hackatime_token_expires_at = $3,
        hackatime_connected_at = COALESCE(hackatime_connected_at, NOW()),
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `,
    [accessToken, refreshToken, tokenExpiresAt, userId]
  );

  return result.rows[0] ?? null;
}

export async function getHackatimeAccessTokenForUser(userId) {
  if (!pool) return null;
  const result = await pool.query(
    `SELECT hackatime_access_token FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0]?.hackatime_access_token ?? null;
}

export async function refreshUserHackatimeCache(userId, accessToken) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const token = accessToken || (await getHackatimeAccessTokenForUser(userId));
  if (!token) {
    return { projects: [], totalHours: 0 };
  }

  const [stackProjects, hours] = await Promise.all([
    fetchHackatimeProjectsForStack(token),
    fetchHackatimeTotalHours(token),
  ]);

  await pool.query(
    `
      UPDATE users
      SET hackatime_total_hours = $1, updated_at = NOW()
      WHERE id = $2
    `,
    [hours.totalHours, userId]
  );

  await syncAllProjectHoursForUser(userId, stackProjects);

  const userRow = (
    await pool.query(`SELECT * FROM users WHERE id = $1`, [userId])
  ).rows[0];

  if (userRow) {
    try {
      await syncPostgresUserToAirtable(userRow);
    } catch (error) {
      console.error("[hackatime] Airtable user sync after refresh failed:", {
        userId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { projects: stackProjects, totalHours: hours.totalHours };
}

export async function connectHackatimeForUser(userId, tokenResponse) {
  await saveHackatimeTokensForUser(userId, tokenResponse);
  await refreshHackatimeGithubUsernameForUser(userId, tokenResponse.access_token);
  return refreshUserHackatimeCache(userId, tokenResponse.access_token);
}

export async function getHackatimeStatusForUser(userId) {
  const stackLaunched = isStackLaunched();

  if (!isHackatimeOAuthConfigured()) {
    return { configured: false, connected: false, projects: [], totalHours: 0, stackLaunched };
  }

  const token = await getHackatimeAccessTokenForUser(userId);
  if (!token) {
    return { configured: true, connected: false, projects: [], totalHours: 0, stackLaunched };
  }

  try {
    const userRow = (
      await pool.query(`SELECT hackatime_total_hours FROM users WHERE id = $1`, [userId])
    ).rows[0];
    const projects = await fetchHackatimeProjectsForStack(token);
    return {
      configured: true,
      connected: true,
      projects,
      totalHours: Number(userRow?.hackatime_total_hours ?? 0),
      stackLaunched,
    };
  } catch (error) {
    console.error("[hackatime] status fetch failed:", {
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      configured: true,
      connected: true,
      projects: [],
      totalHours: 0,
      stackLaunched,
      error: "Failed to load Hackatime data.",
    };
  }
}

export async function listHackatimeProjectsForUser(userId) {
  const token = await getHackatimeAccessTokenForUser(userId);
  if (!token) return [];
  return fetchHackatimeProjectsForStack(token);
}

