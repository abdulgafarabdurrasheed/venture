import { pool } from "./db.js";
import { slackDisplayNameFromProfile } from "./hackclubAuth.js";

const DEFAULT_ROLE = "member";

function parseEmailList(value) {
  return (value || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Creates the users table if missing. Safe to run on every server start.
 */
export async function ensureUsersTable() {
  if (!pool) {
    console.warn("[users] DATABASE_URL not set; skipping users table setup.");
    return;
  }

  if (process.env.RECREATE_USERS_TABLE === "true") {
    console.warn("[users] RECREATE_USERS_TABLE=true, dropping users table before rebuild.");
    await pool.query(`DROP TABLE IF EXISTS users`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      hackclub_sub TEXT NOT NULL UNIQUE,
      email TEXT,
      name TEXT,
      slug TEXT,
      profile_image_url TEXT,
      slack_id TEXT,
      verification_status TEXT,
      role TEXT NOT NULL DEFAULT '${DEFAULT_ROLE}',
      coins NUMERIC(10, 2) NOT NULL DEFAULT 0,
      access_token TEXT,
      refresh_token TEXT,
      token_type TEXT,
      token_expires_at TIMESTAMPTZ,
      expires_in_seconds INTEGER,
      scope TEXT,
      raw_profile JSONB,
      raw_token JSONB,
      hackatime_user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Backfill schema for older deployments where `users` already existed.
  // These are idempotent and safe to run on every boot.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackclub_sub TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS slug TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS slack_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS coins NUMERIC(10, 2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS access_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS refresh_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_type TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_in_seconds INTEGER`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS scope TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS raw_profile JSONB`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS raw_token JSONB`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_access_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_refresh_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_token_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_connected_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_total_hours NUMERIC(10, 2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_user_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_github_username TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW()`);
  await pool.query(`ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT NOW()`);
  await pool.query(`UPDATE users SET created_at = NOW() WHERE created_at IS NULL`);
  await pool.query(`UPDATE users SET updated_at = NOW() WHERE updated_at IS NULL`);

  await pool.query(`
    UPDATE users
    SET role = '${DEFAULT_ROLE}'
    WHERE role IS NULL
  `);

  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN role SET DEFAULT '${DEFAULT_ROLE}'
  `);

  await pool.query(`
    UPDATE users
    SET coins = 0
    WHERE coins IS NULL
  `);

  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN coins SET DEFAULT 0
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)
  `);

  // Older deployments may have been created before hackclub_sub uniqueness was enforced.
  // Remove duplicates (keep oldest row) so upsert with ON CONFLICT works reliably.
  const dedupeResult = await pool.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY hackclub_sub ORDER BY id ASC) AS row_num
      FROM users
      WHERE hackclub_sub IS NOT NULL
    ),
    deleted AS (
      DELETE FROM users u
      USING ranked r
      WHERE u.id = r.id
        AND r.row_num > 1
      RETURNING u.id
    )
    SELECT COUNT(*)::int AS deleted_count FROM deleted
  `);

  const deletedCount = dedupeResult.rows?.[0]?.deleted_count ?? 0;
  if (deletedCount > 0) {
    console.warn(`[users] Removed ${deletedCount} duplicate user rows by hackclub_sub.`);
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_hackclub_sub_unique ON users (hackclub_sub)
  `);
}

export function resolveRole(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const superadmins = parseEmailList(process.env.SUPERADMIN_EMAILS);
  const admins = parseEmailList(process.env.ADMIN_EMAILS);
  const reviewers = parseEmailList(process.env.REVIEWERS_EMAILS);

  if (normalizedEmail && superadmins.includes(normalizedEmail)) {
    return "superadmin";
  }
  if (normalizedEmail && admins.includes(normalizedEmail)) {
    return "admin";
  }
  if (normalizedEmail && reviewers.includes(normalizedEmail)) {
    return "reviewer";
  }
  return DEFAULT_ROLE;
}

