import { pool } from "./db.js";
import { refreshHackatimeGithubUsernameForUser } from "./hackatimeGithubUsername.js";
import { STACK_LAUNCH_UTC } from "./hackatimeAuth.js";
import { buildYswsOverrideHoursJustification } from "./hourJustification.js";
import { buildJournalShareUrl } from "./journalShare.js";

const STACK_SHARED_YSWS_TABLE_ID = "tbl3EAvXrfhIkvLNp";
const DEFAULT_YSWS_TABLE_NAME = "YSWS Project Submission";

const STACK_FIELD_IDS = {
  codeUrl: "fldtr7fFjiivNl9T3",
  playableUrl: "fldfQ3F8R85jbolqa",
  firstName: "fldMNotCOmz9VjyV2",
  lastName: "fldNy8Bphu016COq2",
  email: "fldT7K3i5fXr9QhAl",
  screenshot: "fld9gXXU2IldSupLf",
  description: "fldbmLOboSDNuIwJ0",
  githubUsername: "fldBjgLezs9oxry9F",
  addressLine1: "fldR0FpeqHVEbH152",
  addressLine2: "fldDsc5lG6lQHOUvE",
  city: "fldqSLEbpf1vYzHDR",
  stateProvince: "fldOYj6uuGMTtp1P8",
  country: "fldAXAqf1UzvtiP3X",
  zip: "fldMfxehlHGGNssQa",
  birthday: "fldpBKxkhLlzhJsSY",
  overrideHours: "fldJgHp4dZbet58u6",
  overrideHoursJustification: "fldVfLaSZWGc3rZq3",
  status: process.env.AIRTABLE_YSWS_STATUS_FIELD_ID || "Status",
  update: process.env.AIRTABLE_YSWS_UPDATE_FIELD_ID || "Update",
};

const STANDARD_FIELD_NAMES = {
  codeUrl: "Code URL",
  playableUrl: "Playable URL",
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  screenshot: "Screenshot",
  description: "Description",
  githubUsername: "GitHub Username",
  addressLine1: "Address (Line 1)",
  addressLine2: "Address (Line 2)",
  city: "City",
  stateProvince: "State / Province",
  country: "Country",
  zip: "ZIP / Postal Code",
  birthday: "Birthday",
  overrideHours: "Optional - Override Hours Spent",
  overrideHoursJustification: "Optional - Override Hours Spent Justification",
  status: process.env.AIRTABLE_YSWS_STATUS_FIELD_NAME || "Status",
  update: "Update",
};

const airtableToken =
  process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;

function resolveYswsAirtableTarget() {
  const fallbackBase = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_APP || "";
  let configuredBase =
    process.env.AIRTABLE_YSWS_BASE_ID || process.env.AIRTABLE_APP || process.env.AIRTABLE_BASE_ID || "";
  const configuredTableId = process.env.AIRTABLE_YSWS_PROJECT_SUBMISSION_TABLE_ID || "";
  const configuredTableName =
    process.env.AIRTABLE_YSWS_PROJECT_SUBMISSION_TABLE_NAME ||
    process.env.AIRTABLE_YSWS_TABLE_NAME ||
    "";
  const warnings = [];

  let tableTarget = configuredTableId || configuredTableName || DEFAULT_YSWS_TABLE_NAME;

  // Common mistake: table ID (tbl…) placed in the base env var.
  if (configuredBase.startsWith("tbl")) {
    if (!configuredTableId && !configuredTableName) {
      tableTarget = configuredBase;
      configuredBase = fallbackBase;
      warnings.push(
        "AIRTABLE_YSWS_BASE_ID looked like a table ID (tbl…); using it as the YSWS table. Set AIRTABLE_BASE_ID=app… for the base."
      );
    } else {
      configuredBase = fallbackBase;
      warnings.push(
        "AIRTABLE_YSWS_BASE_ID looked like a table ID (tbl…); ignored it in favor of AIRTABLE_BASE_ID."
      );
    }
  }

  const baseId = configuredBase;
  const useStackFieldIds =
    tableTarget === STACK_SHARED_YSWS_TABLE_ID &&
    process.env.AIRTABLE_YSWS_USE_FIELD_NAMES !== "1" &&
    process.env.AIRTABLE_YSWS_USE_FIELD_NAMES !== "true";

  if (!baseId.startsWith("app")) {
    warnings.push("Airtable base ID should start with app… (set AIRTABLE_BASE_ID).");
  }

  return {
    baseId,
    table: tableTarget,
    tableKind: tableTarget.startsWith("tbl") ? "id" : "name",
    warnings,
    fieldMode: useStackFieldIds ? "ids" : "names",
  };
}

