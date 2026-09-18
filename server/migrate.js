import "./env.js";
import path from "path";
import { fileURLToPath } from "url";
import { getPublicTables, hasDatabaseConfig, pool } from "./db.js";
import { ensureAuditLogTable } from "./adminStats.js";
import { ensureProjectsTable } from "./projects.js";
import { ensureShopItemsTable } from "./shopItems.js";
import { ensureUsersTable } from "./users.js";
import { isProduction } from "./security.js";
import { migrateBrickColumnsToCoins } from "./coinSchema.js";

/** Tables created by ensure*Table on boot — used for post-migrate verification. */
export const EXPECTED_TABLES = [
  "users",
  "projects",
  "journal_entries",
  "project_review_feedback",
  "ysws_project_submissions",
  "shop_items",
  "shop_orders",
  "audit_log",
];

export function assertDatabaseConfiguredInProduction() {
  if (isProduction() && !hasDatabaseConfig) {
    throw new Error("[db] DATABASE_URL must be set in production.");
  }
}

export async function ensureDatabaseSchema() {
  if (!pool) {
    throw new Error("[db] DATABASE_URL is not set.");
  }

  await migrateBrickColumnsToCoins();
  await ensureUsersTable();
  await ensureProjectsTable();
  await ensureShopItemsTable();
  await ensureAuditLogTable();
}

export async function verifyDatabaseSchema() {
  if (!pool) {
    throw new Error("[db] DATABASE_URL is not set.");
  }

  const tables = await getPublicTables();
  const missing = EXPECTED_TABLES.filter((name) => !tables.includes(name));

  if (missing.length > 0) {
    throw new Error(`[db] Missing tables after migration: ${missing.join(", ")}`);
  }

  return { ok: true, tables: EXPECTED_TABLES };
}

export async function runDatabaseMigration({ verify = true } = {}) {
  await ensureDatabaseSchema();
  if (verify) {
    return verifyDatabaseSchema();
  }
  return { ok: true, tables: EXPECTED_TABLES };
}

const __filename = fileURLToPath(import.meta.url);
const isCli = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isCli) {
  runDatabaseMigration()
    .then(({ tables }) => {
      console.log(`[db] Schema ready (${tables.length} tables): ${tables.join(", ")}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