export function effectiveRole(row) {
  if (!row) return null;
  if (typeof row.email === "string" && row.email.trim()) {
    return resolveRole(row.email);
  }
  return row.role || DEFAULT_ROLE;
}

export function canAccessStaffReview(role) {
  return role === "reviewer" || role === "admin" || role === "superadmin";
}

export function canAccessFullAdmin(role) {
  return role === "admin" || role === "superadmin";
}

export function canPerformDestructiveAdmin(role) {
  return role === "superadmin";
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function hackclubSubFromProfile(profile) {
  const nestedIdentity =
    profile?.identity && typeof profile.identity === "object" ? profile.identity : null;
  const source = nestedIdentity ?? profile;

  const subCandidate =
    source?.sub ??
    source?.id ??
    source?.public_id ??
    source?.identity_id ??
    source?.user_id ??
    source?.uid ??
    source?.hc_id ??
    null;

  if (subCandidate !== undefined && subCandidate !== null && String(subCandidate).trim()) {
    return String(subCandidate).trim();
  }

  const slackId = source?.slack_id ?? source?.slackId;
  if (slackId !== undefined && slackId !== null && String(slackId).trim()) {
    return `slack:${String(slackId).trim()}`;
  }

  const emailCandidate =
    source?.email ??
    source?.primary_email ??
    source?.email_address ??
    source?.primaryEmail ??
    null;
  if (typeof emailCandidate === "string" && emailCandidate.trim()) {
    return `email:${emailCandidate.trim().toLowerCase()}`;
  }

  throw new Error("Hack Club profile missing stable identifier.");
}

export function describeProfileIdentifier(profile) {
  try {
    return { stableId: hackclubSubFromProfile(profile), ...describeHackClubProfileFields(profile) };
  } catch {
    return describeHackClubProfileFields(profile);
  }
}

function describeHackClubProfileFields(profile) {
  const nested = profile?.identity && typeof profile.identity === "object" ? profile.identity : null;
  const source = nested ?? profile ?? {};
  return {
    topLevelKeys: profile ? Object.keys(profile) : [],
    identityKeys: nested ? Object.keys(nested) : [],
    id: source.id ?? null,
    public_id: source.public_id ?? null,
    sub: source.sub ?? null,
    hasPrimaryEmail: Boolean(source.primary_email),
    hasEmail: Boolean(source.email),
    hasSlackId: Boolean(source.slack_id),
  };
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

/**
 * Persists token response + profile for a Hack Club user (insert or update).
 */
export async function upsertUserFromHackClub({ profile, token }) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const hackclubSub = hackclubSubFromProfile(profile);
  const emailRaw =
    profile.email ??
    profile.primary_email ??
    profile.email_address ??
    profile.primaryEmail ??
    null;
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : null;
  const name = slackDisplayNameFromProfile(profile);
  const slug = profile.slug ?? profile.username ?? null;
  const profileImageUrl = profile.profile_image_url ?? profile.picture ?? profile.avatar_url ?? null;
  const slackId = profile.slack_id ?? profile.slack_user_id ?? profile.slackId ?? null;
  const verificationStatus = profile.verification_status ?? profile.verification ?? null;

  const accessToken = token.access_token ?? null;
  const refreshToken = token.refresh_token ?? null;
  const tokenType = token.token_type ?? null;
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : null;
  const scope = token.scope ?? null;

  let tokenExpiresAt = null;
  if (expiresIn) {
    tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  }

  const role = resolveRole(email);

  const result = await pool.query(
    `
    INSERT INTO users (
      hackclub_sub,
      email,
      name,
      slug,
      profile_image_url,
      slack_id,
      verification_status,
      role,
      access_token,
      refresh_token,
      token_type,
      token_expires_at,
      expires_in_seconds,
      scope,
      raw_profile,
      raw_token,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
    )
    ON CONFLICT (hackclub_sub) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      name = COALESCE(EXCLUDED.name, users.name),
      slug = COALESCE(EXCLUDED.slug, users.slug),
      profile_image_url = COALESCE(EXCLUDED.profile_image_url, users.profile_image_url),
      slack_id = COALESCE(EXCLUDED.slack_id, users.slack_id),
      verification_status = COALESCE(EXCLUDED.verification_status, users.verification_status),
      role = EXCLUDED.role,
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_type = EXCLUDED.token_type,
      token_expires_at = EXCLUDED.token_expires_at,
      expires_in_seconds = EXCLUDED.expires_in_seconds,
      scope = EXCLUDED.scope,
      raw_profile = EXCLUDED.raw_profile,
      raw_token = EXCLUDED.raw_token,
      updated_at = NOW()
    RETURNING *
    `,
    [
      hackclubSub,
      email,
      name,
      slug,
      profileImageUrl,
      slackId,
      verificationStatus,
      role,
      accessToken,
      refreshToken,
      tokenType,
      tokenExpiresAt,
      expiresIn,
      scope,
      JSON.stringify(profile ?? {}),
      JSON.stringify(token ?? {}),
    ]
  );

  return result.rows[0];
}

/** Local dev login — never available in production. */
export async function upsertDevUser({ email, name }) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "dev@localhost";
  const displayName = typeof name === "string" && name.trim() ? name.trim() : "Dev User";
  const hackclubSub = `dev:${normalizedEmail}`;
  const role = resolveRole(normalizedEmail);
  const profile = {
    email: normalizedEmail,
    name: displayName,
    sub: hackclubSub,
    verification_status: "dev",
  };

  const result = await pool.query(
    `
    INSERT INTO users (
      hackclub_sub,
      email,
      name,
      slug,
      verification_status,
      role,
      raw_profile,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    ON CONFLICT (hackclub_sub) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      verification_status = EXCLUDED.verification_status,
      role = EXCLUDED.role,
      raw_profile = EXCLUDED.raw_profile,
      updated_at = NOW()
    RETURNING *
    `,
    [hackclubSub, normalizedEmail, displayName, normalizedEmail.split("@")[0], "dev", role, JSON.stringify(profile)]
  );

  return result.rows[0];
}

