import { pool } from "./db.js";

export async function ensureAuditLogTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGSERIAL PRIMARY KEY,
      admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC)`);
}

export async function logAuditEvent({ adminUserId, action, targetType, targetId, details }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO audit_log (admin_user_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminUserId ?? null, action, targetType ?? null, targetId ? String(targetId) : null, JSON.stringify(details ?? {})]
  );
}

export async function getAuditLogForTarget(targetType, targetId, { limit = 50 } = {}) {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT
       a.id,
       a.action,
       a.target_type,
       a.target_id,
       a.details,
       a.created_at,
       u.email AS admin_email
     FROM audit_log a
     LEFT JOIN users u ON u.id = a.admin_user_id
     WHERE a.target_type = $1 AND a.target_id = $2
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [targetType, String(targetId), limit]
  );
  return result.rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details,
    createdAt: r.created_at,
    adminEmail: r.admin_email,
  }));
}

export async function adjustUserCoins(adminUserId, targetUserId, { delta, reason }) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  if (typeof delta !== "number" || isNaN(delta)) throw new Error("Invalid delta.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE users
       SET coins = coins + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, coins`,
      [delta, targetUserId]
    );

    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      throw new Error("User not found.");
    }

    const newBalance = Number(result.rows[0].coins);

    await client.query(
      `INSERT INTO audit_log (admin_user_id, action, target_type, target_id, details)
       VALUES ($1, 'balance_adjustment', 'user', $2, $3)`,
      [adminUserId ?? null, String(targetUserId), JSON.stringify({ delta, reason: reason || null, newBalance })]
    );

    await client.query("COMMIT");
    return { id: Number(result.rows[0].id), coins: newBalance };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getAdminStats() {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const [projectResult, journalResult, walletResult, earnedResult, userResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
        COUNT(*) FILTER (WHERE status = 'in-review')::int AS in_review,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COALESCE(SUM(total_hours), 0) AS total_hours,
        COALESCE(SUM(approved_hours), 0) AS approved_hours,
        COALESCE(SUM(
          GREATEST(
            COALESCE(total_hours, 0) + COALESCE(hackatime_hours, 0) - GREATEST(
              COALESCE(last_shipped_hours, 0),
              COALESCE(past_approved_hours, 0),
              COALESCE(approved_hours, 0)
            ),
            0
          )
        ) FILTER (WHERE status IN ('in-review', 'pending-reship')), 0) AS pending_review_hours
      FROM projects
    `),
    pool.query(`
      SELECT COALESCE(SUM(hours_worked), 0) AS total_journal_hours FROM journal_entries
    `),
    pool.query(`SELECT COALESCE(SUM(coins), 0) AS wallet_coins FROM users`),
    pool.query(`
      SELECT COALESCE(SUM(coins_earned), 0) AS total_earned FROM projects WHERE COALESCE(approved_hours, 0) > 0
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE role IN ('reviewer', 'admin', 'superadmin'))::int AS reviewers,
        COUNT(DISTINCT p.user_id)::int AS users_with_projects,
        COUNT(DISTINCT p2.user_id)::int AS users_with_approved
      FROM users u
      LEFT JOIN projects p ON p.user_id = u.id
      LEFT JOIN projects p2 ON p2.user_id = u.id AND p2.status = 'approved'
    `),
  ]);

  const pr = projectResult.rows[0];
  const jr = journalResult.rows[0];
  const wr = walletResult.rows[0];
  const er = earnedResult.rows[0];
  const ur = userResult.rows[0];

  const totalEarned = Number(er.total_earned);
  const walletCoins = Number(wr.wallet_coins);

  return {
    projects: {
      total: pr.total,
      draft: pr.draft,
      inReview: pr.in_review,
      approved: pr.approved,
      rejected: pr.rejected,
    },
    hours: {
      totalProjectHours: Number(pr.total_hours),
      approvedHours: Number(pr.approved_hours),
      pendingReviewHours: Number(pr.pending_review_hours),
      totalJournalHours: Number(jr.total_journal_hours),
    },
    coins: {
      totalEarned,
      inWallets: walletCoins,
      spent: Math.max(0, totalEarned - walletCoins),
    },
    users: {
      total: ur.total_users,
      reviewers: ur.reviewers,
      withProjects: ur.users_with_projects,
      withApprovedProjects: ur.users_with_approved,
    },
  };
}
