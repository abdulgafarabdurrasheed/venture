import { pool } from "./db.js";

/**
 * Airtable `_projects`
 *
 * | Logical           | Airtable field    |
 * |-------------------|-------------------|
 * | name              | Name              |
 * | description       | Description       |
 * | type              | Type              |
 * | codeUrl           | Code URL          |
 * | playableUrl       | Playable URL      |
 * | shipped           | Shipped           |
 * | status            | Status            |
 * | approvedHours     | Approved Hours    |
 * | coinsEarned      | Coins Earned     |
 * | reviewed          | Reviewed          |
 * | hackatimeProjects | Hackatime Projects|
 * | shippedAt         | Shipped At        |
 * | reviewedAt        | Reviewed At       |
 * | adminFeedback     | Admin Feedback    |
 * | bannerUrl         | Banner URL        |
 * | hackatimeHours    | Hackatime Hours   |
 * | totalHours        | Total Hours       |
 * | createdAt         | Created At        |
 * | userSlackId       | User Slack ID     |
 * | userEmail         | User Email        |
 */
export const F = {
  name: "Name",
  description: "Description",
  type: "Type",
  codeUrl: "Code URL",
  playableUrl: "Playable URL",
  shipped: "Shipped",
  status: "Status",
  approvedHours: "Approved Hours",
  coinsEarned: "Coins Earned",
  reviewed: "Reviewed",
  hackatimeProjects: "Hackatime Projects",
  shippedAt: "Shipped At",
  reviewedAt: "Reviewed At",
  adminFeedback: "Admin Feedback",
  bannerUrl: "Banner URL",
  hackatimeHours: "Hackatime Hours",
  totalHours: "Total Hours",
  createdAt: "Created At",
  userSlackId: "User Slack ID",
  userEmail: "User Email",
};

const airtableToken =
  process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
const airtableBaseId =
  process.env.AIRTABLE_PROJECTS_BASE_ID || process.env.AIRTABLE_APP || process.env.AIRTABLE_BASE_ID;
const projectsTableId = process.env.AIRTABLE_PROJECTS_TABLE_ID || "_projects";

export const hasAirtableProjectsConfig = Boolean(airtableToken && airtableBaseId);

function getProjectsTableUrl() {
  return `https://api.airtable.com/v0/${airtableBaseId}/${projectsTableId}`;
}

function getAirtableHeaders() {
  return {
    Authorization: `Bearer ${airtableToken}`,
    "Content-Type": "application/json",
  };
}

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formulaField(fieldName) {
  const escaped = fieldName.replace(/\\/g, "\\\\").replace(/}/g, "\\}");
  return `{${escaped}\}`;
}

function airtableDate(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** journal + hackatime (hackatime not wired yet — 0). */
export function combinedLoggedHours(row) {
  const journal = numberOrZero(row.journal_hours ?? row.total_hours);
  const hackatime = numberOrZero(row.hackatime_hours);
  return Number((journal + hackatime).toFixed(2));
}

/**
 * Immutable Airtable Total Hours: frozen baseline after first approval, else live combined hours.
 */
export function airtableTotalHours(row) {
  const baseline = row.baseline_hours;
  if (baseline !== null && baseline !== undefined && Number.isFinite(Number(baseline))) {
    return Number(Number(baseline).toFixed(2));
  }
  return combinedLoggedHours(row);
}

export function mapProjectStatusToAirtable(row) {
  const status = String(row.status || "").toLowerCase();
  if (status === "approved") return "approved";
  if (status === "rejected" || status === "reship-rejected" || status === "blocked") return "rejected";
  if (status === "pending-reship" || status === "in-review" || (row.shipped && !row.reviewed)) {
    return "review";
  }
  return "pending";
}

function approvedBankedHours(row) {
  return Number(Math.max(numberOrZero(row.past_approved_hours), numberOrZero(row.approved_hours)).toFixed(2));
}

/** Cumulative approved hours in Airtable — banked total when not currently fully approved. */
export function airtableApprovedHours(row) {
  if (isProjectFullyApproved(row)) {
    return Number(row.approved_hours ?? 0);
  }
  const banked = approvedBankedHours(row);
  return banked > 0 ? banked : 0;
}

function hackatimeProjectsLabel(row) {
  const names = row.hackatime_names;
  if (Array.isArray(names) && names.length > 0) {
    return names.map((name) => String(name).trim()).filter(Boolean).join(", ");
  }
  return "";
}

export function isProjectFullyApproved(row) {
  return (
    String(row.status || "").toLowerCase() === "approved" &&
    Boolean(row.shipped) &&
    Boolean(row.reviewed)
  );
}

function buildFieldsFromProjectRow(row) {
  const approvedHours = airtableApprovedHours(row);
  const fields = {
    [F.name]: row.name,
    [F.description]: row.description || undefined,
    [F.type]: row.project_type || undefined,
    [F.codeUrl]: row.code_url || undefined,
    [F.playableUrl]: row.playable_url || undefined,
    [F.shipped]: Boolean(row.shipped),
    [F.status]: mapProjectStatusToAirtable(row),
    [F.approvedHours]: approvedHours,
    [F.coinsEarned]: numberOrZero(row.coins_earned),
    [F.reviewed]: Boolean(row.reviewed),
    [F.hackatimeProjects]: hackatimeProjectsLabel(row) || undefined,
    [F.shippedAt]: airtableDate(row.shipped_at),
    [F.reviewedAt]: airtableDate(row.reviewed_at),
    [F.adminFeedback]: row.admin_feedback || undefined,
    [F.bannerUrl]: row.image_url || undefined,
    [F.hackatimeHours]: numberOrZero(row.hackatime_hours),
    [F.totalHours]: airtableTotalHours(row),
    [F.createdAt]: airtableDate(row.created_at),
    [F.userSlackId]: row.user_slack_id || undefined,
    [F.userEmail]: row.user_email || undefined,
  };

  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) {
      delete fields[key];
    }
  }

  return fields;
}