export async function getUserById(id) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function listAdminUsers() {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(`
    SELECT
      id,
      email,
      name,
      slug,
      role,
      coins,
      hackclub_sub,
      profile_image_url,
      verification_status,
      created_at,
      updated_at
    FROM users
    ORDER BY created_at DESC, id DESC
  `);

  return result.rows.map(toAdminUser);
}

export async function getAdminUserById(id) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(
    `
      SELECT
        id,
        email,
        name,
        slug,
        role,
        coins,
        hackclub_sub,
        profile_image_url,
        verification_status,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
    `,
    [id]
  );

  return result.rows[0] ? toAdminUser(result.rows[0]) : null;
}

export async function getAdminUserWithProjects(id) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const userResult = await pool.query(
    `SELECT
       id, email, name, slug, role, coins, hackclub_sub, profile_image_url,
       verification_status, hackatime_total_hours, hackatime_connected_at,
       created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );

  const row = userResult.rows[0];
  if (!row) return null;

  const projectResult = await pool.query(
    `SELECT
       p.id, p.name, p.status, p.total_hours, p.approved_hours, p.coins_earned,
       p.shipped, p.reviewed, p.fraud_flag, p.created_at, p.updated_at,
       COALESCE(SUM(je.hours_worked), 0) AS journal_hours
     FROM projects p
     LEFT JOIN journal_entries je ON je.project_id = p.id
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [id]
  );

  return {
    ...toAdminUser(row),
    hackatimeTotalHours: Number(row.hackatime_total_hours ?? 0),
    hackatimeConnectedAt: row.hackatime_connected_at,
    projects: projectResult.rows.map((p) => ({
      id: Number(p.id),
      name: p.name,
      status: p.status,
      totalHours: Number(p.total_hours ?? 0),
      approvedHours: Number(p.approved_hours ?? 0),
      coinsEarned: Number(p.coins_earned ?? 0),
      journalHours: Number(p.journal_hours ?? 0),
      shipped: p.shipped,
      reviewed: p.reviewed,
      fraudFlag: p.fraud_flag,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
  };
}

export async function getUserByEmail(email) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const normalizedEmail = normalizeEmail(email);
  const result = await pool.query(
    `
      SELECT *
      FROM users
      WHERE lower(email) = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedEmail]
  );

  return result.rows[0] ?? null;
}

export async function updateUserRoleFromEmail(id, email) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(
    `
      UPDATE users
      SET
        email = $1,
        role = $2,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `,
    [normalizeEmail(email), resolveRole(email), id]
  );

  return result.rows[0];
}

function parseRawProfile(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function publicDisplayNameFromUserRow(row) {
  if (!row) return null;
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (slug) return slug;
  const fromProfile = slackDisplayNameFromProfile(parseRawProfile(row.raw_profile));
  if (fromProfile) return fromProfile;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (name) return name;
  const email = typeof row.email === "string" ? row.email : "";
  if (email.includes("@")) return email.split("@")[0];
  return null;
}

export function toPublicUser(row, { loggedHours = 0 } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: publicDisplayNameFromUserRow(row),
    slug: row.slug,
    profileImageUrl: row.profile_image_url,
    role: effectiveRole(row),
    coins: Number(row.coins ?? 0),
    hackatimeConnected: Boolean(row.hackatime_access_token),
    hackatimeTotalHours: Number(row.hackatime_total_hours ?? 0),
    loggedHours: Number(loggedHours ?? 0),
  };
}

export function toPublicUserFromSessionSnapshot(snapshot) {
  if (!snapshot?.hackclubSub) return null;
  const slug = snapshot.slug?.trim() || null;
  const name = slug || snapshot.name?.trim() || null;
  return {
    id: snapshot.id ?? null,
    email: snapshot.email ?? null,
    name,
    slug: snapshot.slug ?? null,
    profileImageUrl: snapshot.profileImageUrl ?? null,
    role: snapshot.role ?? DEFAULT_ROLE,
    coins: Number(snapshot.coins ?? 0),
    hackatimeTotalHours: Number(snapshot.hackatimeTotalHours ?? 0),
    loggedHours: Number(snapshot.loggedHours ?? 0),
  };
}

export function buildSessionProfileSnapshot(profile, { userRow = null } = {}) {
  const hackclubSub = hackclubSubFromProfile(profile);
  const email = profileEmail(profile) || userRow?.email || null;
  const slug = profile.slug ?? profile.username ?? userRow?.slug ?? null;
  const name = slackDisplayNameFromProfile(profile) ?? publicDisplayNameFromUserRow(userRow);

  return {
    id: userRow?.id ?? null,
    hackclubSub,
    email,
    name,
    slug,
    profileImageUrl:
      profile.profile_image_url ?? profile.picture ?? profile.avatar_url ?? userRow?.profile_image_url ?? null,
    slackId: profile.slack_id ?? profile.slack_user_id ?? userRow?.slack_id ?? null,
    verificationStatus:
      profile.verification_status ?? profile.verification ?? userRow?.verification_status ?? null,
    role: userRow ? effectiveRole(userRow) : resolveRole(email),
    coins: userRow ? Number(userRow.coins ?? 0) : 0,
    hackatimeTotalHours: userRow ? Number(userRow.hackatime_total_hours ?? 0) : 0,
  };
}

export function isDatabaseConnectionError(error) {
  if (!error || typeof error !== "object") return false;
  const code = error.code;
  return (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "57P01"
  );
}

function toAdminUser(row) {
  return {
    id: row.id,
    email: row.email,
    slug: row.slug,
    role: effectiveRole(row),
    coins: Number(row.coins ?? 0),
    profileImageUrl: row.profile_image_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
