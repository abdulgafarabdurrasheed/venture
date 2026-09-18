import { isShippingClosed } from "./shipDeadlines.js";
import { pool } from "./db.js";
import { deleteProjectFromAirtable, persistProjectAirtableRecordId, syncProjectToAirtable } from "./airtableProjects.js";
import { syncJournalEntryToAirtable } from "./airtableJournals.js";
import { deleteProjectSubmissionsFromYsws, ensureYswsProjectSubmissionsTable, submitProjectToYsws, syncApprovedYswsSubmissionForProject } from "./airtableYsws.js";
import { buildDefaultJustificationTemplate } from "./hourJustification.js";
import { listPendingShopOrdersForUser, rejectShopOrderWithRefund, toReviewParticipantShopOrder } from "./shopItems.js";
import { isHackClubCdnUrl, safeHackClubCdnUrl, assertJournalDescriptionMediaIsCdnOnly } from "./cdnLinks.js";
import {
  fetchHackatimeProjectsForStack,
  STACK_LAUNCH_UTC,
  sumHackatimeHoursForNames,
} from "./hackatimeAuth.js";
import { COINS_PER_APPROVED_HOUR } from "./coinRates.js";

export { COINS_PER_APPROVED_HOUR };

export class InsufficientCoinsForReductionError extends Error {
  constructor(payload) {
    super("The participant has already spent coins tied to this reduction.");
    this.name = "InsufficientCoinsForReductionError";
    this.payload = payload;
  }
}

const STACK_LAUNCH_TIMESTAMPTZ = STACK_LAUNCH_UTC.toISOString();

/** Journal entries on or after Stack launch (5 Jun 2026 00:00 ET). */
function journalEntryAfterLaunchOn(alias = "journal_entries") {
  return `COALESCE(${alias}.time_done, ${alias}.created_at) >= '${STACK_LAUNCH_TIMESTAMPTZ}'::timestamptz`;
}

function journalEntryAfterLaunchWhere() {
  return `COALESCE(time_done, created_at) >= '${STACK_LAUNCH_TIMESTAMPTZ}'::timestamptz`;
}

export const MIN_SHIP_LOGGED_HOURS = 1;
const MIN_RESHIP_UPDATE_LENGTH = 80;
const MAX_RESHIP_UPDATE_LENGTH = 10000;

