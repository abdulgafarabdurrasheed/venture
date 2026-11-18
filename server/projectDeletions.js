import { pool } from "./db.js";
import { deleteProjectFromAirtable, hasAirtableProjectsConfig } from "./airtableProjects.js";
import {
  deleteYswsSubmissionFromAirtable,
  hasAirtableYswsConfig,
} from "./airtableYsws.js";

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

export async function processPendingProjectDeletions({ limit = 25, deletionId = null } = {}) {
  if (!pool) return { completed: 0, failed: 0, pending: 0 };

  const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 25)));
  const result = await pool.query(
    `
      SELECT id, cleanup_snapshot
      FROM project_deletion_records
      WHERE external_cleanup_completed_at IS NULL
        AND ($1::bigint IS NULL OR id = $1)
      ORDER BY created_at ASC, id ASC
      LIMIT $2
    `,
    [deletionId, safeLimit]
  );
  const summary = { completed: 0, failed: 0, pending: result.rows.length };

  for (const record of result.rows) {
    const cleanup = record.cleanup_snapshot ?? {};
    const errors = [];

    if (cleanup.projectRecordExpected) {
      if (!hasAirtableProjectsConfig) {
        errors.push("Airtable Projects is not configured.");
      } else {
        try {
          await deleteProjectFromAirtable(cleanup.project);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    const submissionRecordIds = Array.isArray(cleanup.submissionRecordIds)
      ? cleanup.submissionRecordIds
      : [];
    if (submissionRecordIds.length > 0 && !hasAirtableYswsConfig) {
      errors.push("Airtable YSWS is not configured.");
    } else {
      for (const airtableRecordId of submissionRecordIds) {
        try {
          await deleteYswsSubmissionFromAirtable(airtableRecordId);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    const lastError = errors.length > 0 ? errors.join(" ").slice(0, 4000) : null;
    await pool.query(
      `
        UPDATE project_deletion_records
        SET external_cleanup_attempts = external_cleanup_attempts + 1,
            external_cleanup_last_error = $2,
            external_cleanup_completed_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE NULL END
        WHERE id = $1 AND external_cleanup_completed_at IS NULL
      `,
      [record.id, lastError]
    );

    if (lastError) {
      summary.failed += 1;
      console.error("[project-deletions] external cleanup is pending", {
        deletionId: record.id,
        message: lastError,
      });
    } else {
      summary.completed += 1;
    }
  }

  return summary;
}
