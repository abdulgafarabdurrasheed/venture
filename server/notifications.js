import { pool } from "./db.js";

export async function ensureNotificationsTable() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT FALSE,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  
  // Fast lookup for unread count
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id) WHERE read = FALSE`
  );
}

export async function insertNotification(userId, type, message, metadata = {}) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO notifications (user_id, type, message, metadata) VALUES ($1, $2, $3, $4)`,
    [userId, type, message, metadata]
  );
}

export async function getUnreadNotifications(userId) {
  if (!pool) return [];
  const res = await pool.query(
    `SELECT id, type, message, read, metadata, created_at FROM notifications WHERE user_id = $1 AND read = FALSE ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function markNotificationRead(userId, notificationId) {
  if (!pool) return false;
  const res = await pool.query(
    `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );
  return res.rowCount > 0;
}