const yswsTarget = resolveYswsAirtableTarget();
const airtableBaseId = yswsTarget.baseId;
const yswsTableTarget = yswsTarget.table;

/** Canonical YSWS column labels used to match fields in any copy of the submission table. */
const CANONICAL_FIELD_LABELS = {
  codeUrl: ["Code URL"],
  playableUrl: ["Playable URL"],
  firstName: ["First Name"],
  lastName: ["Last Name"],
  email: ["Email"],
  screenshot: ["Screenshot"],
  description: ["Description"],
  githubUsername: [
    "GitHub Username",
    "Github Username",
    "GitHub user",
    "Github user",
    "GitHub",
    "Github",
  ],
  addressLine1: ["Address (Line 1)", "Address Line 1"],
  addressLine2: ["Address (Line 2)", "Address Line 2"],
  city: ["City"],
  stateProvince: ["State / Province", "State/Province", "State Province"],
  country: ["Country"],
  zip: ["ZIP / Postal Code", "Zip / Postal Code", "ZIP"],
  birthday: ["Birthday"],
  overrideHours: ["Optional - Override Hours Spent", "Override Hours"],
  overrideHoursJustification: [
    "Optional - Override Hours Spent Justification",
    "Override Hours Spent Justification",
    "Override Hours Justification",
  ],
  status: [
    process.env.AIRTABLE_YSWS_STATUS_FIELD_NAME || "Status",
    "Submission Status",
    "Project Status",
    "YSWS Status",
  ],
  update: ["Update"],
};

/** Fuzzy matchers when exact labels differ between YSWS table copies. */
const FIELD_FALLBACK_MATCHERS = {
  addressLine1: (name) => /address\s*\(\s*line\s*1\s*\)/i.test(name) || /address.*line.*1/i.test(name),
  addressLine2: (name) => /address\s*\(\s*line\s*2\s*\)/i.test(name) || /address.*line.*2/i.test(name),
  overrideHours: (name) => /override.*hours/i.test(name) && !/justification/i.test(name),
  status: (name) => /\bstatus\b/i.test(name),
  githubUsername: (name) => /github/i.test(name) && /user/i.test(name),
};

function resolveSchemaField(byName, labels) {
  for (const label of labels) {
    const field = byName.get(String(label).toLowerCase());
    if (field) return field;
  }
  return null;
}

function applyFieldFallbacks(table, map) {
  for (const [key, matcher] of Object.entries(FIELD_FALLBACK_MATCHERS)) {
    if (map[key]) continue;
    const field = (table.fields || []).find((entry) => matcher(entry.name));
    if (field) map[key] = field.id;
  }
}

function missingCanonicalLabels(map) {
  return Object.entries(CANONICAL_FIELD_LABELS)
    .filter(([key]) => !map[key])
    .map(([, labels]) => labels[0]);
}

let cachedFieldMap = null;
let cachedFieldMapMeta = null;
let fieldMapLoadError = null;

export const hasAirtableYswsConfig = Boolean(airtableToken && airtableBaseId?.startsWith("app"));

