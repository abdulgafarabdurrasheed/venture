import { pool } from "./db.js";

export async function ensureCoinLedgerTable() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_coin_ledger (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount NUMERIC(10, 2) NOT NULL,
      balance_after NUMERIC(10, 2) NOT NULL,
      reason TEXT NOT NULL,
      reference_type TEXT,
      reference_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE user_coin_ledger ADD COLUMN IF NOT EXISTS actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_coin_ledger_user_created ON user_coin_ledger(user_id, created_at DESC, id DESC)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_coin_ledger_opening_balance ON user_coin_ledger(user_id) WHERE reason = 'opening_balance'`);

  await pool.query(`
    INSERT INTO user_coin_ledger (user_id, amount, balance_after, reason)
    SELECT users.id, users.coins, users.coins, 'opening_balance'
    FROM users
    ON CONFLICT DO NOTHING
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION record_user_coin_balance_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.coins IS DISTINCT FROM OLD.coins THEN
        INSERT INTO user_coin_ledger (
          user_id, actor_user_id, amount, balance_after, reason, reference_type, reference_id
        ) VALUES (
          NEW.id,
          NULLIF(current_setting('app.coin_ledger_actor_id', TRUE), '')::integer,
          NEW.coins - OLD.coins,
          NEW.coins,
          COALESCE(NULLIF(current_setting('app.coin_ledger_reason', TRUE), ''), 'balance_update'),
          NULLIF(current_setting('app.coin_ledger_reference_type', TRUE), ''),
          NULLIF(current_setting('app.coin_ledger_reference_id', TRUE), '')
        );
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await pool.query(`DROP TRIGGER IF EXISTS users_coin_balance_ledger ON users`);
  await pool.query(`
    CREATE TRIGGER users_coin_balance_ledger
    AFTER UPDATE OF coins ON users
    FOR EACH ROW
    EXECUTE FUNCTION record_user_coin_balance_change()
  `);
}

export async function setCoinLedgerContext(client, { reason, referenceType = null, referenceId = null, actorUserId = null } = {}) {
  await client.query(
    `SELECT
      set_config('app.coin_ledger_reason', $1, TRUE),
      set_config('app.coin_ledger_reference_type', $2, TRUE),
      set_config('app.coin_ledger_reference_id', $3, TRUE),
      set_config('app.coin_ledger_actor_id', $4, TRUE)`,
    [reason || "balance_update", referenceType || "", referenceId == null ? "" : String(referenceId), actorUserId == null ? "" : String(actorUserId)]
  );
}

export async function listUserCoinLedger(userId, limit = 100) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query(
    `
      SELECT id, user_id, actor_user_id, amount, balance_after, reason, reference_type, reference_id, created_at
      FROM user_coin_ledger
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `,
    [userId, Math.max(1, Math.min(500, Number(limit) || 100))]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    reason: row.reason,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    createdAt: row.created_at,
  }));
}
