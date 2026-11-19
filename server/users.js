import { pool } from "./db.js";
import { getDefaultDevEmail } from "./env.js";
import { slackDisplayNameFromProfile } from "./hackclubAuth.js";

const DEFAULT_ROLE = "member";
const LEGACY_SENSITIVE_USER_COLUMNS = [
  "access_token",
  "refresh_token",
  "token_type",
  "token_expires_at",
  "expires_in_seconds",
  "scope",
  "raw_token",
  "raw_profile",
];

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
      total_stars INTEGER NOT NULL DEFAULT 0,
      grant_identity JSONB,
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_stars INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS grant_identity JSONB`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_access_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_refresh_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_token_expires_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_connected_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_total_hours NUMERIC(10, 2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_user_id TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_github_username TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await migrateLegacySensitiveUserData();
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

async function migrateLegacySensitiveUserData() {
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users'
  `);
  const columns = new Set(result.rows.map((row) => row.column_name));

  if (columns.has("raw_profile")) {
    const legacyRows = await pool.query(`
      SELECT id, raw_profile
      FROM users
      WHERE raw_profile IS NOT NULL AND grant_identity IS NULL
    `);
    for (const row of legacyRows.rows) {
      const grantIdentity = normalizeGrantIdentity(parseRawProfile(row.raw_profile));
      if (!grantIdentity) continue;
      await pool.query("UPDATE users SET grant_identity = $1::jsonb WHERE id = $2", [
        JSON.stringify(grantIdentity),
        row.id,
      ]);
    }
  }

  for (const column of LEGACY_SENSITIVE_USER_COLUMNS) {
    await pool.query(`ALTER TABLE users DROP COLUMN IF EXISTS ${column}`);
  }
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
 * Persists the minimum account fields Off-Track uses. OAuth token material is
 * intentionally consumed only by the callback and never stored.
 */
export async function upsertUserFromHackClub({ profile }) {
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
  // Keep names available for grant records, but collect date of birth and
  // mailing address only after a participant starts a grant checkout.
  const grantIdentity = normalizeGrantIdentity(profile, {
    includeBirthdate: false,
    includeAddress: false,
  });

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
      grant_identity,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW())
    ON CONFLICT (hackclub_sub) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      name = COALESCE(EXCLUDED.name, users.name),
      slug = COALESCE(EXCLUDED.slug, users.slug),
      profile_image_url = COALESCE(EXCLUDED.profile_image_url, users.profile_image_url),
      slack_id = COALESCE(EXCLUDED.slack_id, users.slack_id),
      verification_status = COALESCE(EXCLUDED.verification_status, users.verification_status),
      role = EXCLUDED.role,
      grant_identity = CASE
        WHEN EXCLUDED.grant_identity IS NULL THEN users.grant_identity
        ELSE jsonb_set(
          jsonb_set(
            EXCLUDED.grant_identity,
            '{identity,birthdate}',
            COALESCE(
              NULLIF(EXCLUDED.grant_identity #> '{identity,birthdate}', 'null'::jsonb),
              users.grant_identity #> '{identity,birthdate}',
              'null'::jsonb
            ),
            true
          ),
          '{identity,address}',
          COALESCE(
            NULLIF(EXCLUDED.grant_identity #> '{identity,address}', 'null'::jsonb),
            users.grant_identity #> '{identity,address}',
            'null'::jsonb
          ),
          true
        )
      END,
      updated_at = NOW()
    RETURNING id, hackclub_sub, email, name, slug, profile_image_url, slack_id,
      verification_status, role, coins, total_stars, created_at, updated_at,
      (hackatime_access_token IS NOT NULL) AS hackatime_connected,
      hackatime_user_id, hackatime_github_username, hackatime_total_hours
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
      grantIdentity ? JSON.stringify(grantIdentity) : null,
    ]
  );

  return result.rows[0];
}

export function grantIdentityHasCompleteAddress(grantIdentity) {
  const address = grantIdentity?.identity?.address;
  return Boolean(address?.line_1 && address?.city && address?.country && address?.zip);
}

export async function updateGrantIdentityFromHackClub(userId, profile) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const grantIdentity = normalizeGrantIdentity(profile);
  if (!grantIdentityHasCompleteAddress(grantIdentity)) return false;

  const result = await pool.query(
    `
      UPDATE users
      SET grant_identity = jsonb_build_object(
            'identity', jsonb_build_object(
              'first_name', COALESCE(
                NULLIF($1::jsonb #> '{identity,first_name}', 'null'::jsonb),
                NULLIF(users.grant_identity #> '{identity,first_name}', 'null'::jsonb)
              ),
              'last_name', COALESCE(
                NULLIF($1::jsonb #> '{identity,last_name}', 'null'::jsonb),
                NULLIF(users.grant_identity #> '{identity,last_name}', 'null'::jsonb)
              ),
              'birthdate', COALESCE(
                NULLIF($1::jsonb #> '{identity,birthdate}', 'null'::jsonb),
                NULLIF(users.grant_identity #> '{identity,birthdate}', 'null'::jsonb)
              ),
              'address', $1::jsonb #> '{identity,address}'
            )
          ),
          updated_at = NOW()
      WHERE id = $2
      RETURNING id
    `,
    [JSON.stringify(grantIdentity), userId]
  );
  return result.rowCount > 0;
}

