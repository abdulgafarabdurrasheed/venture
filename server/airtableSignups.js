/**
 * Airtable "Signups" table
 *
 * | Logical              | Airtable field        | Type              |
 * |----------------------|-----------------------|-------------------|
 * | name                 | Name                  | Single line text  |
 * | email                | Email                 | Email             |
 * | slackId              | Slack ID              | Single line text  |
 * | slackUsername        | Slack Username        | Single line text  |
 * | hackclubId           | Hack Club ID          | Single line text  |
 * | slug                 | Slug                  | Single line text  |
 * | verificationStatus   | Verification Status   | Single line text  |
 * | hackatimeHours       | Hackatime Hours       | Number            |
 * | lastSignIn           | Last Sign In          | Date              |
 * | createdAt            | Created At            | Date              |
 * | program              | Program               | Single line text  |
 */
const F = {
  name: "Name",
  email: "Email",
  slackId: "Slack ID",
  slackUsername: "Slack Username",
  hackclubId: "Hack Club ID",
  slug: "Slug",
  verificationStatus: "Verification Status",
  hackatimeHours: "Hackatime Hours",
  lastSignIn: "Last Sign In",
  createdAt: "Created At",
  program: "Program",
};

const PROGRAM_NAME = "Venture";

const airtableToken =
  process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
const airtableBaseId = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_APP;
const signupsTableId = process.env.AIRTABLE_SIGNUPS_TABLE_ID || "Signups";

export const hasAirtableSignupsConfig = Boolean(airtableToken && airtableBaseId);

function getSignupsTableUrl() {
  return `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(signupsTableId)}`;
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
  return `{${escaped}}`;
}

function profileSource(profile) {
  return profile?.identity && typeof profile.identity === "object" ? profile.identity : profile;
}

function profileEmail(profile) {
  const nested = profileSource(profile);
  const email =
    nested?.email ??
    nested?.primary_email ??
    nested?.email_address ??
    nested?.primaryEmail ??
    null;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function profileSlackId(profile) {
  const nested = profileSource(profile);
  const slackId = nested?.slack_id ?? nested?.slack_user_id ?? nested?.slackId ?? null;
  return slackId ? String(slackId) : "";
}

function profileHackclubId(profile) {
  const nested = profileSource(profile);
  const id =
    nested?.sub ??
    nested?.public_id ??
    nested?.identity_id ??
    nested?.id ??
    nested?.user_id ??
    null;
  return id !== undefined && id !== null && String(id).trim() ? String(id).trim() : "";
}

function profileSlackUsername(profile) {
  const nested = profileSource(profile);
  const parts = [nested?.first_name, nested?.last_name].filter((p) => typeof p === "string" && p.trim());
  const fullName = parts.length > 0 ? parts.join(" ") : null;
  return (
    nested?.slack_username ??
    nested?.slack?.username ??
    fullName ??
    nested?.username ??
    nested?.slug ??
    null
  );
}

function profileName(profile) {
  const nested = profileSource(profile);
  const nameParts = [nested?.first_name, nested?.last_name].filter((p) => typeof p === "string" && p.trim());
  return (
    nested?.name ??
    nested?.full_name ??
    (nameParts.length > 0 ? nameParts.join(" ") : null) ??
    nested?.username ??
    null
  );
}

function profileSlug(profile) {
  const nested = profileSource(profile);
  const slug = nested?.slug ?? nested?.username ?? null;
  return typeof slug === "string" && slug.trim() ? slug.trim() : null;
}

function profileVerificationStatus(profile) {
  const nested = profileSource(profile);
  const status = nested?.verification_status ?? nested?.verificationStatus ?? null;
  return typeof status === "string" && status.trim() ? status.trim() : null;
}

function profileHackatimeHours(profile) {
  const direct = profile?.hackatime_hours ?? profile?.hackatimeHours;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }

  const nested = profileSource(profile);
  const fromNested = nested?.hackatime_hours ?? nested?.hackatimeHours;
  if (typeof fromNested === "number" && Number.isFinite(fromNested)) {
    return fromNested;
  }

  const basic = profile?.basic_info ?? nested?.basic_info;
  if (basic && typeof basic === "object") {
    const hours = basic.hackatime_hours ?? basic.hackatimeHours;
    if (typeof hours === "number" && Number.isFinite(hours)) {
      return hours;
    }
  }

  return null;
}

function airtableDateNow() {
  return new Date().toISOString().slice(0, 10);
}

async function airtableRequest(path, options = {}) {
  const response = await fetch(`${getSignupsTableUrl()}${path}`, {
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
    throw new Error(`Airtable Signups request failed (${response.status})`);
  }

  return data;
}

async function findSignupRecord({ email, slackId, hackclubId }) {
  const filters = [];
  if (email) {
    filters.push(`${formulaField(F.email)}='${escapeFormulaString(email)}'`);
  }
  if (slackId) {
    filters.push(`${formulaField(F.slackId)}='${escapeFormulaString(slackId)}'`);
  }
  if (hackclubId) {
    filters.push(`${formulaField(F.hackclubId)}='${escapeFormulaString(hackclubId)}'`);
  }

  if (filters.length === 0) {
    return null;
  }

  const formula = filters.length === 1 ? filters[0] : `OR(${filters.join(",")})`;
  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
  });

  const data = await airtableRequest(`?${params.toString()}`);
  return data.records?.[0] ?? null;
}

function buildFieldsFromProfile(profile, { isCreate, existingFields }) {
  const now = airtableDateNow();
  const email = profileEmail(profile);
  const slackId = profileSlackId(profile);
  const hackclubId = profileHackclubId(profile);
  const hackatimeHours = profileHackatimeHours(profile);

  const fields = {
    [F.name]: profileName(profile),
    [F.email]: email || undefined,
    [F.slackId]: slackId || undefined,
    [F.slackUsername]: profileSlackUsername(profile) || undefined,
    [F.hackclubId]: hackclubId || undefined,
    [F.slug]: profileSlug(profile) || undefined,
    [F.verificationStatus]: profileVerificationStatus(profile) || undefined,
    [F.lastSignIn]: now,
    [F.program]: PROGRAM_NAME,
  };

  if (hackatimeHours !== null) {
    fields[F.hackatimeHours] = hackatimeHours;
  }

  if (isCreate) {
    fields[F.createdAt] = existingFields?.[F.createdAt] ?? now;
  }

  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) {
      delete fields[key];
    }
  }

  return fields;
}

export async function syncSignupToAirtable(profile) {
  if (!hasAirtableSignupsConfig) {
    return { ok: false, skipped: true, reason: "not_configured" };
  }

  const email = profileEmail(profile);
  const slackId = profileSlackId(profile);
  const hackclubId = profileHackclubId(profile);

  if (!email && !slackId && !hackclubId) {
    return { ok: false, skipped: true, reason: "missing_identifiers" };
  }

  const existing = await findSignupRecord({ email, slackId, hackclubId });

  if (existing?.id) {
    const fields = buildFieldsFromProfile(profile, {
      isCreate: false,
      existingFields: existing.fields,
    });

    await airtableRequest(`/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });

    return { ok: true, created: false };
  }

  const fields = buildFieldsFromProfile(profile, {
    isCreate: true,
    existingFields: {},
  });

  await airtableRequest("", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  return { ok: true, created: true };
}
