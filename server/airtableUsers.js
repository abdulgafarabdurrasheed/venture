/**
 * Airtable `_users` ()
 *
 * | Logical        | Airtable field   |
 * |----------------|------------------|
 * | userId         | user_id          |
 * | name           | Name             |
 * | currency       | Coins            |
 * | slackId        | Slack ID         |
 * | slackUsername  | Slack Username   |
 * | role           | Role             |
 * | lastSignIn     | Last Sign In     |
 * | createdAt      | Created At       |
 * | email          | Email            |
 * | hackatimeHours | Hackatime Hours  |
 */
const F = {
  userId: "user_id",
  name: "Name",
  currency: "Coins",
  slackId: "Slack ID",
  slackUsername: "Slack Username",
  role: "Role",
  lastSignIn: "Last Sign In",
  createdAt: "Created At",
  email: "Email",
  hackatimeHours: "Hackatime Hours",
};

const airtableToken =
  process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
const airtableBaseId =
  process.env.AIRTABLE_USERS_BASE_ID || process.env.AIRTABLE_APP || process.env.AIRTABLE_BASE_ID;
const usersTableId = process.env.AIRTABLE_USERS_TABLE_ID || "_users";

export const hasAirtableUsersConfig = Boolean(airtableToken && airtableBaseId);