export async function ensureProjectsTable() {
  if (!pool) {
    console.warn("[projects] DATABASE_URL not set; skipping projects table setup.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      project_type TEXT,
      playable_url TEXT,
      code_url TEXT,
      image_url TEXT,
      hackatime_names JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      shipped BOOLEAN NOT NULL DEFAULT FALSE,
      reviewed BOOLEAN NOT NULL DEFAULT FALSE,
      total_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
      approved_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
      past_approved_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
      coins_earned NUMERIC(10, 2) NOT NULL DEFAULT 0,
      admin_feedback TEXT,
      hour_justification TEXT,
      reviewed_at TIMESTAMPTZ,
      reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      shipped_at TIMESTAMPTZ,
      fraud_flag BOOLEAN NOT NULL DEFAULT FALSE,
      baseline_hours NUMERIC(10, 2),
      last_shipped_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
      hackatime_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
      airtable_record_id TEXT,
      ysws_record_id TEXT,
      parent_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
    ship_kind TEXT NOT NULL DEFAULT 'initial',
    reship_update TEXT,
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const columns = {
    user_id: "INTEGER REFERENCES users(id) ON DELETE CASCADE",
    name: "TEXT",
    description: "TEXT",
    project_type: "TEXT",
    playable_url: "TEXT",
    code_url: "TEXT",
    image_url: "TEXT",
    hackatime_names: "JSONB NOT NULL DEFAULT '[]'::jsonb",
    status: "TEXT NOT NULL DEFAULT 'draft'",
    shipped: "BOOLEAN NOT NULL DEFAULT FALSE",
    reviewed: "BOOLEAN NOT NULL DEFAULT FALSE",
    total_hours: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    approved_hours: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    past_approved_hours: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    coins_earned: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    admin_feedback: "TEXT",
    hour_justification: "TEXT",
    reviewed_at: "TIMESTAMPTZ",
    reviewed_by_user_id: "INTEGER REFERENCES users(id) ON DELETE SET NULL",
    shipped_at: "TIMESTAMPTZ",
    fraud_flag: "BOOLEAN NOT NULL DEFAULT FALSE",
    baseline_hours: "NUMERIC(10, 2)",
    last_shipped_hours: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    hackatime_hours: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    airtable_record_id: "TEXT",
    ysws_record_id: "TEXT",
    parent_project_id: "BIGINT REFERENCES projects(id) ON DELETE SET NULL",
    ship_kind: "TEXT NOT NULL DEFAULT 'initial'",
    reship_update: "TEXT",
    blocked: "BOOLEAN NOT NULL DEFAULT FALSE",
    created_at: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    updated_at: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  };

  for (const [column, definition] of Object.entries(columns)) {
    await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }

  await pool.query("ALTER TABLE projects DROP COLUMN IF EXISTS github_username");
  await pool.query(`UPDATE projects SET reviewed = FALSE WHERE reviewed IS NULL`);
  await pool.query(`
    UPDATE projects
    SET reviewed = TRUE
    WHERE LOWER(status) = 'approved'
      AND reviewed IS NOT TRUE
  `);
  await pool.query(`UPDATE projects SET past_approved_hours = COALESCE(approved_hours, 0) WHERE past_approved_hours IS NULL`);
  await pool.query(`
    UPDATE projects
    SET past_approved_hours = GREATEST(COALESCE(past_approved_hours, 0), COALESCE(approved_hours, 0))
    WHERE COALESCE(past_approved_hours, 0) < COALESCE(approved_hours, 0)
  `);
  await pool.query(`UPDATE projects SET coins_earned = 0 WHERE coins_earned IS NULL`);
  await pool.query(`UPDATE projects SET fraud_flag = FALSE WHERE fraud_flag IS NULL`);
  await pool.query(`UPDATE projects SET ship_kind = 'initial' WHERE ship_kind IS NULL`);
  await pool.query(`UPDATE projects SET blocked = FALSE WHERE blocked IS NULL`);
  await pool.query(`
    WITH mismatched AS (
      SELECT
        id,
        user_id,
        COALESCE(coins_earned, 0) AS old_coins,
        ROUND(COALESCE(approved_hours, 0) * $1, 2) AS new_coins
      FROM projects
      WHERE COALESCE(coins_earned, 0) != ROUND(COALESCE(approved_hours, 0) * $1, 2)
    ),
    corrected AS (
      UPDATE projects
      SET coins_earned = mismatched.new_coins,
          updated_at = NOW()
      FROM mismatched
      WHERE projects.id = mismatched.id
      RETURNING mismatched.user_id, mismatched.new_coins - mismatched.old_coins AS delta
    ),
    deltas AS (
      SELECT user_id, SUM(delta) AS delta
      FROM corrected
      GROUP BY user_id
    )
    UPDATE users
    SET coins = GREATEST(0, users.coins + deltas.delta),
        updated_at = NOW()
    FROM deltas
    WHERE users.id = deltas.user_id
  `, [COINS_PER_APPROVED_HOUR]);
  await pool.query(`
    UPDATE projects
    SET last_shipped_hours = GREATEST(
      COALESCE(last_shipped_hours, 0),
      COALESCE(baseline_hours, 0),
      COALESCE(past_approved_hours, 0),
      COALESCE(approved_hours, 0)
    )
    WHERE COALESCE(last_shipped_hours, 0) = 0
      AND (
        status IN ('approved', 'pending-reship', 'reship-rejected')
        OR COALESCE(past_approved_hours, 0) > 0
        OR COALESCE(approved_hours, 0) > 0
      )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_projects_user_name_lower ON projects(user_id, LOWER(name))`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
      project_name TEXT NOT NULL,
      project_index INTEGER NOT NULL DEFAULT 0,
      time_done TIMESTAMPTZ,
      hours_worked NUMERIC(10, 2) NOT NULL DEFAULT 0,
      description TEXT,
      tools_used JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const journalColumns = {
    user_id: "INTEGER REFERENCES users(id) ON DELETE CASCADE",
    project_id: "BIGINT REFERENCES projects(id) ON DELETE CASCADE",
    project_name: "TEXT",
    project_index: "INTEGER NOT NULL DEFAULT 0",
    time_done: "TIMESTAMPTZ",
    hours_worked: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    description: "TEXT",
    tools_used: "JSONB NOT NULL DEFAULT '[]'::jsonb",
    created_at: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    updated_at: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  };

  for (const [column, definition] of Object.entries(journalColumns)) {
    await pool.query(`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_journal_entries_user_project ON journal_entries(user_id, project_id)`);
  await ensureProjectReviewFeedbackTable();
  await ensureYswsProjectSubmissionsTable();
}

async function ensureProjectReviewFeedbackTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_review_feedback (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reviewer_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      outcome TEXT NOT NULL,
      feedback TEXT,
      hours NUMERIC(10, 2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_project_review_feedback_project ON project_review_feedback(project_id, created_at DESC)`
  );
  await pool.query(
    `ALTER TABLE project_review_feedback ADD COLUMN IF NOT EXISTS reduction_hours NUMERIC(10, 2)`
  );
  await pool.query(
    `ALTER TABLE project_review_feedback ADD COLUMN IF NOT EXISTS user_acknowledged_at TIMESTAMPTZ`
  );
  await backfillProjectReviewFeedbackFromProjects();
}

async function backfillProjectReviewFeedbackFromProjects() {
  await pool.query(`
    INSERT INTO project_review_feedback (
      project_id,
      user_id,
      reviewer_user_id,
      outcome,
      feedback,
      hours,
      created_at
    )
    SELECT
      p.id,
      p.user_id,
      p.reviewed_by_user_id,
      CASE
        WHEN p.status = 'approved' THEN 'approved'
        WHEN p.status = 'reship-rejected' THEN 'reship-rejected'
        WHEN p.status = 'blocked' THEN 'blocked'
        ELSE 'rejected'
      END,
      NULLIF(TRIM(p.admin_feedback), ''),
      CASE
        WHEN p.status = 'approved' THEN COALESCE(p.approved_hours, 0)
        ELSE NULL
      END,
      COALESCE(p.reviewed_at, p.updated_at, NOW())
    FROM projects p
    WHERE NULLIF(TRIM(p.admin_feedback), '') IS NOT NULL
      AND p.reviewed_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM project_review_feedback f WHERE f.project_id = p.id
      )
  `);
}

async function recordProjectReviewFeedback(client, input = {}) {
  const feedback = textOrNull(input.feedback);
  const hoursValue = input.hours;
  const hours =
    hoursValue != null && Number.isFinite(Number(hoursValue)) ? roundedHours(Number(hoursValue)) : null;
  const reductionValue = input.reductionHours ?? input.reduction_hours;
  const reductionHours =
    reductionValue != null && Number.isFinite(Number(reductionValue))
      ? roundedHours(Number(reductionValue))
      : null;
  if (!feedback && (hours == null || hours <= 0)) return;

  const queryClient = client || pool;
  await queryClient.query(
    `
      INSERT INTO project_review_feedback (
        project_id,
        user_id,
        reviewer_user_id,
        outcome,
        feedback,
        hours,
        reduction_hours
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      input.projectId,
      input.userId,
      input.reviewerUserId ?? null,
      input.outcome,
      feedback,
      hours,
      reductionHours,
    ]
  );
}

async function loadReviewFeedbackMapForProjectIds(projectIds) {
  const map = new Map();
  if (!pool || !projectIds.length) return map;

  const result = await pool.query(
    `
      SELECT *
      FROM project_review_feedback
      WHERE project_id = ANY($1::bigint[])
      ORDER BY created_at DESC, id DESC
    `,
    [projectIds]
  );

  for (const row of result.rows) {
    const projectId = Number(row.project_id);
    if (!map.has(projectId)) map.set(projectId, []);
    map.get(projectId).push(toPublicReviewFeedback(row));
  }

  return map;
}

async function attachReviewFeedbackToProjects(projects, { forUser = false } = {}) {
  if (!projects.length) return projects;
  const feedbackMap = await loadReviewFeedbackMapForProjectIds(projects.map((project) => project.id));
  return projects.map((project) => ({
    ...project,
    reviewFeedback: (feedbackMap.get(Number(project.id)) || []).map((record) =>
      forUser ? toUserFacingReviewFeedback(record) : record
    ),
  }));
}

function toUserFacingReviewFeedback(record) {
  if (record.outcome === "hours-reduced") {
    return {
      id: record.id,
      outcome: record.outcome,
      reductionHours: record.reductionHours,
      createdAt: record.createdAt,
    };
  }
  return record;
}

async function toPublicProjectForUser(row) {
  if (!row) return null;
  const [project] = await attachReviewFeedbackToProjects([toPublicProject(row)], { forUser: true });
  return project;
}

export async function listProjectsForUser(userId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(
    `
      SELECT projects.*, COALESCE(SUM(journal_entries.hours_worked), 0) AS journal_hours
      FROM projects
      LEFT JOIN journal_entries
        ON journal_entries.project_id = projects.id
        AND journal_entries.user_id = projects.user_id
        AND ${journalEntryAfterLaunchOn()}
      WHERE projects.user_id = $1
      GROUP BY projects.id
      ORDER BY projects.created_at DESC, projects.id DESC
    `,
    [userId]
  );

  const projects = result.rows.map(toPublicProject);
  return attachReviewFeedbackToProjects(projects, { forUser: true });
}

export async function listHoursReductionWarningsForUser(userId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(
    `
      SELECT
        f.id,
        f.project_id,
        f.reduction_hours,
        f.feedback,
        f.created_at,
        p.name AS project_name
      FROM project_review_feedback f
      JOIN projects p ON p.id = f.project_id
      WHERE f.user_id = $1
        AND f.outcome = 'hours-reduced'
        AND f.user_acknowledged_at IS NULL
        AND COALESCE(f.reduction_hours, 0) > 0
      ORDER BY f.created_at ASC, f.id ASC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    projectId: Number(row.project_id),
    projectName: row.project_name || "Untitled project",
    hoursReduced: Number(row.reduction_hours ?? 0),
    reason: String(row.feedback || "").trim() || null,
    createdAt: row.created_at,
  }));
}

export async function acknowledgeHoursReductionWarnings(userId, feedbackIds = []) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const ids = [...new Set(feedbackIds.map((id) => Number(id)).filter(Number.isFinite))];
  if (!ids.length) {
    return { acknowledged: 0 };
  }

  const result = await pool.query(
    `
      UPDATE project_review_feedback
      SET user_acknowledged_at = NOW()
      WHERE id = ANY($1::bigint[])
        AND user_id = $2
        AND outcome = 'hours-reduced'
        AND user_acknowledged_at IS NULL
    `,
    [ids, userId]
  );

  return { acknowledged: result.rowCount ?? 0 };
}

/** Sum of journal + Hackatime hours across all Off-Track projects for a user. */
export async function getLoggedHoursForUser(userId) {
  if (!pool) return 0;

  const result = await pool.query(
    `
      SELECT COALESCE(SUM(COALESCE(total_hours, 0) + COALESCE(hackatime_hours, 0)), 0) AS logged_hours
      FROM projects
      WHERE user_id = $1
    `,
    [userId]
  );

  return roundedHours(result.rows[0]?.logged_hours ?? 0);
}

export async function createProjectForUser(userId, input) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const project = normalizeProjectInput(input);
  validateProjectBasics(project);
  await assertProjectNameAvailable(userId, project.name);

  const result = await pool.query(
    `
      INSERT INTO projects (
        user_id,
        name,
        description,
        project_type,
        playable_url,
        code_url,
        image_url,
        hackatime_names,
        status,
        shipped
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', FALSE)
      RETURNING *
    `,
    [
      userId,
      project.name,
      project.description,
      project.projectType,
      project.playableUrl,
      project.codeUrl,
      project.imageUrl,
      JSON.stringify(project.hackatimeNames || []),
    ]
  );

  const row = result.rows[0];
  await applyHackatimeHoursToProject(userId, row.id);
  await trySyncProjectToAirtable(row.id);
  return toPublicProjectForUser((await getProjectRowForAirtableSync(row.id)) || row);
}

export async function updateProjectForUser(userId, projectId, input) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const project = normalizeProjectInput(input);
  validateProjectBasics(project);
  await assertProjectNameAvailable(userId, project.name, projectId);

  const result = await pool.query(
    `
      UPDATE projects
      SET
        name = $1,
        description = $2,
        project_type = $3,
        playable_url = $4,
        code_url = $5,
        image_url = $6,
        hackatime_names = $7,
        updated_at = NOW()
      WHERE id = $8
        AND user_id = $9
      RETURNING *
    `,
    [
      project.name,
      project.description,
      project.projectType,
      project.playableUrl,
      project.codeUrl,
      project.imageUrl,
      JSON.stringify(project.hackatimeNames || []),
      projectId,
      userId,
    ]
  );

  if (!result.rows[0]) return null;
  await applyHackatimeHoursToProject(userId, result.rows[0].id);
  await trySyncProjectToAirtable(result.rows[0].id);
  return toPublicProjectForUser((await getProjectRowForAirtableSync(result.rows[0].id)) || result.rows[0]);
}

export async function shipProjectForUser(userId, projectId, { reshipUpdate } = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  await Promise.all([
    refreshProjectJournalHours(userId, projectId),
    applyHackatimeHoursToProject(userId, projectId),
  ]);
  const project = await getProjectRowForUser(userId, projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  if (project.blocked) {
    throw new Error("This project has been blocked and cannot be shipped again.");
  }

  if (isShippingClosed()) {
    throw new Error("Shipping has closed for Off-Track.");
  }

  const missing = getShipMissingRequirements(project);
  if (missing.length > 0) {
    throw new Error(`Cannot ship yet: ${missing.join(", ")}.`);
  }

  const isReship = isReshipEligibleProject(project);
  let normalizedReshipUpdate = null;

  if (isReship) {
    normalizedReshipUpdate = String(reshipUpdate || "").trim();
    if (!normalizedReshipUpdate) {
      throw new Error("Please give a detailed update of your work compared to the previous ship.");
    }
    if (normalizedReshipUpdate.length < MIN_RESHIP_UPDATE_LENGTH) {
      throw new Error(
        `Please give a detailed update of at least ${MIN_RESHIP_UPDATE_LENGTH} characters comparing your work to the previous ship.`
      );
    }
    if (normalizedReshipUpdate.length > MAX_RESHIP_UPDATE_LENGTH) {
      throw new Error(`Update must be ${MAX_RESHIP_UPDATE_LENGTH} characters or fewer.`);
    }
  }

  const shipJustification = buildDefaultJustificationTemplate({
    totalHours: loggedHours(project),
    shippingDate: new Date(),
    hackatimeNames: project.hackatime_names,
    reshipUpdate: normalizedReshipUpdate,
  });

  const result = await pool.query(
    `
      UPDATE projects
      SET
        shipped = TRUE,
        status = $3,
        ship_kind = $4,
        reviewed = FALSE,
        reviewed_at = NULL,
        reviewed_by_user_id = NULL,
        admin_feedback = NULL,
        shipped_at = NOW(),
        hour_justification = $5,
        reship_update = $6,
        updated_at = NOW()
      WHERE user_id = $1
        AND id = $2
      RETURNING *, total_hours AS journal_hours
    `,
    [
      userId,
      projectId,
      isReship ? "pending-reship" : "in-review",
      isReship ? "reship" : "initial",
      shipJustification,
      normalizedReshipUpdate,
    ]
  );

  const row = result.rows[0];
  await trySyncProjectToAirtable(row.id);
  await trySubmitProjectToYsws(row.id);
  return toPublicProjectForUser(row);
}

export { buildDefaultJustificationTemplate } from "./hourJustification.js";

export async function listAdminReviewProjects({ shipSort = "oldest" } = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const direction = shipSort === "newest" ? "DESC" : "ASC";
  const reviewProjectsSql = `
    SELECT
      projects.*,
      COALESCE(SUM(journal_entries.hours_worked), 0) AS journal_hours,
      users.email AS user_email,
      users.slug AS user_slug,
      users.profile_image_url AS user_profile_image_url,
      users.slack_id AS user_slack_id
    FROM projects
    JOIN users ON users.id = projects.user_id
    LEFT JOIN journal_entries
      ON journal_entries.project_id = projects.id
      AND journal_entries.user_id = projects.user_id
      AND ${journalEntryAfterLaunchOn()}
    GROUP BY projects.id, users.id
    ORDER BY projects.shipped_at ${direction} NULLS LAST, projects.updated_at ${direction}, projects.id ${direction}
  `;

  const result = await pool.query(reviewProjectsSql);
  const userIds = [...new Set(result.rows.map((row) => Number(row.user_id)).filter(Number.isFinite))];
  // Refresh Hackatime in the background so the review queue is not blocked (or timed out) in production.
  void Promise.all(
    userIds.map((userId) =>
      refreshProjectHackatimeHoursForUser(userId).catch((error) => {
        console.error("[review] hackatime refresh failed:", error?.message || error);
      })
    )
  );

  const projects = result.rows.map(toAdminReviewProject);
  const pendingProjects = projects.filter(isPendingReviewProject);
  return {
    projects: projects.filter((project) => !isPendingReviewProject(project)),
    pendingProjects,
  };
}

export async function getAdminReviewProject(projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const ownerResult = await pool.query(`SELECT user_id FROM projects WHERE id = $1`, [projectId]);
  const ownerId = ownerResult.rows[0]?.user_id;
  if (ownerId) {
    await refreshProjectHackatimeHoursForUser(ownerId).catch((error) => {
      console.error("[review] hackatime refresh failed for project:", projectId, error?.message || error);
    });
  }

  const result = await pool.query(
    `
      SELECT
        projects.*,
        COALESCE(SUM(journal_entries.hours_worked), 0) AS journal_hours,
        users.email AS user_email,
        users.slug AS user_slug,
        users.profile_image_url AS user_profile_image_url,
        users.slack_id AS user_slack_id
      FROM projects
      JOIN users ON users.id = projects.user_id
      LEFT JOIN journal_entries
        ON journal_entries.project_id = projects.id
        AND journal_entries.user_id = projects.user_id
        AND ${journalEntryAfterLaunchOn()}
      WHERE projects.id = $1
      GROUP BY projects.id, users.id
    `,
    [projectId]
  );

  const project = result.rows[0] ? toAdminReviewProject(result.rows[0]) : null;
  if (!project) return null;

  const [projectWithFeedback] = await attachReviewFeedbackToProjects([project]);
  const journalEntries = await listJournalEntriesForUserProject(projectWithFeedback.userId, projectWithFeedback.id);
  return { project: projectWithFeedback, journalEntries };
}

export async function approveAdminReviewProject(adminId, projectId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const requestedApprovedHours = Number.parseFloat(input.approvedHours ?? input.approved_hours ?? 0);
  const approvedHours = roundedHours(requestedApprovedHours);
  const feedback = textOrNull(input.feedback);
  const acknowledgeExceedLoggedHours = Boolean(
    input.acknowledgeExceedLoggedHours ?? input.acknowledge_exceed_logged_hours
  );
  if (!Number.isFinite(requestedApprovedHours) || approvedHours <= 0) {
    throw new Error("Enter a positive number of new hours to approve for this submission.");
  }

  const ownerResult = await pool.query(`SELECT user_id FROM projects WHERE id = $1`, [projectId]);
  const ownerId = ownerResult.rows[0]?.user_id;
  if (ownerId) {
    await refreshProjectHackatimeHoursForUser(ownerId);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await refreshProjectJournalHoursWithClient(client, projectId);

    const projectResult = await client.query("SELECT * FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    const project = projectResult.rows[0];
    if (project) {
      project.journal_hours = project.total_hours;
    }
    if (!project) throw new Error("Project not found.");
    if (!project.shipped) throw new Error("Project is not in the review queue.");
    if (project.reviewed && project.status === "approved") throw new Error("Project is already approved.");

    const bankedHours = approvedBankedHours(project);
    const totalLoggedHours = loggedHours(project);
    const pendingCap = pendingReviewHours(project);
    const newTotalApprovedHours = roundedHours(bankedHours + approvedHours);
    const exceedsPendingCap = approvedHours > pendingCap + 1e-9;
    const exceedsTotalLogged = newTotalApprovedHours > totalLoggedHours + 1e-9;

    if ((exceedsPendingCap || exceedsTotalLogged) && !acknowledgeExceedLoggedHours) {
      if (exceedsTotalLogged) {
        throw new Error(
          `Cannot approve ${newTotalApprovedHours.toFixed(2)} total hours because only ${totalLoggedHours.toFixed(2)} hours are logged. Confirm the exceed-hours acknowledgment to override.`
        );
      }
      throw new Error(
        `Cannot approve more new hours than the participant has logged beyond prior approvals (${pendingCap.toFixed(2)} h max). Confirm the exceed-hours acknowledgment to override.`
      );
    }

    const coinsDelta = approvedHours * COINS_PER_APPROVED_HOUR;
    const reductionHours = acknowledgeExceedLoggedHours
      ? 0
      : Math.max(0, roundedHours(totalLoggedHours - newTotalApprovedHours));
    if (reductionHours > 0 && !feedback) {
      throw new Error("Deducting logged hours requires a written deflation explanation.");
    }
    const hoursBaselineForShip = acknowledgeExceedLoggedHours ? newTotalApprovedHours : totalLoggedHours;
    const newCumulativeCoins = Number(project.coins_earned ?? 0) + coinsDelta;

    const reviewerResult = await client.query("SELECT name, email FROM users WHERE id = $1", [adminId]);
    const reviewerName = reviewerResult.rows[0]?.name || reviewerResult.rows[0]?.email || "<reviewer>";
    const finalJustification = buildDefaultJustificationTemplate({
      approvedHours: newTotalApprovedHours,
      totalHours: totalLoggedHours,
      reductionHours,
      reviewerName,
      shippingDate: project.shipped_at,
      hackatimeNames: project.hackatime_names,
      reshipUpdate: project.reship_update,
    });

    const updatedProjectResult = await client.query(
      `
        UPDATE projects
        SET
          reviewed = TRUE,
          reviewed_at = NOW(),
          reviewed_by_user_id = $1,
          status = 'approved',
          ship_kind = 'initial',
          approved_hours = $2,
          past_approved_hours = $2,
          baseline_hours = COALESCE(baseline_hours, $7),
          last_shipped_hours = $7,
          hour_justification = $3,
          admin_feedback = $4,
          coins_earned = $5,
          updated_at = NOW()
        WHERE id = $6
        RETURNING *, total_hours AS journal_hours
      `,
      [adminId, newTotalApprovedHours, finalJustification, feedback, newCumulativeCoins, projectId, hoursBaselineForShip]
    );
    const approvedRow = updatedProjectResult.rows[0];

    await client.query("UPDATE users SET coins = coins + $1, updated_at = NOW() WHERE id = $2", [coinsDelta, project.user_id]);
    await recordProjectReviewFeedback(client, {
      projectId,
      userId: project.user_id,
      reviewerUserId: adminId,
      outcome: "approved",
      feedback,
      hours: approvedHours,
      reductionHours,
    });
    await client.query("COMMIT");

    await trySyncProjectToAirtable(approvedRow.id);
    await trySubmitProjectToYsws(approvedRow.id);

    return {
      project: toPublicProject(approvedRow),
      coinsEarned: coinsDelta,
      approvedHours: newTotalApprovedHours,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectAdminReviewProject(adminId, projectId, input = {}) {
  return finalizeAdminReviewRemoval(adminId, projectId, input, { consumePendingHours: true });
}

export async function removeFromQueueAdminReviewProject(adminId, projectId, input = {}) {
  return finalizeAdminReviewRemoval(adminId, projectId, input, { consumePendingHours: false });
}

async function finalizeAdminReviewRemoval(adminId, projectId, input = {}, { consumePendingHours = true } = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const feedback = textOrNull(input.feedback);
  if (!feedback) {
    throw new Error(
      consumePendingHours
        ? "Rejection requires a written comment (what to fix before resubmitting)."
        : "Removing from the queue requires a written comment."
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await refreshProjectJournalHoursWithClient(client, projectId);

    const lookup = await client.query("SELECT * FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    const project = lookup.rows[0];
    const isReship = project?.ship_kind === "reship";
    const submissionHours = project ? pendingReviewHours(project) : 0;
    const rejectionStatus = isReship ? "reship-rejected" : "rejected";
    const feedbackOutcome = consumePendingHours ? rejectionStatus : "queue-removed";

    const result = await client.query(
      `
        UPDATE projects
        SET
          shipped = FALSE,
          shipped_at = NULL,
          reviewed = TRUE,
          reviewed_at = NOW(),
          reviewed_by_user_id = $1,
          status = $4,
          ship_kind = 'initial',
          admin_feedback = $2,
          last_shipped_hours = CASE
            WHEN $5 THEN GREATEST(
              COALESCE(last_shipped_hours, 0),
              COALESCE(total_hours, 0) + COALESCE(hackatime_hours, 0)
            )
            ELSE last_shipped_hours
          END,
          updated_at = NOW()
        WHERE id = $3
          AND shipped IS TRUE
        RETURNING *, total_hours AS journal_hours
      `,
      [adminId, feedback, projectId, rejectionStatus, consumePendingHours]
    );

    if (!result.rows[0]) {
      throw new Error("Project is not in the review queue.");
    }

    await recordProjectReviewFeedback(client, {
      projectId,
      userId: project.user_id,
      reviewerUserId: adminId,
      outcome: feedbackOutcome,
      feedback,
      hours: submissionHours,
    });

    await client.query("COMMIT");

    const row = result.rows[0];
    await trySyncProjectToAirtable(row.id);
    await trySubmitProjectToYsws(row.id);
    return toPublicProject(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function blockAdminReviewProject(adminId, projectId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const feedback = textOrNull(input.feedback);
  if (!feedback) {
    throw new Error("Blocking requires a written reason.");
  }

  const lookup = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
  const project = lookup.rows[0];
  if (!project) throw new Error("Project not found.");
  const submissionHours = loggedHours(project);

  const result = await pool.query(
    `
      UPDATE projects
      SET
        shipped = FALSE,
        shipped_at = NULL,
        reviewed = TRUE,
        reviewed_at = NOW(),
        reviewed_by_user_id = $1,
        status = 'blocked',
        blocked = TRUE,
        admin_feedback = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *, total_hours AS journal_hours
    `,
    [adminId, feedback, projectId]
  );

  if (!result.rows[0]) {
    throw new Error("Project not found.");
  }

  const row = result.rows[0];
  if (row.parent_project_id) {
    await pool.query(
      `UPDATE projects SET blocked = TRUE, updated_at = NOW() WHERE id = $1`,
      [row.parent_project_id]
    );
    await trySyncProjectToAirtable(row.parent_project_id);
  }

  await recordProjectReviewFeedback(pool, {
    projectId,
    userId: project.user_id,
    reviewerUserId: adminId,
    outcome: "blocked",
    feedback,
    hours: submissionHours,
  });

  await trySyncProjectToAirtable(row.id);
  await trySubmitProjectToYsws(row.id);
  return toPublicProject(row);
}

export async function reduceAdminReviewProjectHours(adminId, projectId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const requestedApprovedHours = Number.parseFloat(input.approvedHours ?? input.approved_hours ?? NaN);
  const newApprovedHours = roundedHours(requestedApprovedHours);
  const feedback = textOrNull(input.feedback);
  if (!Number.isFinite(requestedApprovedHours)) {
    throw new Error("Enter the new total approved hours for this project.");
  }
  if (newApprovedHours < 0) {
    throw new Error("Approved hours cannot be negative.");
  }
  if (!feedback) {
    throw new Error("Reducing approved hours requires a written reason.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await refreshProjectJournalHoursWithClient(client, projectId);

    const projectResult = await client.query("SELECT * FROM projects WHERE id = $1 FOR UPDATE", [projectId]);
    const project = projectResult.rows[0];
    if (project) {
      project.journal_hours = project.total_hours;
    }
    if (!project) throw new Error("Project not found.");

    const currentApprovedHours = roundedHours(project.approved_hours);
    if (currentApprovedHours <= 0) {
      throw new Error("This project has no approved hours to reduce.");
    }
    if (project.blocked || String(project.status || "").toLowerCase() === "blocked") {
      throw new Error("Blocked projects cannot have approved hours adjusted.");
    }
    if (newApprovedHours >= currentApprovedHours) {
      throw new Error(
        `New approved hours (${newApprovedHours.toFixed(2)}) must be less than the current total (${currentApprovedHours.toFixed(2)}).`
      );
    }

    const hoursReduced = roundedHours(currentApprovedHours - newApprovedHours);
    const newCoinsEarned = roundedHours(newApprovedHours * COINS_PER_APPROVED_HOUR);
    const coinsToDeduct = roundedHours(hoursReduced * COINS_PER_APPROVED_HOUR);
    const totalLoggedHours = loggedHours(project);

    const userLockResult = await client.query("SELECT coins FROM users WHERE id = $1 FOR UPDATE", [
      project.user_id,
    ]);
    const userCoinsBefore = numberOrZero(userLockResult.rows[0]?.coins);
    const coinsDeducted = roundedHours(Math.min(coinsToDeduct, userCoinsBefore));
    const coinsShortfall = roundedHours(Math.max(0, coinsToDeduct - coinsDeducted));

    if (coinsShortfall > 0) {
      const pendingOrders = (await listPendingShopOrdersForUser(project.user_id)).map(toReviewParticipantShopOrder);
      throw new InsufficientCoinsForReductionError({
        coinsShortfall,
        coinsToDeduct,
        userCoins: userCoinsBefore,
        pendingOrders,
      });
    }

    const reviewerResult = await client.query("SELECT name, email FROM users WHERE id = $1", [adminId]);
    const reviewerName = reviewerResult.rows[0]?.name || reviewerResult.rows[0]?.email || "<reviewer>";
    const finalJustification = buildDefaultJustificationTemplate({
      approvedHours: newApprovedHours,
      totalHours: totalLoggedHours,
      reductionHours: Math.max(0, roundedHours(totalLoggedHours - newApprovedHours)),
      reviewerName,
      shippingDate: project.shipped_at,
      hackatimeNames: project.hackatime_names,
      reshipUpdate: project.reship_update,
    });

    const updatedProjectResult = await client.query(
      `
        UPDATE projects
        SET
          approved_hours = $1,
          past_approved_hours = $1,
          coins_earned = $2,
          hour_justification = $3,
          admin_feedback = $4,
          updated_at = NOW()
        WHERE id = $5
        RETURNING *, total_hours AS journal_hours
      `,
      [newApprovedHours, newCoinsEarned, finalJustification, feedback, projectId]
    );
    const updatedRow = updatedProjectResult.rows[0];

    if (coinsDeducted > 0) {
      await client.query("UPDATE users SET coins = coins - $1, updated_at = NOW() WHERE id = $2", [
        coinsDeducted,
        project.user_id,
      ]);
    }

    await recordProjectReviewFeedback(client, {
      projectId,
      userId: project.user_id,
      reviewerUserId: adminId,
      outcome: "hours-reduced",
      feedback,
      hours: newApprovedHours,
      reductionHours: hoursReduced,
    });

    await client.query("COMMIT");

    await trySyncProjectToAirtable(updatedRow.id);
    await trySyncApprovedYswsSubmission(updatedRow.id);
    await trySubmitProjectToYsws(updatedRow.id);

    return {
      project: toPublicProject(updatedRow),
      previousApprovedHours: currentApprovedHours,
      approvedHours: newApprovedHours,
      hoursReduced,
      coinsDeducted,
      coinsShortfall,
      coinsEarned: newCoinsEarned,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getParticipantPendingOrdersForReview(projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const projectResult = await pool.query(`SELECT user_id FROM projects WHERE id = $1`, [projectId]);
  const userId = projectResult.rows[0]?.user_id;
  if (!userId) throw new Error("Project not found.");

  const [pendingOrders, userResult] = await Promise.all([
    listPendingShopOrdersForUser(userId),
    pool.query(`SELECT coins FROM users WHERE id = $1`, [userId]),
  ]);

  return {
    userCoins: Number(userResult.rows[0]?.coins ?? 0),
    pendingOrders: pendingOrders.map(toReviewParticipantShopOrder),
  };
}

export async function rejectParticipantOrderForReview(projectId, orderId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const projectResult = await pool.query(`SELECT user_id FROM projects WHERE id = $1`, [projectId]);
  const ownerId = projectResult.rows[0]?.user_id;
  if (!ownerId) throw new Error("Project not found.");

  const orderResult = await pool.query(`SELECT user_id FROM shop_orders WHERE id = $1`, [orderId]);
  const order = orderResult.rows[0];
  if (!order) throw new Error("Order not found.");
  if (Number(order.user_id) !== Number(ownerId)) {
    throw new Error("Order does not belong to this project participant.");
  }

  const rejectedOrder = await rejectShopOrderWithRefund(orderId);
  const refreshed = await getParticipantPendingOrdersForReview(projectId);
  return { order: toReviewParticipantShopOrder(rejectedOrder), ...refreshed };
}

export async function patchAdminReviewProjectFlags(projectId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const hasFraud =
    input.fraudFlag !== undefined || input.fraud_flag !== undefined || input.fraud !== undefined;
  if (!hasFraud) {
    throw new Error("Nothing to update.");
  }

  const fraudFlag = Boolean(input.fraudFlag ?? input.fraud_flag ?? input.fraud);
  const result = await pool.query(
    `
      UPDATE projects
      SET fraud_flag = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id
    `,
    [fraudFlag, projectId]
  );

  if (!result.rows[0]) {
    throw new Error("Project not found.");
  }

  return getAdminReviewProject(projectId);
}

export async function deleteProjectBySuperadmin(projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const row = await getProjectRowForAirtableSync(projectId);
  if (!row) return false;

  await deleteProjectFromAirtable(row);
  await deleteProjectSubmissionsFromYsws(projectId);

  const result = await pool.query(`DELETE FROM projects WHERE id = $1`, [projectId]);
  return result.rowCount > 0;
}

export async function deleteProjectForUser(userId, projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const checkResult = await pool.query("SELECT shipped FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
  const project = checkResult.rows[0];

  if (!project) return false;
  if (project.shipped) throw new Error("Cannot delete a project that has been shipped.");

  const result = await pool.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
  return result.rowCount > 0;
}

export async function listJournalEntriesForUserProject(userId, projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const project = await getProjectRowForUser(userId, projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  const result = await pool.query(
    `
      SELECT journal_entries.*
      FROM journal_entries
      WHERE journal_entries.user_id = $1
        AND journal_entries.project_id = $2
      ORDER BY journal_entries.created_at DESC, journal_entries.id DESC
    `,
    [userId, projectId]
  );

  return result.rows.map((row) => toPublicJournalEntry(row, project));
}

export async function getPublicJournalingProject(projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const projectResult = await pool.query(
    `
      SELECT id, name, shipped_at
      FROM projects
      WHERE id = $1
        AND shipped IS TRUE
    `,
    [projectId]
  );
  const project = projectResult.rows[0];
  if (!project) return null;

  const entriesResult = await pool.query(
    `
      SELECT id, project_id, project_name, project_index, time_done, hours_worked,
             description, tools_used, created_at, updated_at
      FROM journal_entries
      WHERE project_id = $1
      ORDER BY COALESCE(time_done, created_at) ASC, id ASC
    `,
    [projectId]
  );

  return {
    project: {
      id: project.id,
      name: project.name,
      shippedAt: project.shipped_at,
    },
    journalEntries: entriesResult.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      projectIndex: row.project_index,
      timeDone: row.time_done,
      hoursWorked: Number(row.hours_worked ?? 0),
      description: row.description,
      toolsUsed: Array.isArray(row.tools_used) ? row.tools_used : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function listPublicJournalingProjects() {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(`
    SELECT
      projects.id AS project_id,
      projects.name AS project_name,
      projects.image_url,
      projects.shipped_at,
      journal_entries.id,
      journal_entries.project_index,
      journal_entries.time_done,
      journal_entries.hours_worked,
      journal_entries.description,
      journal_entries.tools_used,
      journal_entries.created_at,
      journal_entries.updated_at
    FROM projects
    JOIN journal_entries ON journal_entries.project_id = projects.id
    WHERE projects.shipped IS TRUE
    ORDER BY projects.shipped_at DESC NULLS LAST, projects.id DESC,
             COALESCE(journal_entries.time_done, journal_entries.created_at) ASC,
             journal_entries.id ASC
  `);

  const projects = new Map();
  for (const row of result.rows) {
    const key = String(row.project_id);
    if (!projects.has(key)) {
      projects.set(key, {
        id: row.project_id,
        name: row.project_name,
        imageUrl: row.image_url,
        shippedAt: row.shipped_at,
        journalEntries: [],
      });
    }
    projects.get(key).journalEntries.push({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      projectIndex: row.project_index,
      timeDone: row.time_done,
      hoursWorked: Number(row.hours_worked ?? 0),
      description: row.description,
      toolsUsed: Array.isArray(row.tools_used) ? row.tools_used : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  return [...projects.values()];
}

export async function updateJournalEntryForUser(userId, projectId, entryId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const project = await getProjectRowForUser(userId, projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  const existingResult = await pool.query(
    `
      SELECT journal_entries.*
      FROM journal_entries
      WHERE journal_entries.id = $1
        AND journal_entries.user_id = $2
        AND journal_entries.project_id = $3
    `,
    [entryId, userId, projectId]
  );
  const existing = existingResult.rows[0];
  if (!existing) {
    throw new Error("Journal entry not found.");
  }
  if (!isJournalEntryEditable(project, existing)) {
    throw new Error("This journal entry cannot be edited because it is part of a shipped submission.");
  }

  const journal = normalizeJournalEntryInput(input);
  assertJournalDescriptionMediaIsCdnOnly(journal.description);

  const mergedEntry = {
    time_done: journal.timeDone,
    created_at: existing.created_at,
  };
  if (!isJournalEntryEditable(project, mergedEntry)) {
    throw new Error("Time done must stay after your last ship date for editable entries.");
  }

  const result = await pool.query(
    `
      UPDATE journal_entries
      SET
        time_done = $4,
        hours_worked = $5,
        description = $6,
        tools_used = $7,
        project_name = $8,
        project_index = $9,
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND project_id = $3
      RETURNING *
    `,
    [
      entryId,
      userId,
      project.id,
      journal.timeDone,
      journal.hoursWorked,
      journal.description,
      JSON.stringify(journal.toolsUsed),
      project.name,
      project.project_index ?? 0,
    ]
  );

  const updatedProject = await refreshProjectJournalHours(userId, project.id);

  syncJournalEntryToAirtable(result.rows[0]).catch((err) => {
    console.error("[airtable] Failed to sync journal entry:", err.message);
  });

  return {
    entry: toPublicJournalEntry(result.rows[0], project),
    project: updatedProject,
  };
}

export async function createJournalEntryForUser(userId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const projectId = input.projectId ?? input.project_id;
  const project = await getProjectRowForUser(userId, projectId);
  if (!project) {
    throw new Error("Project not found.");
  }

  const journal = normalizeJournalEntryInput(input);
  assertJournalDescriptionMediaIsCdnOnly(journal.description);
  const result = await pool.query(
    `
      INSERT INTO journal_entries (
        user_id,
        project_id,
        project_name,
        project_index,
        time_done,
        hours_worked,
        description,
        tools_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      userId,
      project.id,
      project.name,
      project.project_index ?? 0,
      journal.timeDone,
      journal.hoursWorked,
      journal.description,
      JSON.stringify(journal.toolsUsed),
    ]
  );

  const updatedProject = await refreshProjectJournalHours(userId, project.id);

  syncJournalEntryToAirtable(result.rows[0]).catch((err) => {
    console.error("[airtable] Failed to sync journal entry:", err.message);
  });

  return {
    entry: toPublicJournalEntry(result.rows[0], project),
    project: updatedProject,
  };
}

export async function getJournalEntriesCsv() {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(`
    SELECT
      journal_entries.*,
      projects.name AS current_project_name,
      users.email AS user_email,
      users.slug AS user_display_name
    FROM journal_entries
    LEFT JOIN projects ON projects.id = journal_entries.project_id
    LEFT JOIN users ON users.id = journal_entries.user_id
    ORDER BY
      journal_entries.project_id NULLS LAST,
      journal_entries.project_name ASC,
      journal_entries.project_index ASC,
      journal_entries.created_at ASC
  `);

  return toCsv(
    [
      "project_id",
      "project_name_on_record",
      "project_name_stored_on_entry",
      "project_index",
      "user_id",
      "user_email",
      "user_display_name",
      "journal_entry_id",
      "time_done",
      "hours_worked",
      "description",
      "tools_used",
      "created_at",
      "updated_at",
    ],
    result.rows.map((row) => [
      row.project_id,
      row.current_project_name,
      row.project_name,
      row.project_index,
      row.user_id,
      row.user_email,
      row.user_display_name,
      row.id,
      toIsoString(row.time_done),
      row.hours_worked,
      row.description,
      Array.isArray(row.tools_used) ? row.tools_used.join("; ") : row.tools_used,
      toIsoString(row.created_at),
      toIsoString(row.updated_at),
    ])
  );
}

function normalizeHackatimeNames(input = {}) {
  const raw = input.hackatimeNames ?? input.hackatime_names ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((name) => String(name).trim()).filter(Boolean);
}

function safeHttpUrl(value) {
  const text = textOrNull(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`URL must use http or https (got ${parsed.protocol})`);
    }
    return text;
  } catch (e) {
    throw new Error(e.message || "Invalid URL.");
  }
}

function normalizeProjectInput(input = {}) {
  return {
    name: textOrNull(input.name),
    description: textOrNull(input.description),
    projectType: textOrNull(input.projectType ?? input.project_type),
    playableUrl: safeHttpUrl(input.playableUrl ?? input.playable_url),
    codeUrl: safeHttpUrl(input.codeUrl ?? input.code_url),
    imageUrl: safeHackClubCdnUrl(input.imageUrl ?? input.image_url),
    hackatimeNames: normalizeHackatimeNames(input),
  };
}

function parseHackatimeNames(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Recompute journal totals on every existing project (post-launch entries only). */
export async function refreshJournalHoursForAllUserProjects(userId) {
  if (!pool) return;

  const updated = await pool.query(
    `
      UPDATE projects
      SET
        total_hours = COALESCE((
          SELECT SUM(journal_entries.hours_worked)
          FROM journal_entries
          WHERE journal_entries.user_id = projects.user_id
            AND journal_entries.project_id = projects.id
            AND ${journalEntryAfterLaunchOn()}
        ), 0),
        updated_at = NOW()
      WHERE projects.user_id = $1
      RETURNING id
    `,
    [userId]
  );

  for (const row of updated.rows) {
    await trySyncProjectToAirtable(row.id);
  }
}

export async function refreshProjectHackatimeHoursForUser(userId, hackatimeProjects = null) {
  if (!pool) return;

  const tokenResult = await pool.query(
    `SELECT hackatime_access_token FROM users WHERE id = $1`,
    [userId]
  );
  const token = tokenResult.rows[0]?.hackatime_access_token;
  if (!token && !hackatimeProjects) return;

  const list = hackatimeProjects || (await fetchHackatimeProjectsForStack(token));
  const projectsResult = await pool.query(
    `SELECT id, hackatime_names FROM projects WHERE user_id = $1`,
    [userId]
  );

  for (const project of projectsResult.rows) {
    const names = parseHackatimeNames(project.hackatime_names);
    const hours = sumHackatimeHoursForNames(list, names);
    await pool.query(
      `UPDATE projects SET hackatime_hours = $1, updated_at = NOW() WHERE id = $2`,
      [hours, project.id]
    );
    await trySyncProjectToAirtable(project.id);
  }
}

/** Sync journal + Hackatime hours for all of a user's existing Stack projects. */
export async function syncAllProjectHoursForUser(userId, hackatimeProjects = null) {
  await refreshJournalHoursForAllUserProjects(userId);
  await refreshProjectHackatimeHoursForUser(userId, hackatimeProjects);
}

async function applyHackatimeHoursToProject(userId, projectId) {
  const tokenResult = await pool.query(
    `SELECT hackatime_access_token FROM users WHERE id = $1`,
    [userId]
  );
  const token = tokenResult.rows[0]?.hackatime_access_token;
  if (!token) return;

  const projectResult = await pool.query(
    `SELECT hackatime_names FROM projects WHERE id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  const names = parseHackatimeNames(projectResult.rows[0]?.hackatime_names);
  const list = await fetchHackatimeProjectsForStack(token);
  const hours = sumHackatimeHoursForNames(list, names);

  await pool.query(
    `UPDATE projects SET hackatime_hours = $1, updated_at = NOW() WHERE id = $2`,
    [hours, projectId]
  );
}

export async function getProjectForUser(userId, projectId) {
  const row = await getProjectRowForAirtableSync(projectId);
  if (!row || Number(row.user_id) !== Number(userId)) return null;
  await refreshProjectJournalHours(userId, projectId);
  await applyHackatimeHoursToProject(userId, projectId);
  const refreshed = await getProjectRowForAirtableSync(projectId);
  return toPublicProjectForUser(refreshed || row);
}

function validateProjectBasics(project) {
  if (!project.name) throw new Error("Project name is required.");
  if (!project.description) throw new Error("Project description is required.");
  if (!project.projectType) throw new Error("Project type is required.");
}

async function assertProjectNameAvailable(userId, projectName, exceptProjectId = null) {
  const result = await pool.query(
    `
      SELECT id
      FROM projects
      WHERE user_id = $1
        AND LOWER(name) = LOWER($2)
        AND ($3::bigint IS NULL OR id != $3::bigint)
      LIMIT 1
    `,
    [userId, projectName, exceptProjectId]
  );

  if (result.rows.length > 0) {
    throw new Error("You already have a project with that name.");
  }
}

function normalizeJournalEntryInput(input = {}) {
  const hoursWorked = Number.parseFloat(input.hoursWorked ?? input.hours_worked ?? 0);
  const toolsValue = input.toolsUsed ?? input.tools_used ?? [];
  const toolsUsed = Array.isArray(toolsValue)
    ? toolsValue.map((tool) => String(tool).trim()).filter(Boolean)
    : String(toolsValue)
        .split(",")
        .map((tool) => tool.trim())
        .filter(Boolean);

  return {
    timeDone: input.timeDone || input.time_done || new Date().toISOString(),
    hoursWorked: Number.isFinite(hoursWorked) && hoursWorked >= 0 ? hoursWorked : 0,
    description: textOrNull(input.description),
    toolsUsed,
  };
}

async function getProjectRowForUser(userId, projectId) {
  const result = await pool.query(
    `
      SELECT projects.*, project_order.project_index
      FROM projects
      JOIN (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) - 1 AS project_index
        FROM projects
        WHERE user_id = $1
      ) project_order ON project_order.id = projects.id
      WHERE projects.user_id = $1
        AND projects.id = $2
    `,
    [userId, projectId]
  );

  return result.rows[0] || null;
}

async function refreshProjectJournalHours(userId, projectId) {
  const result = await pool.query(
    `
      UPDATE projects
      SET
        total_hours = COALESCE((
          SELECT SUM(hours_worked)
          FROM journal_entries
          WHERE user_id = $1
            AND project_id = $2
            AND ${journalEntryAfterLaunchWhere()}
        ), 0),
        updated_at = NOW()
      WHERE user_id = $1
        AND id = $2
      RETURNING *, total_hours AS journal_hours
    `,
    [userId, projectId]
  );

  const row = result.rows[0];
  if (row) await trySyncProjectToAirtable(row.id);
  return row ? toPublicProjectForUser(row) : null;
}

async function refreshProjectJournalHoursWithClient(client, projectId) {
  await client.query(
    `
      UPDATE projects
      SET
        total_hours = COALESCE((
          SELECT SUM(hours_worked)
          FROM journal_entries
          WHERE journal_entries.user_id = projects.user_id
            AND journal_entries.project_id = projects.id
            AND ${journalEntryAfterLaunchOn()}
        ), 0),
        updated_at = NOW()
      WHERE id = $1
    `,
    [projectId]
  );
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundedHours(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
}

function journalHoursFromRow(row) {
  if (row.journal_hours != null && row.journal_hours !== undefined) {
    return numberOrZero(row.journal_hours);
  }
  return numberOrZero(row.total_hours);
}

function loggedHours(row) {
  return roundedHours(journalHoursFromRow(row) + numberOrZero(row.hackatime_hours));
}

function approvedBankedHours(row) {
  return roundedHours(Math.max(numberOrZero(row.past_approved_hours), numberOrZero(row.approved_hours)));
}

function previouslyShippedHours(row) {
  return roundedHours(Math.max(numberOrZero(row.last_shipped_hours), approvedBankedHours(row)));
}

function pendingReviewHours(row) {
  return Math.max(0, roundedHours(loggedHours(row) - previouslyShippedHours(row)));
}

function isReshipEligibleProject(project) {
  const status = String(project.status || "");
  return (status === "approved" && project.reviewed) || status === "reship-rejected";
}

function hoursRequiredToShip(project) {
  if (isReshipEligibleProject(project)) {
    return pendingReviewHours(project);
  }
  return loggedHours(project);
}

async function getProjectRowForAirtableSync(projectId) {
  if (!pool) return null;

  const result = await pool.query(
    `
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
        AND ${journalEntryAfterLaunchOn()}
      WHERE projects.id = $1
      GROUP BY projects.id, users.id
    `,
    [projectId]
  );

  return result.rows[0] ?? null;
}

async function trySubmitProjectToYsws(projectId, options = {}) {
  try {
    const result = await submitProjectToYsws(projectId, options);
    if (result.skipped) {
      console.warn("[projects] Airtable YSWS submit skipped:", {
        projectId,
        reason: result.reason,
        skippedAirtable: result.skippedAirtable,
      });
      return result;
    }
    console.log("[projects] Airtable YSWS submit:", {
      projectId,
      recordId: result.recordId,
      status: result.status,
      created: result.created,
    });
    return result;
  } catch (error) {
    console.error("[projects] Airtable YSWS submit failed:", {
      projectId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function trySyncApprovedYswsSubmission(projectId) {
  try {
    const result = await syncApprovedYswsSubmissionForProject(projectId);
    if (result.skipped) {
      console.warn("[projects] Airtable YSWS approved sync skipped:", {
        projectId,
        reason: result.reason,
        skippedAirtable: result.skippedAirtable,
      });
      return result;
    }
    console.log("[projects] Airtable YSWS approved sync:", {
      projectId,
      recordId: result.recordId,
      status: result.status,
      created: result.created,
    });
    return result;
  } catch (error) {
    console.error("[projects] Airtable YSWS approved sync failed:", {
      projectId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function trySyncProjectToAirtable(projectId) {
  try {
    const row = await getProjectRowForAirtableSync(projectId);
    if (!row) return;

    const result = await syncProjectToAirtable(row);
    if (result.ok && result.recordId) {
      await persistProjectAirtableRecordId(projectId, result.recordId);
    }
    if (!result.skipped) {
      console.log("[projects] Airtable _projects sync:", {
        projectId,
        created: result.created,
        recordId: result.recordId,
      });
    }
  } catch (error) {
    console.error("[projects] Airtable _projects sync failed:", {
      projectId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function toPublicReviewFeedback(row) {
  return {
    id: row.id,
    outcome: row.outcome,
    feedback: row.feedback,
    hours: row.hours != null ? Number(row.hours) : null,
    reductionHours: row.reduction_hours != null ? Number(row.reduction_hours) : null,
    createdAt: row.created_at,
  };
}

function toPublicProject(row) {
  const journalHours = Number(row.journal_hours ?? row.total_hours ?? 0);
  const hackatimeHours = Number(row.hackatime_hours ?? 0);
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    projectType: row.project_type,
    playableUrl: row.playable_url,
    codeUrl: row.code_url,
    imageUrl: row.image_url,
    hackatimeNames: row.hackatime_names || [],
    status: row.status,
    shipped: row.shipped,
    reviewed: row.reviewed,
    totalHours: Number(row.total_hours ?? 0),
    journalHours,
    hackatimeHours,
    combinedHours: Number((journalHours + hackatimeHours).toFixed(2)),
    baselineHours: row.baseline_hours != null ? Number(row.baseline_hours) : null,
    lastShippedHours: previouslyShippedHours(row),
    approvedHours: Number(row.approved_hours ?? 0),
    pastApprovedHours: approvedBankedHours(row),
    coinsEarned: Number(row.coins_earned ?? 0),
    adminFeedback: row.admin_feedback,
    hourJustification: row.hour_justification,
    reviewedAt: row.reviewed_at,
    reviewedByUserId: row.reviewed_by_user_id,
    shippedAt: row.shipped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    fraudFlag: Boolean(row.fraud_flag),
    blocked: Boolean(row.blocked),
    shipKind: row.ship_kind || "initial",
    reshipUpdate: textOrNull(row.reship_update),
    parentProjectId: row.parent_project_id != null ? Number(row.parent_project_id) : null,
  };
}

function toAdminReviewProject(row) {
  const project = toPublicProject(row);
  return {
    ...project,
    user: {
      id: row.user_id,
      email: row.user_email,
      slug: row.user_slug,
      profileImageUrl: row.user_profile_image_url,
      slackId: row.user_slack_id,
    },
    pendingReviewHours: pendingReviewHours(row),
  };
}

function isPendingReviewProject(project) {
  if (project.reviewed) return false;

  const status = String(project.status || "").toLowerCase();
  if (status === "in-review" && project.shipped) return true;
  if (status === "pending-reship") return true;

  return project.shipped && project.shipKind === "reship";
}

function journalEntryTimestamp(row) {
  const value = row.time_done ?? row.created_at;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isJournalEntryEditable(projectRow, entryRow) {
  if (!projectRow || !entryRow) return false;
  if (projectRow.blocked) return false;
  if (
    isPendingReviewProject({
      reviewed: projectRow.reviewed,
      status: projectRow.status,
      shipped: projectRow.shipped,
      shipKind: projectRow.ship_kind,
    })
  ) {
    return false;
  }

  if (!projectRow.shipped || !projectRow.shipped_at) return true;

  const entryAt = journalEntryTimestamp(entryRow);
  const shippedAt =
    projectRow.shipped_at instanceof Date ? projectRow.shipped_at : new Date(projectRow.shipped_at);
  if (!entryAt || Number.isNaN(shippedAt.getTime())) return true;

  return entryAt > shippedAt;
}

function getShipMissingRequirements(project) {
  const missing = [];
  // Block shipping only if already shipped but not in a valid state for re-shipping
  if (
    project.shipped &&
    project.status !== "approved" &&
    project.status !== "rejected" &&
    project.status !== "reship-rejected"
  ) {
    missing.push("already shipped");
  }
  if (!textOrNull(project.playable_url)) missing.push("playable URL missing");
  if (!textOrNull(project.code_url)) missing.push("code URL missing");
  if (!textOrNull(project.image_url)) {
    missing.push("project image missing");
  } else if (!isHackClubCdnUrl(project.image_url)) {
    missing.push("project image must be a Hack Club CDN link");
  }
  const shipHours = hoursRequiredToShip(project);
  if (shipHours < MIN_SHIP_LOGGED_HOURS) {
    missing.push(
      isReshipEligibleProject(project)
        ? "at least 1 new hour must be logged before re-shipping"
        : "at least 1 hour of work must be logged before shipping"
    );
  }
  return missing;
}

function toPublicJournalEntry(row, projectRow = null) {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectIndex: row.project_index,
    timeDone: row.time_done,
    hoursWorked: Number(row.hours_worked ?? 0),
    description: row.description,
    toolsUsed: row.tools_used || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editable: projectRow ? isJournalEntryEditable(projectRow, row) : false,
  };
}

function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  if (value === undefined || value === null) return "";
  let text = String(value);
  // Neutralize spreadsheet formula injection (=, +, -, @, tab, carriage-return as first char)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function toIsoString(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

