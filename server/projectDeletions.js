import { pool } from "./db.js";
import { deleteProjectFromAirtable, hasAirtableProjectsConfig } from "./airtableProjects.js";
import {
  deleteYswsSubmissionFromAirtable,
  hasAirtableYswsConfig,
} from "./airtableYsws.js";
import { deleteJournalEntriesFromAirtable, hasAirtableJournalsConfig } from "./airtableJournals.js";

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
      journal_entries_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
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
    ALTER TABLE project_deletion_records
    ADD COLUMN IF NOT EXISTS journal_entries_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
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

export async function listProjectDeletionRecords({ limit = 100, offset = 0 } = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const safeLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
  const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const result = await pool.query(
    `
      SELECT
        id, project_id, project_owner_id, project_name, deleted_by_user_id, deletion_reason,
        project_snapshot, jsonb_array_length(journal_entries_snapshot) AS journal_entry_count,
        coin_clawback, coin_balance_before, coin_balance_after, coin_shortfall,
        external_cleanup_completed_at, external_cleanup_attempts, external_cleanup_last_error, created_at
      FROM project_deletion_records
      ORDER BY created_at DESC, id DESC
      LIMIT $1 OFFSET $2
    `,
    [safeLimit, safeOffset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectOwnerId: row.project_owner_id,
    projectName: row.project_name,
    deletedByUserId: row.deleted_by_user_id,
    reason: row.deletion_reason,
    project: row.project_snapshot,
    archivedJournalCount: Number(row.journal_entry_count ?? 0),
    coinClawback: Number(row.coin_clawback ?? 0),
    coinBalanceBefore: Number(row.coin_balance_before ?? 0),
    coinBalanceAfter: Number(row.coin_balance_after ?? 0),
    coinShortfall: Number(row.coin_shortfall ?? 0),
    externalCleanupCompletedAt: row.external_cleanup_completed_at,
    externalCleanupAttempts: Number(row.external_cleanup_attempts ?? 0),
    externalCleanupLastError: row.external_cleanup_last_error,
    deletedAt: row.created_at,
  }));
}

export async function getProjectDeletionRecord(id) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(
    `
      SELECT project_snapshot, journal_entries_snapshot
      FROM project_deletion_records
      WHERE id = $1
    `,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    project: row.project_snapshot,
    journalEntries: Array.isArray(row.journal_entries_snapshot) ? row.journal_entries_snapshot : [],
  };
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

    const journalEntryIds = Array.isArray(cleanup.journalEntryIds) ? cleanup.journalEntryIds : [];
    if (journalEntryIds.length > 0 && !hasAirtableJournalsConfig) {
      errors.push("Airtable journals are not configured.");
    } else if (journalEntryIds.length > 0) {
      try {
        await deleteJournalEntriesFromAirtable(journalEntryIds);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const lastError = errors.length > 0 ? errors.join(" ").slice(0, 4000) : null;
    await pool.query(
      `
        UPDATE project_deletion_records
        SET external_cleanup_attempts = external_cleanup_attempts + 1,
            external_cleanup_last_error = $2,
            external_cleanup_completed_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE NULL END,
            cleanup_snapshot = CASE WHEN $2::text IS NULL THEN '{}'::jsonb ELSE cleanup_snapshot END
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
