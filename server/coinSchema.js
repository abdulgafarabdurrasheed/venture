import { pool } from "./db.js";

/** Rename legacy `bricks` columns to `coins` on existing databases. Idempotent. */
export async function migrateBrickColumnsToCoins() {
  if (!pool) return;

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'bricks'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'coins'
      ) THEN
        ALTER TABLE users RENAME COLUMN bricks TO coins;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'bricks_earned'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'coins_earned'
      ) THEN
        ALTER TABLE projects RENAME COLUMN bricks_earned TO coins_earned;
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'shop_orders' AND column_name = 'total_bricks'
      ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'shop_orders' AND column_name = 'total_coins'
      ) THEN
        ALTER TABLE shop_orders RENAME COLUMN total_bricks TO total_coins;
      END IF;
    END $$;
  `);
}