async function fetchYswsTableSchema() {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${airtableBaseId}/tables`, {
    headers: getAirtableHeaders(),
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
    throw new Error(`Airtable schema request failed (${response.status}): ${message}`);
  }

  const table = (data.tables || []).find(
    (entry) =>
      entry.id === yswsTableTarget ||
      entry.name === yswsTableTarget ||
      entry.name?.toLowerCase() === String(yswsTableTarget).toLowerCase()
  );
  if (!table) {
    const available = (data.tables || []).map((entry) => `${entry.name} (${entry.id})`).join(", ");
    throw new Error(
      `YSWS table "${yswsTableTarget}" not found in base ${airtableBaseId}. Available: ${available || "none"}`
    );
  }
  return table;
}

async function loadYswsFieldMap() {
  if (cachedFieldMap) return cachedFieldMap;
  if (fieldMapLoadError) throw fieldMapLoadError;

  if (!hasAirtableYswsConfig) {
    throw new Error("Airtable YSWS not configured.");
  }

  if (yswsTarget.fieldMode === "ids" && yswsTableTarget === STACK_SHARED_YSWS_TABLE_ID) {
    cachedFieldMap = STACK_FIELD_IDS;
    cachedFieldMapMeta = { mode: "stack-ids", resolved: Object.keys(STACK_FIELD_IDS).length, missing: [] };
    return cachedFieldMap;
  }

  try {
    const table = await fetchYswsTableSchema();
    const byName = new Map((table.fields || []).map((field) => [field.name.toLowerCase(), field]));
    const map = {};

    for (const [key, labels] of Object.entries(CANONICAL_FIELD_LABELS)) {
      const field = resolveSchemaField(byName, labels);
      if (field) {
        map[key] = field.id;
      }
    }

    applyFieldFallbacks(table, map);
    const missing = missingCanonicalLabels(map);

    if (Object.keys(map).length === 0) {
      throw new Error(`No matching YSWS fields found on table "${table.name}".`);
    }

    cachedFieldMap = map;
    cachedFieldMapMeta = {
      mode: "schema-ids",
      tableName: table.name,
      resolved: Object.keys(map).length,
      missing,
      availableFieldNames: (table.fields || []).map((field) => field.name),
    };

    if (missing.length > 0) {
      console.warn(`[ysws] Airtable table "${table.name}" missing optional fields: ${missing.join(", ")}`);
    } else {
      console.log(`[ysws] Resolved ${Object.keys(map).length} YSWS field IDs from table "${table.name}".`);
    }

    return cachedFieldMap;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[ysws] Schema lookup failed, falling back to field names: ${message}`);
    cachedFieldMap = STANDARD_FIELD_NAMES;
    cachedFieldMapMeta = {
      mode: "names-fallback",
      resolved: Object.keys(STANDARD_FIELD_NAMES).length,
      missing: [],
      schemaError: message,
    };
    return cachedFieldMap;
  }
}

export function getYswsAirtableConfigStatus() {
  return {
    configured: hasAirtableYswsConfig,
    baseId: airtableBaseId || null,
    table: yswsTableTarget,
    tableKind: yswsTarget.tableKind,
    fieldMode: cachedFieldMapMeta?.mode || yswsTarget.fieldMode,
    fieldResolution: cachedFieldMapMeta,
    fieldMapError: fieldMapLoadError ? String(fieldMapLoadError.message || fieldMapLoadError) : null,
    warnings: yswsTarget.warnings,
  };
}

if (yswsTarget.warnings.length > 0) {
  for (const warning of yswsTarget.warnings) {
    console.warn(`[ysws] ${warning}`);
  }
}

export const YSWS_STATUS = {
  approved: "Approved",
  pending: "Pending",
  pendingReship: "Pending-reship",
};

function getYswsTablePath() {
  return yswsTableTarget.startsWith("tbl") ? yswsTableTarget : encodeURIComponent(yswsTableTarget);
}

function getYswsTableUrl() {
  return `https://api.airtable.com/v0/${airtableBaseId}/${getYswsTablePath()}`;
}

function getAirtableHeaders() {
  return {
    Authorization: `Bearer ${airtableToken}`,
    "Content-Type": "application/json",
  };
}

async function airtableRequest(path, options = {}) {
  const response = await fetch(`${getYswsTableUrl()}${path}`, {
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
    throw new Error(`Airtable YSWS request failed (${response.status}): ${message}`);
  }

  return data;
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

function roundedHours(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
}

function yswsHackatimeProjectNames(project) {
  let names = project.hackatime_names;
  if (typeof names === "string") {
    try {
      names = JSON.parse(names);
    } catch {
      names = [];
    }
  }

  const normalized = (Array.isArray(names) ? names : [])
    .map((name) => String(name).trim())
    .filter(Boolean);
  if (normalized.length > 0) return normalized;

  const fallbackName = String(project.name || project.project_name || "").trim();
  return fallbackName ? [fallbackName] : [];
}

function extractIdentity(rawProfile) {
  if (!rawProfile || typeof rawProfile !== "object") return {};
  if (rawProfile.identity && typeof rawProfile.identity === "object") {
    return rawProfile.identity;
  }
  return rawProfile;
}

function extractAddress(identity) {
  const address = identity?.address || identity?.addresses?.[0] || {};
  if (typeof address === "string") {
    return { line1: address };
  }
  return {
    line1: address.line_1 ?? address.line1 ?? address.street ?? address.street_address ?? null,
    line2: address.line_2 ?? address.line2 ?? address.street2 ?? null,
    city: address.city ?? address.locality ?? null,
    stateProvince: address.state ?? address.region ?? address.province ?? null,
    country: address.country ?? address.country_name ?? null,
    zip: address.zip ?? address.postal_code ?? address.postcode ?? null,
  };
}

function githubFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const sshMatch = trimmed.match(/^git@(?:www\.)?github\.com:([^/]+)/i);
  if (sshMatch?.[1]) {
    const username = sshMatch[1].replace(/^@/, "").replace(/\.git$/i, "");
    return username || null;
  }

  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!/(?:^|\.)github\.com$/i.test(parsed.hostname)) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const username = segments[0]?.replace(/^@/, "") || null;
    return username || null;
  } catch {
    return null;
  }
}