function getUsersTableUrl() {
  return `https://api.airtable.com/v0/${airtableBaseId}/${usersTableId}`;
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

function profileEmail(profile) {
  const nested = profile?.identity && typeof profile.identity === "object" ? profile.identity : profile;
  const email =
    nested?.email ??
    nested?.primary_email ??
    nested?.email_address ??
    nested?.primaryEmail ??
    null;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function profileSlackId(profile) {
  const nested = profile?.identity && typeof profile.identity === "object" ? profile.identity : profile;
  const slackId = nested?.slack_id ?? nested?.slack_user_id ?? nested?.slackId ?? null;
  return slackId ? String(slackId) : "";
}

function profileSlackUsername(profile) {
  const nested = profile?.identity && typeof profile.identity === "object" ? profile.identity : profile;
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

function profileHackatimeHours(profile) {
  const direct = profile?.hackatime_hours ?? profile?.hackatimeHours;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }
  const basic = profile?.basic_info;
  if (basic && typeof basic === "object") {
    const nested = basic.hackatime_hours ?? basic.hackatimeHours;
    if (typeof nested === "number" && Number.isFinite(nested)) {
      return nested;
    }
  }
  return null;
}

function airtableDateNow() {
  return new Date().toISOString().slice(0, 10);
}

async function airtableRequest(path, options = {}) {
  const response = await fetch(`${getUsersTableUrl()}${path}`, {
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
    throw new Error(`Airtable users request failed (${response.status}): ${message}`);
  }

  return data;
}

async function findUserRecord({ email, slackId }) {
  const filters = [];
  if (email) {
    filters.push(`${formulaField(F.email)}='${escapeFormulaString(email)}'`);
  }
  if (slackId) {
    filters.push(`${formulaField(F.slackId)}='${escapeFormulaString(slackId)}'`);
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

async function getMaxUserId() {
  const params = new URLSearchParams({
    "sort[0][field]": F.userId,
    "sort[0][direction]": "desc",
    maxRecords: "1",
  });

  const data = await airtableRequest(`?${params.toString()}`);
  const value = data.records?.[0]?.fields?.[F.userId];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildFieldsFromProfile(profile, { isCreate, userId, existingFields }) {
  const now = airtableDateNow();
  const email = profileEmail(profile);
  const nested = profile?.identity && typeof profile.identity === "object" ? profile.identity : profile;
  const nameParts = [nested?.first_name, nested?.last_name].filter((p) => typeof p === "string" && p.trim());
  const name =
    nested?.name ??
    nested?.full_name ??
    (nameParts.length > 0 ? nameParts.join(" ") : null) ??
    nested?.username ??
    null;
  const slackId = profileSlackId(profile);
  const slackUsername = profileSlackUsername(profile);
  const hackatimeHours = profileHackatimeHours(profile);

  const fields = {
    [F.name]: name,
    [F.email]: email || undefined,
    [F.slackId]: slackId || undefined,
    [F.slackUsername]: slackUsername || undefined,
    [F.lastSignIn]: now,
  };

  if (hackatimeHours !== null) {
    fields[F.hackatimeHours] = hackatimeHours;
  }

  if (isCreate) {
    fields[F.userId] = userId;
    fields[F.currency] = existingFields?.[F.currency] ?? 0;
    fields[F.role] = existingFields?.[F.role] ?? "user";
    fields[F.createdAt] = existingFields?.[F.createdAt] ?? now;
    if (fields[F.currency] === undefined) fields[F.currency] = 0;
  }

  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) {
      delete fields[key];
    }
  }

  return fields;
}

function buildFieldsFromPostgresRow(row, { isCreate, userId, existingFields }) {
  const now = airtableDateNow();
  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  const hackatimeHours = Number(row.hackatime_total_hours);
  const fields = {
    [F.name]: row.name || row.slug || email?.split("@")[0] || undefined,
    [F.email]: email || undefined,
    [F.slackId]: row.slack_id || undefined,
    [F.lastSignIn]: now,
    [F.hackatimeHours]: Number.isFinite(hackatimeHours) ? hackatimeHours : undefined,
  };

  if (isCreate) {
    fields[F.userId] = userId;
    fields[F.currency] = existingFields?.[F.currency] ?? 0;
    fields[F.role] = existingFields?.[F.role] ?? row.role ?? "user";
    fields[F.createdAt] = existingFields?.[F.createdAt] ?? airtableDateNow();
    if (fields[F.currency] === undefined) fields[F.currency] = 0;
  }

  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key];
  }

  return fields;
}

export async function syncPostgresUserToAirtable(row) {
  if (!hasAirtableUsersConfig) {
    return { ok: false, skipped: true, reason: "Airtable not configured." };
  }

  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  const slackId = row.slack_id ? String(row.slack_id) : "";

  if (!email && !slackId) {
    return { ok: false, skipped: true, reason: "User missing email and slack_id." };
  }

  const existing = await findUserRecord({ email, slackId });

  if (existing?.id) {
    const fields = buildFieldsFromPostgresRow(row, {
      isCreate: false,
      existingFields: existing.fields,
    });

    const data = await airtableRequest(`/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });

    return { ok: true, created: false, recordId: data.id, userId: existing.fields?.[F.userId] ?? null };
  }

  const nextUserId = (await getMaxUserId()) + 1;
  const fields = buildFieldsFromPostgresRow(row, {
    isCreate: true,
    userId: nextUserId,
    existingFields: { [F.currency]: 0, [F.role]: "user" },
  });

  const data = await airtableRequest("", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  return { ok: true, created: true, recordId: data.id, userId: nextUserId };
}

export async function syncUserToAirtableUsers(profile) {
  if (!hasAirtableUsersConfig) {
    return { ok: false, skipped: true, reason: "Airtable not configured." };
  }

  const email = profileEmail(profile);
  const slackId = profileSlackId(profile);

  if (!email && !slackId) {
    return { ok: false, skipped: true, reason: "Profile missing email and slack_id." };
  }

  const existing = await findUserRecord({ email, slackId });

  if (existing?.id) {
    const fields = buildFieldsFromProfile(profile, {
      isCreate: false,
      existingFields: existing.fields,
    });

    const data = await airtableRequest(`/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });

    return {
      ok: true,
      created: false,
      recordId: data.id,
      userId: existing.fields?.[F.userId] ?? null,
    };
  }

  const nextUserId = (await getMaxUserId()) + 1;
  const now = airtableDateNow();
  const fields = buildFieldsFromProfile(profile, {
    isCreate: true,
    userId: nextUserId,
    existingFields: { [F.currency]: 0, [F.role]: "user", [F.createdAt]: now },
  });

  const data = await airtableRequest("", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  return { ok: true, created: true, recordId: data.id, userId: nextUserId };
}
