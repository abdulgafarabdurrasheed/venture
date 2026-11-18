import { pool } from "./db.js";

export async function ensureProjectDeletionRecordsTable() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_deletion_records (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL,
      project_owner_id INTEGER,
      project_name TEXT NOT NULL,
      deleted_by_user_id INTEGER,
      deletion_reason TEXT NOT NULL,
      project_snapshot JSONB NOT NULL,
      cleanup_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      coin_clawback NUMERIC(10, 2) NOT NULL DEFAULT 0,
      coin_balance_before NUMERIC(10, 2) NOT NULL DEFAULT 0,
      coin_balance_after NUMERIC(10, 2) NOT NULL DEFAULT 0,
      coin_shortfall NUMERIC(10, 2) NOT NULL DEFAULT 0,
      external_cleanup_completed_at TIMESTAMPTZ,
      external_cleanup_attempts INTEGER NOT NULL DEFAULT 0,
      external_cleanup_last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_project_deletion_records_cleanup
    ON project_deletion_records(created_at)
    WHERE external_cleanup_completed_at IS NULL
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_project_deletion_records_project
    ON project_deletion_records(project_id, created_at DESC)
  `);
}