async function airtableRequest(path, options = {}) {
  const response = await fetch(`${getProjectsTableUrl()}${path}`, {
    ...options,
    headers: {
      ...getAirtableHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || text || response.statusText;
    throw new Error(`Airtable projects request failed (${response.status}): ${message}`);
  }

  return data;
}

async function findProjectRecord({ name, userEmail, airtableRecordId }) {
  if (airtableRecordId) {
    try {
      const data = await airtableRequest(`/${airtableRecordId}`);
      if (data?.id) return data;
    } catch {
      // fall through to name/email lookup
    }
  }

  if (!name || !userEmail) {
    return null;
  }

  const formula = `AND(${formulaField(F.name)}='${escapeFormulaString(name)}',${formulaField(F.userEmail)}='${escapeFormulaString(userEmail)}')`;
  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
  });

  const data = await airtableRequest(`?${params.toString()}`);
  return data.records?.[0] ?? null;
}

/**
 * Upsert one project row (Postgres shape + user_email, user_slack_id, journal_hours) into Airtable `_projects`.
 */
export async function syncProjectToAirtable(row) {
  if (!hasAirtableProjectsConfig) {
    return { ok: false, skipped: true, reason: "Airtable not configured." };
  }

  if (!row?.id) {
    return { ok: false, skipped: true, reason: "Missing project id." };
  }

  const fields = buildFieldsFromProjectRow(row);
  const existing = await findProjectRecord({
    name: row.name,
    userEmail: row.user_email,
    airtableRecordId: row.airtable_record_id,
  });

  if (existing?.id) {
    const data = await airtableRequest(`/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });

    return {
      ok: true,
      created: false,
      recordId: data.id,
      postgresProjectId: row.id,
    };
  }

  const data = await airtableRequest("", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  return {
    ok: true,
    created: true,
    recordId: data.id,
    postgresProjectId: row.id,
  };
}

export async function deleteProjectFromAirtable(row) {
  if (!hasAirtableProjectsConfig) {
    return { ok: true, skipped: true, reason: "Airtable not configured." };
  }

  if (!row?.id) {
    return { ok: false, skipped: true, reason: "Missing project id." };
  }

  const existing = await findProjectRecord({
    name: row.name,
    userEmail: row.user_email,
    airtableRecordId: row.airtable_record_id,
  });

  if (!existing?.id) {
    return { ok: true, skipped: true, reason: "Airtable project record not found." };
  }

  try {
    await airtableRequest(`/${existing.id}`, { method: "DELETE" });
  } catch (error) {
    if (!/404|NOT_FOUND/i.test(String(error.message))) {
      throw error;
    }
  }

  return {
    ok: true,
    skipped: false,
    recordId: existing.id,
    postgresProjectId: row.id,
  };
}

export async function persistProjectAirtableRecordId(projectId, recordId) {
  if (!pool || !projectId || !recordId) return;
  await pool.query(
    `
      UPDATE projects
      SET airtable_record_id = $1, updated_at = NOW()
      WHERE id = $2
        AND (airtable_record_id IS NULL OR airtable_record_id != $1)
    `,
    [recordId, projectId]
  );
}