function resolveGithubUsername({ hackatimeUsername, codeUrl }) {
  const fromHackatime = String(hackatimeUsername || "").trim().replace(/^@/, "");
  if (fromHackatime) return fromHackatime;
  return githubFromUrl(codeUrl);
}

function totalLoggedHours(project) {
  return roundedHours(numberOrZero(project.total_hours) + numberOrZero(project.hackatime_hours));
}

function approvedBankedHours(project) {
  return roundedHours(Math.max(numberOrZero(project.past_approved_hours), numberOrZero(project.approved_hours)));
}

function previouslyShippedHours(project) {
  return roundedHours(Math.max(numberOrZero(project.last_shipped_hours), approvedBankedHours(project)));
}

function pendingHours(project) {
  return Math.max(0, roundedHours(totalLoggedHours(project) - previouslyShippedHours(project)));
}

function yswsStatusForProject(project) {
  const status = String(project.status || "").toLowerCase();

  if (status === "approved" && project.reviewed) return YSWS_STATUS.approved;
  if (status === "pending-reship" || project.ship_kind === "reship") return YSWS_STATUS.pendingReship;
  if (status === "in-review" && project.shipped && !project.reviewed) return YSWS_STATUS.pending;
  return null;
}

function yswsHoursForProject(project, status) {
  if (status === YSWS_STATUS.approved) return roundedHours(project.approved_hours);
  return pendingHours(project);
}

function yswsJustificationForProject(project, status) {
  const usedJournaling = numberOrZero(project.total_hours) > 0;
  const rawHours = totalLoggedHours(project);
  const approvedHours = yswsHoursForProject(project, status);
  const hasDeflation =
    status === YSWS_STATUS.approved && approvedHours + 1e-9 < rawHours;

  return buildYswsOverrideHoursJustification({
    hackatimeUserId: project.user_hackatime_id,
    hackatimeNames: yswsHackatimeProjectNames(project),
    rawHours,
    approvedHours,
    startDate: STACK_LAUNCH_UTC,
    endDate: project.shipped_at,
    usedJournaling,
    deflationJustification: hasDeflation ? project.admin_feedback : null,
    projectPageUrl: project.playable_url,
    journalingUrl: usedJournaling ? buildJournalShareUrl(project.id) : null,
  });
}

function buildSubmissionFromContext({ project, user, status }) {
  const identity = extractIdentity(user.raw_profile);
  const address = extractAddress(identity);
  const firstName = identity.first_name ?? identity.firstName ?? null;
  const lastName = identity.last_name ?? identity.lastName ?? null;
  const birthday = identity.birthdate ?? identity.birthday ?? identity.dob ?? null;
  const githubUsername = resolveGithubUsername({
    hackatimeUsername: user.githubUsername,
    codeUrl: project.code_url,
  });
  const hours = yswsHoursForProject(project, status);

  return {
    project_id: project.id,
    user_id: project.user_id,
    project_name: project.name,
    code_url: project.code_url || null,
    playable_url: project.playable_url || null,
    first_name: firstName || null,
    last_name: lastName || null,
    email: user.email || null,
    screenshot_url: project.image_url || null,
    description: project.description || null,
    github_username: githubUsername || null,
    address_line1: address.line1 || null,
    address_line2: address.line2 || null,
    city: address.city || null,
    state_province: address.stateProvince || null,
    country: address.country || null,
    zip: address.zip || null,
    birthday: airtableDate(birthday) || null,
    override_hours: hours,
    override_hours_justification: yswsJustificationForProject(project, status),
    reship_update: project.reship_update || null,
    status,
    source_project_status: project.status || null,
    ship_kind: project.ship_kind || "initial",
    airtable_record_id: status === YSWS_STATUS.approved ? project.ysws_record_id || null : null,
  };
}

function assignAirtableField(fields, fieldId, value) {
  if (!fieldId || value === undefined || value === null) return;
  fields[fieldId] = value;
}