/** Local dev login — never available in production. */
export async function upsertDevUser({ email, name }) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const normalizedEmail =
    typeof email === "string" ? email.trim().toLowerCase() : getDefaultDevEmail().toLowerCase();
  const displayName = typeof name === "string" && name.trim() ? name.trim() : "Dev User";
  const hackclubSub = `dev:${normalizedEmail}`;
  const role = resolveRole(normalizedEmail);
  const result = await pool.query(
    `
    INSERT INTO users (
      hackclub_sub,
      email,
      name,
      slug,
      verification_status,
      role,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (hackclub_sub) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      slug = EXCLUDED.slug,
      verification_status = EXCLUDED.verification_status,
      role = EXCLUDED.role,
      updated_at = NOW()
    RETURNING id, hackclub_sub, email, name, slug, profile_image_url, slack_id,
      verification_status, role, coins, total_stars, created_at, updated_at,
      (hackatime_access_token IS NOT NULL) AS hackatime_connected,
      hackatime_user_id, hackatime_github_username, hackatime_total_hours
    `,
    [hackclubSub, normalizedEmail, displayName, normalizedEmail.split("@")[0], "dev", role]
  );

  return result.rows[0];
}

export async function getUserById(id) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(
    `
      SELECT
        id, hackclub_sub, email, name, slug, profile_image_url, slack_id,
        verification_status, role, coins, total_stars, created_at, updated_at,
        (hackatime_access_token IS NOT NULL) AS hackatime_connected,
        hackatime_user_id, hackatime_github_username, hackatime_total_hours
      FROM users
      WHERE id = $1
    `,
    [id]
  );
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
      SELECT
        id, hackclub_sub, email, name, slug, profile_image_url, slack_id,
        verification_status, role, coins, total_stars, created_at, updated_at,
        (hackatime_access_token IS NOT NULL) AS hackatime_connected,
        hackatime_user_id, hackatime_github_username, hackatime_total_hours
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
      RETURNING id, hackclub_sub, email, name, slug, profile_image_url, slack_id,
        verification_status, role, coins, total_stars, created_at, updated_at,
        (hackatime_access_token IS NOT NULL) AS hackatime_connected,
        hackatime_user_id, hackatime_github_username, hackatime_total_hours
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

function normalizeGrantIdentity(profile, { includeBirthdate = true, includeAddress = true } = {}) {
  if (!profile || typeof profile !== "object") return null;
  const identity = profile.identity && typeof profile.identity === "object" ? profile.identity : profile;
  const addresses = Array.isArray(identity.addresses) ? identity.addresses : [];
  const address = includeAddress
    ? identity.address ?? addresses.find((entry) => entry?.primary) ?? addresses[0] ?? {}
    : {};
  const addressObject = typeof address === "string" ? { street_address: address } : address && typeof address === "object" ? address : {};
  const clean = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const normalizedAddress = {
    line_1: clean(addressObject.line_1 ?? addressObject.line1 ?? addressObject.street_address ?? addressObject.street),
    line_2: clean(addressObject.line_2 ?? addressObject.line2 ?? addressObject.street2),
    city: clean(addressObject.city ?? addressObject.locality),
    state: clean(addressObject.state ?? addressObject.region ?? addressObject.province),
    country: clean(addressObject.country ?? addressObject.country_name),
    zip: clean(addressObject.zip ?? addressObject.postal_code ?? addressObject.postcode),
  };
  const fields = {
    first_name: clean(identity.first_name ?? identity.firstName ?? identity.given_name),
    last_name: clean(identity.last_name ?? identity.lastName ?? identity.family_name),
    birthdate: includeBirthdate ? clean(identity.birthdate ?? identity.birthday ?? identity.dob) : null,
    address: includeAddress && Object.values(normalizedAddress).some(Boolean) ? normalizedAddress : null,
  };
  const hasIdentityData = Boolean(
    fields.first_name ||
      fields.last_name ||
      fields.birthdate ||
      fields.address
  );
  return hasIdentityData ? { identity: fields } : null;
}

function publicDisplayNameFromUserRow(row) {
  if (!row) return null;
  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (slug) return slug;
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
    hackatimeConnected: Boolean(row.hackatime_connected ?? row.hackatimeConnected ?? row.hackatime_access_token),
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
