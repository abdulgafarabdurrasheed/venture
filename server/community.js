import { pool } from "./db.js";
import {
  canAwardExploreStar,
  isPublicCommunityProject,
  normalizeProjectComment,
  PUBLIC_PROJECT_EXCLUDED_STATUSES,
} from "./communityRules.js";

const excludedStatusSql = PUBLIC_PROJECT_EXCLUDED_STATUSES.map((status) => `'${status}'`).join(", ");
const PUBLIC_PROJECT_EXCLUSIONS = `
  p.blocked IS NOT TRUE
  AND p.fraud_flag IS NOT TRUE
  AND LOWER(COALESCE(p.status, '')) NOT IN (${excludedStatusSql})
`;

function publicProject(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description || "",
    projectType: row.project_type,
    playableUrl: row.playable_url,
    codeUrl: row.code_url,
    imageUrl: row.image_url,
    status: row.status,
    shipped: Boolean(row.shipped),
    shippedAt: row.shipped_at,
    createdAt: row.created_at,
    stars: Number(row.stars || 0),
    likeCount: Number(row.like_count || 0),
    commentCount: Number(row.comment_count || 0),
    likedByViewer: Boolean(row.liked_by_viewer),
    owner: {
      id: Number(row.user_id),
      name: row.owner_slug || row.owner_name || "Venture maker",
      slug: row.owner_slug,
      profileImageUrl: row.owner_profile_image_url,
      totalStars: Number(row.owner_total_stars || 0),
      followerCount: Number(row.follower_count || 0),
      followedByViewer: Boolean(row.followed_by_viewer),
    },
    isOwnProject: Boolean(row.is_own_project),
    canAwardStar: Boolean(row.can_award_star),
    alreadyAwardedByStaff: Boolean(row.staff_already_awarded),
  };
}