async function buildFieldsFromSubmission(submission, { includeJustification = true } = {}) {
  const fieldMap = await loadYswsFieldMap();
  const fields = {};

  assignAirtableField(fields, fieldMap.codeUrl, submission.code_url);
  assignAirtableField(fields, fieldMap.playableUrl, submission.playable_url);
  assignAirtableField(fields, fieldMap.firstName, submission.first_name);
  assignAirtableField(fields, fieldMap.lastName, submission.last_name);
  assignAirtableField(fields, fieldMap.email, submission.email);
  assignAirtableField(fields, fieldMap.description, submission.description);
  assignAirtableField(fields, fieldMap.githubUsername, submission.github_username);
  assignAirtableField(fields, fieldMap.addressLine1, submission.address_line1);
  assignAirtableField(fields, fieldMap.addressLine2, submission.address_line2);
  assignAirtableField(fields, fieldMap.city, submission.city);
  assignAirtableField(fields, fieldMap.stateProvince, submission.state_province);
  assignAirtableField(fields, fieldMap.country, submission.country);
  assignAirtableField(fields, fieldMap.zip, submission.zip);
  assignAirtableField(fields, fieldMap.birthday, airtableDate(submission.birthday));
  assignAirtableField(fields, fieldMap.overrideHours, roundedHours(submission.override_hours));
  if (includeJustification) {
    assignAirtableField(fields, fieldMap.overrideHoursJustification, submission.override_hours_justification);
  }
  assignAirtableField(fields, fieldMap.status, submission.status);

  const isReshipSubmission =
    submission.ship_kind === "reship" || submission.status === YSWS_STATUS.pendingReship;
  if (isReshipSubmission && submission.reship_update) {
    assignAirtableField(fields, fieldMap.update, submission.reship_update);
  }

  if (submission.screenshot_url && fieldMap.screenshot) {
    fields[fieldMap.screenshot] = [{ url: submission.screenshot_url }];
  }

  return fields;
}

export async function warmYswsFieldMap() {
  if (!hasAirtableYswsConfig) return null;
  return loadYswsFieldMap();
}

