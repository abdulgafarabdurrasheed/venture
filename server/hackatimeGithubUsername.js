import { pool } from "./db.js";
import { fetchHackatimeMe } from "./hackatimeAuth.js";

/** Hackatime /me returns github_username; keep legacy fallbacks for older payloads. */
export function extractHackatimeGithubUsername(me) {
  if (!me || typeof me !== "object") return null;

  const candidates = [
    me.github_username,
    me.githubUsername,
    me.data?.github_username,
    me.data?.githubUsername,
    me.data?.username,
    me.username,
  ];

  for (const value of candidates) {
    const text = String(value || "").trim().replace(/^@/, "");
    if (text) return text;
  }

  return null;
}

export function extractHackatimeUserId(me) {
  if (!me || typeof me !== "object") return null;

  const candidates = [
    me.id,
    me.user_id,
    me.userId,
    me.data?.id,
    me.data?.user_id,
    me.data?.userId,
  ];

  for (const value of candidates) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }

  return null;
}

/** Stack: Hackatime /me is the primary YSWS profile source. */
export async function refreshHackatimeGithubUsernameForUser(userId, accessToken, { force = false } = {}) {
  if (!pool) return null;

  const existing = await pool.query(
    `SELECT hackatime_github_username, hackatime_user_id, hackatime_access_token FROM users WHERE id = $1`,
    [userId]
  );
  const row = existing.rows[0];
  if (!row) return null;

  const cached = String(row.hackatime_github_username || "").trim();
  const token = accessToken || row.hackatime_access_token;
  const cachedUserId = String(row.hackatime_user_id || "").trim();
  if (!force && cached && cachedUserId) return cached;
  if (!token) return cached || null;

  try {
    const me = await fetchHackatimeMe(token);
    const githubUsername = extractHackatimeGithubUsername(me);
    const hackatimeUserId = extractHackatimeUserId(me);
    if (githubUsername || hackatimeUserId) {
      await pool.query(
        `UPDATE users
         SET hackatime_github_username = COALESCE($1, hackatime_github_username),
             hackatime_user_id = COALESCE($2, hackatime_user_id),
             updated_at = NOW()
         WHERE id = $3`,
        [githubUsername, hackatimeUserId, userId]
      );
      return githubUsername || cached || null;
    }
  } catch (error) {
    console.error("[hackatime] failed to fetch /me for GitHub username:", {
      userId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return cached || null;
}