export async function ensureCommunityTables() {
  if (!pool) {
    console.warn("[community] DATABASE_URL not set; skipping community table setup.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_likes (
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_comments (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_follows (
      follower_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followed_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (follower_user_id, followed_user_id),
      CHECK (follower_user_id <> followed_user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_views (
      project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, user_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS project_comments_project_created_idx ON project_comments(project_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS user_follows_followed_idx ON user_follows(followed_user_id)`);
}

export async function listExploreProjects({ viewerUserId = null, staffUserId = null, search = "" } = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const normalizedSearch = String(search || "").trim();
  const result = await pool.query(
    `
      SELECT
        p.id, p.user_id, p.name, p.description, p.project_type, p.playable_url,
        p.code_url, p.image_url, p.status, p.shipped, p.stars, p.created_at, p.shipped_at,
        u.name AS owner_name, u.slug AS owner_slug,
        u.profile_image_url AS owner_profile_image_url,
        u.total_stars AS owner_total_stars,
        (p.user_id = $1::int) AS is_own_project,
        EXISTS (SELECT 1 FROM project_likes l WHERE l.project_id = p.id AND l.user_id = $1::int) AS liked_by_viewer,
        (SELECT COUNT(*) FROM project_likes l WHERE l.project_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM project_comments c WHERE c.project_id = p.id) AS comment_count,
        (SELECT COUNT(*) FROM user_follows f WHERE f.followed_user_id = u.id) AS follower_count,
        EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_user_id = $1::int AND f.followed_user_id = u.id) AS followed_by_viewer,
        CASE WHEN $2::int IS NULL THEN FALSE ELSE EXISTS (
          SELECT 1 FROM project_star_awards a WHERE a.project_id = p.id AND a.staff_user_id = $2
        ) END AS staff_already_awarded
      FROM projects p
      JOIN users u ON u.id = p.user_id
      WHERE ${PUBLIC_PROJECT_EXCLUSIONS}
        AND ($3 = '' OR p.name ILIKE '%' || $3 || '%' OR COALESCE(p.description, '') ILIKE '%' || $3 || '%' OR COALESCE(u.slug, '') ILIKE '%' || $3 || '%' OR COALESCE(u.name, '') ILIKE '%' || $3 || '%')
        AND ($1::int IS NULL OR $3 <> '' OR NOT EXISTS (
          SELECT 1 FROM project_views v WHERE v.project_id = p.id AND v.user_id = $1
        ))
      ORDER BY p.created_at ASC, p.id ASC
    `,
    [viewerUserId, staffUserId, normalizedSearch]
  );
  return result.rows.map((row) => publicProject({
    ...row,
    can_award_star: canAwardExploreStar({
      ownerUserId: row.user_id,
      staffUserId,
      participantStars: row.owner_total_stars,
      alreadyAwarded: row.staff_already_awarded,
    }),
  }));
}

export async function markExploreProjectViewed(userId, projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query(
    `
      INSERT INTO project_views (project_id, user_id)
      SELECT p.id, $2 FROM projects p
      WHERE p.id = $1 AND ${PUBLIC_PROJECT_EXCLUSIONS}
      ON CONFLICT (project_id, user_id) DO NOTHING
      RETURNING project_id
    `,
    [projectId, userId]
  );
  return { viewed: result.rowCount > 0 };
}

export async function getPublicProjectPage(projectId, viewerUserId = null) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query(
    `
      SELECT
        p.id, p.user_id, p.name, p.description, p.project_type, p.playable_url,
        p.code_url, p.image_url, p.status, p.shipped, p.stars, p.created_at,
        p.updated_at, p.shipped_at, p.approved_hours,
        u.name AS owner_name, u.slug AS owner_slug, u.profile_image_url AS owner_profile_image_url,
        u.total_stars AS owner_total_stars,
        (SELECT COUNT(*) FROM project_likes l WHERE l.project_id = p.id) AS like_count,
        (SELECT COUNT(*) FROM project_comments c WHERE c.project_id = p.id) AS comment_count,
        EXISTS (SELECT 1 FROM project_likes l WHERE l.project_id = p.id AND l.user_id = $2::int) AS liked_by_viewer,
        (SELECT COUNT(*) FROM user_follows f WHERE f.followed_user_id = u.id) AS follower_count,
        EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_user_id = $2::int AND f.followed_user_id = u.id) AS followed_by_viewer
      FROM projects p JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 AND ${PUBLIC_PROJECT_EXCLUSIONS}
    `,
    [projectId, viewerUserId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const journals = await pool.query(
    `
      SELECT id, time_done, hours_worked, description, tools_used, created_at, updated_at
      FROM journal_entries
      WHERE project_id = $1 AND user_id = $2
      ORDER BY COALESCE(time_done, created_at) ASC, id ASC
    `,
    [projectId, row.user_id]
  );
  return {
    project: publicProject({ ...row, is_own_project: Number(row.user_id) === Number(viewerUserId) }),
    data: {
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvedHours: Number(row.approved_hours || 0),
      journals: journals.rows.map((entry) => ({
        id: Number(entry.id),
        timeDone: entry.time_done,
        hoursWorked: Number(entry.hours_worked || 0),
        description: entry.description || "",
        toolsUsed: entry.tools_used || [],
        createdAt: entry.created_at,
        updatedAt: entry.updated_at,
      })),
    },
  };
}

export async function getPublicParticipantPage(identifier, viewerUserId = null) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const participantResult = await pool.query(
    `
      SELECT id, name, slug, profile_image_url, total_stars
      FROM users
      WHERE slug = $1 OR (slug IS NULL OR slug = '') AND id::text = $1
      ORDER BY CASE WHEN slug = $1 THEN 0 ELSE 1 END
      LIMIT 1
    `,
    [String(identifier)]
  );
  const participant = participantResult.rows[0];
  if (!participant) return null;
  const [projectsResult, statsResult] = await Promise.all([
    pool.query(
      `
        SELECT p.id, p.user_id, p.name, p.description, p.project_type, p.playable_url,
          p.code_url, p.image_url, p.status, p.shipped, p.stars, p.created_at, p.shipped_at,
          (SELECT COUNT(*) FROM project_likes l WHERE l.project_id = p.id) AS like_count,
          (SELECT COUNT(*) FROM project_comments c WHERE c.project_id = p.id) AS comment_count,
          EXISTS (SELECT 1 FROM project_likes l WHERE l.project_id = p.id AND l.user_id = $2::int) AS liked_by_viewer
        FROM projects p
        WHERE p.user_id = $1 AND ${PUBLIC_PROJECT_EXCLUSIONS}
        ORDER BY p.created_at ASC, p.id ASC
      `,
      [participant.id, viewerUserId]
    ),
    pool.query(
      `
        SELECT COUNT(*)::int AS project_count,
          COUNT(*) FILTER (WHERE p.shipped IS TRUE)::int AS shipped_count,
          COALESCE(SUM(p.approved_hours), 0) AS approved_hours,
          (SELECT COUNT(*) FROM user_follows f WHERE f.followed_user_id = $1) AS follower_count,
          EXISTS (SELECT 1 FROM user_follows f WHERE f.follower_user_id = $2::int AND f.followed_user_id = $1) AS followed_by_viewer
        FROM projects p WHERE p.user_id = $1 AND ${PUBLIC_PROJECT_EXCLUSIONS}
      `,
      [participant.id, viewerUserId]
    ),
  ]);
  const stats = statsResult.rows[0] || {};
  return {
    participant: {
      id: Number(participant.id),
      name: participant.slug || participant.name || "Venture maker",
      slug: participant.slug,
      profileImageUrl: participant.profile_image_url,
      totalStars: Number(participant.total_stars || 0),
      projectCount: Number(stats.project_count || 0),
      shippedCount: Number(stats.shipped_count || 0),
      approvedHours: Number(stats.approved_hours || 0),
      followerCount: Number(stats.follower_count || 0),
      followedByViewer: Boolean(stats.followed_by_viewer),
      isOwnProfile: Number(participant.id) === Number(viewerUserId),
    },
    projects: projectsResult.rows.map((row) => publicProject({ ...row, owner_name: participant.name, owner_slug: participant.slug, owner_profile_image_url: participant.profile_image_url, owner_total_stars: participant.total_stars })),
  };
}

export async function toggleProjectLike(userId, projectId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const project = await client.query(`SELECT id FROM projects p WHERE p.id = $1 AND ${PUBLIC_PROJECT_EXCLUSIONS} FOR UPDATE`, [projectId]);
    if (!project.rows[0]) throw new Error("Project not found.");
    const removed = await client.query(`DELETE FROM project_likes WHERE project_id = $1 AND user_id = $2 RETURNING project_id`, [projectId, userId]);
    const liked = removed.rowCount === 0;
    if (liked) await client.query(`INSERT INTO project_likes (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [projectId, userId]);
    const count = await client.query(`SELECT COUNT(*)::int AS count FROM project_likes WHERE project_id = $1`, [projectId]);
    await client.query("COMMIT");
    return { liked, likeCount: Number(count.rows[0]?.count || 0) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listProjectComments(projectId, viewerUserId = null) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const project = await pool.query(`SELECT p.id FROM projects p WHERE p.id = $1 AND ${PUBLIC_PROJECT_EXCLUSIONS}`, [projectId]);
  if (!project.rows[0]) throw new Error("Project not found.");
  const result = await pool.query(
    `
      SELECT c.id, c.body, c.created_at, c.updated_at, u.id AS user_id,
        u.slug, u.name, u.profile_image_url, (c.user_id = $2::int) AS is_own_comment
      FROM project_comments c JOIN users u ON u.id = c.user_id
      WHERE c.project_id = $1 ORDER BY c.created_at ASC, c.id ASC
    `,
    [projectId, viewerUserId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id), body: row.body, createdAt: row.created_at, updatedAt: row.updated_at,
    isOwnComment: Boolean(row.is_own_comment),
    author: { id: Number(row.user_id), name: row.slug || row.name || "Venture maker", slug: row.slug, profileImageUrl: row.profile_image_url },
  }));
}

export async function createProjectComment(userId, projectId, body) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const text = normalizeProjectComment(body);
  const result = await pool.query(
    `
      INSERT INTO project_comments (project_id, user_id, body)
      SELECT p.id, $2, $3 FROM projects p WHERE p.id = $1 AND ${PUBLIC_PROJECT_EXCLUSIONS}
      RETURNING id, body, created_at, updated_at
    `,
    [projectId, userId, text]
  );
  if (!result.rows[0]) throw new Error("Project not found.");
  return { ...result.rows[0], id: Number(result.rows[0].id), createdAt: result.rows[0].created_at, updatedAt: result.rows[0].updated_at };
}

export async function deleteProjectComment(userId, commentId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query(`DELETE FROM project_comments WHERE id = $1 AND user_id = $2 RETURNING id`, [commentId, userId]);
  return result.rowCount > 0;
}

export async function toggleUserFollowWithPool(dbPool, followerUserId, followedUserId) {
  if (!dbPool) throw new Error("DATABASE_URL is not set.");
  if (Number(followerUserId) === Number(followedUserId)) throw new Error("You can't follow yourself.");
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [followedUserId]);
    if (!target.rows[0]) throw new Error("Participant not found.");
    const removed = await client.query(
      `DELETE FROM user_follows WHERE follower_user_id = $1 AND followed_user_id = $2 RETURNING followed_user_id`,
      [followerUserId, followedUserId]
    );
    const following = removed.rowCount === 0;
    if (following) {
      await client.query(
        `INSERT INTO user_follows (follower_user_id, followed_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [followerUserId, followedUserId]
      );
    }
    const count = await client.query(
      `SELECT COUNT(*)::int AS count FROM user_follows WHERE followed_user_id = $1`,
      [followedUserId]
    );
    await client.query("COMMIT");
    return { following, followerCount: Number(count.rows[0]?.count || 0) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function toggleUserFollow(followerUserId, followedUserId) {
  return toggleUserFollowWithPool(pool, followerUserId, followedUserId);
}