export async function ensureYswsProjectSubmissionsTable() {
  if (!pool) {
    console.warn("[ysws] DATABASE_URL not set; skipping YSWS submissions table setup.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ysws_project_submissions (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      project_name TEXT,
      code_url TEXT,
      playable_url TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      screenshot_url TEXT,
      description TEXT,
      github_username TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state_province TEXT,
      country TEXT,
      zip TEXT,
      birthday DATE,
      override_hours NUMERIC(10, 2) NOT NULL DEFAULT 0,
      override_hours_justification TEXT,
      reship_update TEXT,
      status TEXT NOT NULL,
      source_project_status TEXT,
      ship_kind TEXT,
      airtable_record_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const columns = {
    project_id: "BIGINT REFERENCES projects(id) ON DELETE CASCADE",
    user_id: "INTEGER REFERENCES users(id) ON DELETE SET NULL",
    project_name: "TEXT",
    code_url: "TEXT",
    playable_url: "TEXT",
    first_name: "TEXT",
    last_name: "TEXT",
    email: "TEXT",
    screenshot_url: "TEXT",
    description: "TEXT",
    github_username: "TEXT",
    address_line1: "TEXT",
    address_line2: "TEXT",
    city: "TEXT",
    state_province: "TEXT",
    country: "TEXT",
    zip: "TEXT",
    birthday: "DATE",
    override_hours: "NUMERIC(10, 2) NOT NULL DEFAULT 0",
    override_hours_justification: "TEXT",
    reship_update: "TEXT",
    status: "TEXT NOT NULL",
    source_project_status: "TEXT",
    ship_kind: "TEXT",
    airtable_record_id: "TEXT",
    created_at: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    updated_at: "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  };

  for (const [column, definition] of Object.entries(columns)) {
    await pool.query(`ALTER TABLE ysws_project_submissions ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ysws_project_submissions_project_status
    ON ysws_project_submissions(project_id, status)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ysws_project_submissions_status
    ON ysws_project_submissions(status)
  `);
}

async function getProjectContext(projectId) {
  if (!pool) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT projects.*, users.email AS user_email, users.raw_profile AS user_raw_profile,
             users.hackatime_github_username AS user_github_username,
             users.hackatime_user_id AS user_hackatime_id
      FROM projects
      JOIN users ON users.id = projects.user_id
      WHERE projects.id = $1
    `,
    [projectId]
  );
  const row = result.rows[0];
  return row || null;
}

async function deleteLocalSubmission(submission) {
  if (!submission) return;

  if (submission.airtable_record_id && hasAirtableYswsConfig) {
    try {
      await airtableRequest(`/${submission.airtable_record_id}`, { method: "DELETE" });
    } catch (error) {
      if (!/404|NOT_FOUND/i.test(String(error.message))) {
        throw error;
      }
    }
  }

  await pool.query("DELETE FROM ysws_project_submissions WHERE id = $1", [submission.id]);
}

async function findOpenYswsSubmission(projectId) {
  const result = await pool.query(
    `
      SELECT *
      FROM ysws_project_submissions
      WHERE project_id = $1
        AND status = ANY($2::text[])
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [projectId, [YSWS_STATUS.pending, YSWS_STATUS.pendingReship]]
  );
  return result.rows[0] || null;
}

async function deleteProjectSubmissions(projectId, statuses, { preserveAirtableRecordIds = [] } = {}) {
  const preserve = new Set(preserveAirtableRecordIds.filter(Boolean));
  const result = await pool.query(
    `
      SELECT *
      FROM ysws_project_submissions
      WHERE project_id = $1
        AND status = ANY($2::text[])
    `,
    [projectId, statuses]
  );

  for (const submission of result.rows) {
    if (submission.airtable_record_id && preserve.has(submission.airtable_record_id)) {
      await pool.query("DELETE FROM ysws_project_submissions WHERE id = $1", [submission.id]);
      continue;
    }
    await deleteLocalSubmission(submission);
  }
}

export async function deleteProjectSubmissionsFromYsws(projectId) {
  if (!pool) {
    return { ok: false, skipped: true, reason: "DATABASE_URL not set." };
  }

  const result = await pool.query(
    `
      SELECT *
      FROM ysws_project_submissions
      WHERE project_id = $1
    `,
    [projectId]
  );

  for (const submission of result.rows) {
    await deleteLocalSubmission(submission);
  }

  return { ok: true, deleted: result.rows.length };
}

async function upsertLocalSubmission(submission) {
  if (submission.status === YSWS_STATUS.approved) {
    const approvedResult = await pool.query(
      "SELECT * FROM ysws_project_submissions WHERE project_id = $1 AND status = $2",
      [submission.project_id, YSWS_STATUS.approved]
    );
    const existingApproved = approvedResult.rows[0];

    if (existingApproved) {
      submission.airtable_record_id =
        existingApproved.airtable_record_id || submission.airtable_record_id || null;
      const updated = await updateLocalSubmission(existingApproved.id, submission);
      return { ...updated, justification_status_changed: false };
    }

    const existingPending = await findOpenYswsSubmission(submission.project_id);

    if (existingPending) {
      submission.airtable_record_id =
        existingPending.airtable_record_id || submission.airtable_record_id || null;
      const updated = await updateLocalSubmission(existingPending.id, submission);
      return {
        ...updated,
        justification_status_changed: existingPending.status !== submission.status,
      };
    }
  }

  if (submission.status === YSWS_STATUS.pending || submission.status === YSWS_STATUS.pendingReship) {
    const existingOpen = await findOpenYswsSubmission(submission.project_id);
    if (existingOpen) {
      submission.airtable_record_id =
        existingOpen.airtable_record_id || submission.airtable_record_id || null;
      const updated = await updateLocalSubmission(existingOpen.id, submission);
      await pool.query(
        `
          DELETE FROM ysws_project_submissions
          WHERE project_id = $1
            AND status = ANY($2::text[])
            AND id != $3
        `,
        [submission.project_id, [YSWS_STATUS.pending, YSWS_STATUS.pendingReship], existingOpen.id]
      );
      return {
        ...updated,
        justification_status_changed: existingOpen.status !== submission.status,
      };
    }
  }

  const result = await pool.query(
    `
      INSERT INTO ysws_project_submissions (
        project_id,
        user_id,
        project_name,
        code_url,
        playable_url,
        first_name,
        last_name,
        email,
        screenshot_url,
        description,
        github_username,
        address_line1,
        address_line2,
        city,
        state_province,
        country,
        zip,
        birthday,
        override_hours,
        override_hours_justification,
        reship_update,
        status,
        source_project_status,
        ship_kind,
        airtable_record_id,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, NOW()
      )
      ON CONFLICT (project_id, status)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        project_name = EXCLUDED.project_name,
        code_url = EXCLUDED.code_url,
        playable_url = EXCLUDED.playable_url,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        screenshot_url = EXCLUDED.screenshot_url,
        description = EXCLUDED.description,
        github_username = EXCLUDED.github_username,
        address_line1 = EXCLUDED.address_line1,
        address_line2 = EXCLUDED.address_line2,
        city = EXCLUDED.city,
        state_province = EXCLUDED.state_province,
        country = EXCLUDED.country,
        zip = EXCLUDED.zip,
        birthday = EXCLUDED.birthday,
        override_hours = EXCLUDED.override_hours,
        override_hours_justification = EXCLUDED.override_hours_justification,
        reship_update = EXCLUDED.reship_update,
        source_project_status = EXCLUDED.source_project_status,
        ship_kind = EXCLUDED.ship_kind,
        airtable_record_id = COALESCE(ysws_project_submissions.airtable_record_id, EXCLUDED.airtable_record_id),
        updated_at = NOW()
      RETURNING *
    `,
    submissionValues(submission)
  );

  return { ...result.rows[0], justification_status_changed: true };
}

async function updateLocalSubmission(id, submission) {
  const result = await pool.query(
    `
      UPDATE ysws_project_submissions
      SET
        user_id = $2,
        project_name = $3,
        code_url = $4,
        playable_url = $5,
        first_name = $6,
        last_name = $7,
        email = $8,
        screenshot_url = $9,
        description = $10,
        github_username = $11,
        address_line1 = $12,
        address_line2 = $13,
        city = $14,
        state_province = $15,
        country = $16,
        zip = $17,
        birthday = $18,
        override_hours = $19,
        override_hours_justification = $20,
        reship_update = $21,
        status = $22,
        source_project_status = $23,
        ship_kind = $24,
        airtable_record_id = COALESCE(airtable_record_id, $25),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [id, ...submissionValues(submission).slice(1)]
  );

  return result.rows[0];
}

function submissionValues(submission) {
  return [
    submission.project_id,
    submission.user_id,
    submission.project_name,
    submission.code_url,
    submission.playable_url,
    submission.first_name,
    submission.last_name,
    submission.email,
    submission.screenshot_url,
    submission.description,
    submission.github_username,
    submission.address_line1,
    submission.address_line2,
    submission.city,
    submission.state_province,
    submission.country,
    submission.zip,
    submission.birthday,
    submission.override_hours,
    submission.override_hours_justification,
    submission.reship_update,
    submission.status,
    submission.source_project_status,
    submission.ship_kind,
    submission.airtable_record_id,
  ];
}

async function persistAirtableRecordId(submission, recordId) {
  if (!recordId || recordId === submission.airtable_record_id) return;

  await pool.query(
    `
      UPDATE ysws_project_submissions
      SET airtable_record_id = $1, updated_at = NOW()
      WHERE id = $2
    `,
    [recordId, submission.id]
  );

  if (submission.status === YSWS_STATUS.approved) {
    await pool.query(
      `UPDATE projects SET ysws_record_id = $1, updated_at = NOW() WHERE id = $2`,
      [recordId, submission.project_id]
    );
  }
}

async function syncSubmissionToAirtable(submission) {
  if (!hasAirtableYswsConfig) {
    return { ok: true, skipped: true, reason: "Airtable YSWS not configured.", submission };
  }

  const fields = await buildFieldsFromSubmission(submission, {
    includeJustification:
      !submission.airtable_record_id || Boolean(submission.justification_status_changed),
  });
  let response;
  let created = false;

  const payload = { fields, typecast: true };

  if (submission.airtable_record_id) {
    try {
      response = await airtableRequest(`/${submission.airtable_record_id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      if (/404|NOT_FOUND/i.test(String(error.message))) {
        created = true;
        const createFields = await buildFieldsFromSubmission(submission, {
          includeJustification: true,
        });
        response = await airtableRequest("", {
          method: "POST",
          body: JSON.stringify({ fields: createFields, typecast: true }),
        });
      } else {
        throw error;
      }
    }
  } else {
    created = true;
    response = await airtableRequest("", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  if (!response?.id) {
    throw new Error("Airtable YSWS write succeeded but returned no record id.");
  }

  await persistAirtableRecordId(submission, response.id);

  return { ok: true, recordId: response.id, created, submission };
}

export async function syncApprovedYswsSubmissionForProject(projectId) {
  if (!pool) {
    return { ok: false, skipped: true, reason: "DATABASE_URL not set." };
  }

  const ownerResult = await pool.query(`SELECT user_id FROM projects WHERE id = $1`, [projectId]);
  const ownerId = ownerResult.rows[0]?.user_id;
  if (ownerId) {
    await refreshHackatimeGithubUsernameForUser(ownerId, null, { force: true });
  }

  const row = await getProjectContext(projectId);
  if (!row) {
    return { ok: false, skipped: true, reason: "Project not found." };
  }

  if (roundedHours(row.approved_hours) <= 0) {
    return { ok: true, skipped: true, reason: "Project has no approved hours." };
  }

  const localSubmission = await upsertLocalSubmission(
    buildSubmissionFromContext({
      project: row,
      user: { email: row.user_email, raw_profile: row.user_raw_profile, githubUsername: row.user_github_username },
      status: YSWS_STATUS.approved,
    })
  );
  const airtableResult = await syncSubmissionToAirtable(localSubmission);

  if (hasAirtableYswsConfig && !airtableResult.skipped && !airtableResult.recordId) {
    throw new Error("YSWS approved row saved locally but Airtable record id was not persisted.");
  }

  return {
    ok: true,
    recordId: airtableResult.recordId,
    projectId,
    status: YSWS_STATUS.approved,
    created: airtableResult.created,
    skippedAirtable: airtableResult.skipped,
  };
}

export async function submitProjectToYsws(projectId) {
  if (!pool) {
    return { ok: false, skipped: true, reason: "DATABASE_URL not set." };
  }

  const ownerResult = await pool.query(`SELECT user_id FROM projects WHERE id = $1`, [projectId]);
  const ownerId = ownerResult.rows[0]?.user_id;
  if (ownerId) {
    await refreshHackatimeGithubUsernameForUser(ownerId, null, { force: true });
  }

  const row = await getProjectContext(projectId);
  if (!row) {
    return { ok: false, skipped: true, reason: "Project not found." };
  }

  const status = yswsStatusForProject(row);
  if (!status) {
    const staleStatuses = [YSWS_STATUS.pending, YSWS_STATUS.pendingReship];
    if (String(row.status || "").toLowerCase() === "blocked") {
      staleStatuses.push(YSWS_STATUS.approved);
    }
    await deleteProjectSubmissions(projectId, staleStatuses);
    return { ok: true, skipped: true, reason: "Project not in YSWS submission state." };
  }

  const localSubmission = await upsertLocalSubmission(
    buildSubmissionFromContext({
      project: row,
      user: { email: row.user_email, raw_profile: row.user_raw_profile, githubUsername: row.user_github_username },
      status,
    })
  );
  const airtableResult = await syncSubmissionToAirtable(localSubmission);

  if (hasAirtableYswsConfig && !airtableResult.skipped && !airtableResult.recordId) {
    throw new Error("YSWS local row saved but Airtable record id was not persisted.");
  }

  if (status === YSWS_STATUS.approved) {
    await deleteProjectSubmissions(projectId, [YSWS_STATUS.pending, YSWS_STATUS.pendingReship], {
      preserveAirtableRecordIds: [airtableResult.recordId, localSubmission.airtable_record_id],
    });
  }

  return {
    ok: true,
    recordId: airtableResult.recordId,
    projectId,
    status,
    created: airtableResult.created,
    skippedAirtable: airtableResult.skipped,
  };
}

/** Sync every project that belongs in the YSWS submissions table (Stack lifecycle). */
export async function syncAllYswsSubmissions() {
  if (!pool) {
    return { ok: false, skipped: true, reason: "DATABASE_URL not set.", synced: 0, failed: 0, skippedProjects: 0 };
  }

  if (!hasAirtableYswsConfig) {
    return { ok: false, skipped: true, reason: "Airtable YSWS not configured.", synced: 0, failed: 0, skippedProjects: 0 };
  }

  const result = await pool.query(`
    SELECT id
    FROM projects
    WHERE
      (status = 'approved' AND reviewed IS TRUE)
      OR status IN ('in-review', 'pending-reship')
    ORDER BY id ASC
  `);

  let synced = 0;
  let failed = 0;
  let skippedProjects = 0;
  let lastError = null;

  for (const row of result.rows) {
    try {
      const submission = await submitProjectToYsws(row.id);
      if (submission.skipped || submission.skippedAirtable || !submission.recordId) {
        skippedProjects += 1;
        if (!submission.skipped && hasAirtableYswsConfig) {
          lastError = submission.reason || "YSWS row saved locally but Airtable write did not return a record id.";
        }
      } else {
        synced += 1;
      }
    } catch (error) {
      failed += 1;
      lastError = error instanceof Error ? error.message : String(error);
      console.error("[ysws] bulk sync failed:", {
        projectId: row.id,
        message: lastError,
      });
    }
  }

  return {
    ok: failed === 0,
    synced,
    failed,
    skippedProjects,
    total: result.rows.length,
    lastError,
  };
}
