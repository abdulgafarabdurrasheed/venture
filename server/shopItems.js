import { persistOrderAirtableRecordId, syncShopOrderToAirtable } from "./airtableOrders.js";
import { pool } from "./db.js";
import { GRANT_TERMS_VERSION, snapshotAcknowledgedGrantTerms } from "./grantTerms.js";
import { normalizeShopLabelColor, shopLabelColorHex } from "./shopLabelColors.js";
import { setCoinLedgerContext } from "./coinLedger.js";

const SHOP_ITEM_COLUMNS = [
  "name",
  "price",
  "item_link",
  "image_url",
  "description",
  "active",
  "created_at",
  "updated_at",
  "max_per_person",
  "price_usd",
  "discount_percent",
  "airtable_id",
  "synced_at",
  "position",
  "frame_label",
  "frame_label_color",
  "required_stars",
];

const REMOVED_SHOP_ITEM_COLUMNS = [
  "category",
  "grant_type",
  "shop_grant_type_id",
  "item_quantity",
  "shipping_tax_cents",
  "dollar_per_hour",
];

const REMOVED_SHOP_ORDER_COLUMNS = ["total_bricks", "shipping_tax_usd"];

export async function ensureShopItemsTable() {
  if (!pool) {
    console.warn("[shop] DATABASE_URL not set; skipping shop_items table setup.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_items (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR,
      price NUMERIC(10, 2),
      item_link VARCHAR,
      image_url VARCHAR,
      description TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      max_per_person INTEGER,
      price_usd NUMERIC(10, 2),
      discount_percent NUMERIC(5, 2),
      airtable_id VARCHAR,
      synced_at DATE,
      required_stars INTEGER NOT NULL DEFAULT 0
    )
  `);

  for (const column of SHOP_ITEM_COLUMNS) {
    await ensureShopItemColumn(column);
  }

  await migrateLegacyShopItemsSchema();

  for (const column of REMOVED_SHOP_ITEM_COLUMNS) {
    await pool.query(`ALTER TABLE shop_items DROP COLUMN IF EXISTS ${column}`);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_orders (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id BIGINT REFERENCES shop_items(id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      total_coins NUMERIC(10, 2) NOT NULL,
      fulfilled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS total_coins NUMERIC(10, 2) NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fulfilled BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS rejected BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP(6) WITHOUT TIME ZONE
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS total_usd NUMERIC(10, 2)
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS item_usage TEXT
  `);
  await pool.query(`
    ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS airtable_record_id VARCHAR
  `);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS item_name_snapshot VARCHAR`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS item_price_snapshot NUMERIC(10, 2)`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS item_price_usd_snapshot NUMERIC(10, 2)`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS grant_terms_version VARCHAR`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS grant_terms_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS grant_acknowledged_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS grant_issued_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS grant_issued_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS grant_issuance_reference VARCHAR`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS grant_issuance_note TEXT`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fulfilled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS fulfillment_note TEXT`);

  await migrateLegacyShopOrdersSchema();

  await pool.query(`
    UPDATE shop_orders
    SET item_name_snapshot = shop_items.name,
        item_price_snapshot = shop_items.price,
        item_price_usd_snapshot = shop_items.price_usd
    FROM shop_items
    WHERE shop_orders.item_id = shop_items.id
      AND (shop_orders.item_name_snapshot IS NULL
        OR shop_orders.item_price_snapshot IS NULL
        OR shop_orders.item_price_usd_snapshot IS NULL)
  `);
  await preserveShopOrderItemHistory();

  for (const column of REMOVED_SHOP_ORDER_COLUMNS) {
    await pool.query(`ALTER TABLE shop_orders DROP COLUMN IF EXISTS ${column}`);
  }
}

async function preserveShopOrderItemHistory() {
  const constraints = await pool.query(`
    SELECT constraint_row.conname, constraint_row.confdeltype
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_attribute AS column_row
      ON column_row.attrelid = table_row.oid
      AND column_row.attnum = ANY(constraint_row.conkey)
    WHERE table_row.relname = 'shop_orders'
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'shop_items'::regclass
      AND column_row.attname = 'item_id'
  `);

  for (const constraint of constraints.rows) {
    if (constraint.confdeltype === "n") continue;
    await pool.query(`ALTER TABLE shop_orders DROP CONSTRAINT ${quoteIdentifier(constraint.conname)}`);
  }

  await pool.query(`ALTER TABLE shop_orders ALTER COLUMN item_id DROP NOT NULL`);
  const hasSetNullConstraint = constraints.rows.some((constraint) => constraint.confdeltype === "n");
  if (!hasSetNullConstraint) {
    await pool.query(`
      ALTER TABLE shop_orders
      ADD CONSTRAINT shop_orders_item_id_history_fkey
      FOREIGN KEY (item_id) REFERENCES shop_items(id) ON DELETE SET NULL
    `);
  }
}

async function migrateLegacyShopItemsSchema() {
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shop_items'
  `);
  const columns = new Set(result.rows.map((row) => row.column_name));

  if (columns.has("created_at")) {
    await pool.query(`ALTER TABLE shop_items ALTER COLUMN created_at SET DEFAULT NOW()`);
    await pool.query(`UPDATE shop_items SET created_at = NOW() WHERE created_at IS NULL`);
  }
  if (columns.has("updated_at")) {
    await pool.query(`ALTER TABLE shop_items ALTER COLUMN updated_at SET DEFAULT NOW()`);
    await pool.query(`UPDATE shop_items SET updated_at = NOW() WHERE updated_at IS NULL`);
  }

  if (columns.has("position")) {
    await pool.query(`
      UPDATE shop_items
      SET position = ranked.position
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1 AS position
        FROM shop_items
      ) AS ranked
      WHERE shop_items.id = ranked.id
        AND shop_items.position IS NULL
    `);
    await pool.query(`UPDATE shop_items SET position = 0 WHERE position IS NULL`);
  }

  if (!columns.has("frame_label_color")) {
    await pool.query(`
      ALTER TABLE shop_items
      ADD COLUMN frame_label_color VARCHAR NOT NULL DEFAULT 'green'
    `);
  } else {
    await pool.query(`
      UPDATE shop_items
      SET frame_label_color = 'green'
      WHERE frame_label_color IS NULL OR TRIM(frame_label_color) = ''
    `);
  }
}

async function migrateLegacyShopOrdersSchema() {
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shop_orders'
  `);
  const columns = new Set(result.rows.map((row) => row.column_name));

  if (columns.has("shop_item_id") && !columns.has("item_id")) {
    await pool.query(`ALTER TABLE shop_orders RENAME COLUMN shop_item_id TO item_id`);
    columns.delete("shop_item_id");
    columns.add("item_id");
  }

  if (columns.has("created_at")) {
    await pool.query(`ALTER TABLE shop_orders ALTER COLUMN created_at SET DEFAULT NOW()`);
    await pool.query(`UPDATE shop_orders SET created_at = NOW() WHERE created_at IS NULL`);
  }
  if (columns.has("updated_at")) {
    await pool.query(`ALTER TABLE shop_orders ALTER COLUMN updated_at SET DEFAULT NOW()`);
    await pool.query(`UPDATE shop_orders SET updated_at = NOW() WHERE updated_at IS NULL`);
  }
}

async function ensureShopItemColumn(column) {
  const columnDefinitions = {
    name: "VARCHAR",
    price: "NUMERIC(10, 2)",
    item_link: "VARCHAR",
    image_url: "VARCHAR",
    description: "TEXT",
    active: "BOOLEAN NOT NULL DEFAULT TRUE",
    created_at: "TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT NOW()",
    updated_at: "TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL DEFAULT NOW()",
    max_per_person: "INTEGER",
    price_usd: "NUMERIC(10, 2)",
    discount_percent: "NUMERIC(5, 2)",
    airtable_id: "VARCHAR",
    synced_at: "DATE",
    position: "INTEGER NOT NULL DEFAULT 0",
    frame_label: "VARCHAR",
    frame_label_color: "VARCHAR NOT NULL DEFAULT 'green'",
    required_stars: "INTEGER NOT NULL DEFAULT 0",
  };

  await pool.query(`ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS ${column} ${columnDefinitions[column]}`);
}

export async function listShopItems({ includeInactive = false } = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const filters = ["TRIM(COALESCE(name, '')) <> ''"];
  if (!includeInactive) filters.push("active IS TRUE");
  const where = `WHERE ${filters.join(" AND ")}`;
  const result = await pool.query(`
    SELECT *
    FROM shop_items
    ${where}
    ORDER BY position ASC, id ASC
  `);
  return result.rows.map(toPublicShopItem);
}

async function nextShopItemPosition(client = pool) {
  const result = await client.query(`
    SELECT COALESCE(MAX(position), -1) + 1 AS next_position
    FROM shop_items
  `);
  return Number(result.rows[0]?.next_position ?? 0);
}

export async function createShopItem(input) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const values = normalizeShopItemInput(input);
  const position =
    values.position === null ? await nextShopItemPosition() : values.position;
  const result = await pool.query(
    `
      INSERT INTO shop_items (
        name, price, item_link, image_url, description, active, max_per_person,
        price_usd, discount_percent, airtable_id, synced_at, required_stars, position, frame_label, frame_label_color,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
      )
      RETURNING *
    `,
    [...shopItemValues(values), position, values.frameLabel, values.frameLabelColor]
  );
  return toPublicShopItem(result.rows[0]);
}

function pickDefinedFields(input = {}) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

export async function updateShopItem(id, input) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const existingResult = await pool.query("SELECT * FROM shop_items WHERE id = $1", [id]);
  const existing = existingResult.rows[0];
  if (!existing) return null;

  const merged = {
    ...toPublicShopItem(existing),
    ...pickDefinedFields(input),
    id: existing.id,
  };
  const values = normalizeShopItemInput(merged);
  const position = values.position === null ? Number(existing.position ?? 0) : values.position;

  if ("frameLabelColor" in input || "frame_label_color" in input) {
    values.frameLabelColor = normalizeShopLabelColor(input.frameLabelColor ?? input.frame_label_color);
  } else {
    values.frameLabelColor = normalizeShopLabelColor(existing.frame_label_color);
  }

  const result = await pool.query(
    `
      UPDATE shop_items
      SET
        name = $1,
        price = $2,
        item_link = $3,
        image_url = $4,
        description = $5,
        active = $6,
        max_per_person = $7,
        price_usd = $8,
        discount_percent = $9,
        airtable_id = $10,
        synced_at = $11,
        required_stars = $12,
        position = $13,
        frame_label = $14,
        frame_label_color = $15,
        updated_at = NOW()
      WHERE id = $16
      RETURNING *
    `,
    [...shopItemValues(values), position, values.frameLabel, values.frameLabelColor, id]
  );

  return result.rows[0] ? toPublicShopItem(result.rows[0]) : null;
}

export async function deleteShopItem(id) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query("DELETE FROM shop_items WHERE id = $1", [id]);
  return result.rowCount > 0;
}

export async function setAllShopItemsActive(active) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  await pool.query("UPDATE shop_items SET active = $1, updated_at = NOW()", [Boolean(active)]);
}

export async function reorderShopItems(orderedIds) {
  if (!pool) throw new Error("DATABASE_URL is not set.");
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error("Order must be a non-empty list of item ids.");
  }

  const ids = orderedIds.map((id) => integerOrNull(id)).filter((id) => id !== null);
  if (ids.length !== orderedIds.length) {
    throw new Error("Order contains invalid item ids.");
  }

  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw new Error("Order contains duplicate item ids.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(`SELECT id FROM shop_items WHERE id = ANY($1::bigint[])`, [ids]);
    if (existing.rowCount !== ids.length) {
      throw new Error("One or more shop items were not found.");
    }

    for (let index = 0; index < ids.length; index += 1) {
      await client.query(
        `
          UPDATE shop_items
          SET position = $1, updated_at = NOW()
          WHERE id = $2
        `,
        [index, ids[index]]
      );
    }

    await client.query("COMMIT");
    return listShopItems({ includeInactive: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeItemUsage(value) {
  const text = textOrNull(value);
  if (!text) {
    throw new Error("Please describe what you will buy with this grant.");
  }
  if (text.length > 2000) {
    throw new Error("Usage description must be 2000 characters or fewer.");
  }
  return text;
}

export async function purchaseShopItemForUser(userId, itemId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const grantTermsSnapshot = snapshotAcknowledgedGrantTerms(input);
  const itemUsage = normalizeItemUsage(input.itemUsage ?? input.item_usage);

  const quantity = 1;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const itemResult = await client.query(
      `
        SELECT *
        FROM shop_items
        WHERE id = $1
          AND active IS TRUE
        FOR UPDATE
      `,
      [itemId]
    );
    const item = itemResult.rows[0];
    if (!item) throw new Error("Shop item not found.");

    const amountUsd = numberOrNull(item.price_usd);
    const totalCoins = numberOrNull(item.price);
    if (amountUsd === null || amountUsd <= 0 || totalCoins === null || totalCoins <= 0) {
      throw new Error("This shop item is not available for purchase until staff sets its grant amount and coin cost.");
    }

    const currentUserResult = await client.query("SELECT total_stars, coins FROM users WHERE id = $1", [userId]);
    const user = currentUserResult.rows[0];
    if (!user) throw new Error("User not found.");

    if (item.required_stars > 0 && user.total_stars < item.required_stars) {
      throw new Error(`This item requires ${item.required_stars} star(s) to unlock. You have ${user.total_stars}.`);
    }

    if (item.max_per_person) {
      const countResult = await client.query(
        `
          SELECT COUNT(*)::int AS count
          FROM shop_orders
          WHERE user_id = $1
            AND item_id = $2
            AND rejected IS NOT TRUE
        `,
        [userId, itemId]
      );
      const purchaseCount = Number(countResult.rows[0]?.count ?? 0);
      if (purchaseCount >= item.max_per_person) {
        throw new Error(`Limit is ${item.max_per_person} purchase(s) per person for this item.`);
      }
    }

    await setCoinLedgerContext(client, { reason: "shop_purchase", referenceType: "shop_item", referenceId: itemId, actorUserId: userId });
    const userResult = await client.query(
      `
        UPDATE users
        SET coins = coins - $1,
            updated_at = NOW()
        WHERE id = $2
          AND coins >= $1
        RETURNING id, coins
      `,
      [totalCoins, userId]
    );

    if (!userResult.rows[0]) {
      const currentUser = await client.query("SELECT coins FROM users WHERE id = $1", [userId]);
      const availableCoins = Number(currentUser.rows[0]?.coins ?? 0);
      throw new Error(
        `Not enough coins. You have ${formatCoinAmount(availableCoins)} coins, but this item costs ${formatCoinAmount(totalCoins)} coins.`
      );
    }

    const orderResult = await client.query(
      `
        INSERT INTO shop_orders (
          user_id, item_id, item_name_snapshot, item_price_snapshot, item_price_usd_snapshot,
          quantity, total_coins, total_usd, item_usage, grant_terms_version,
          grant_terms_snapshot, grant_acknowledged_at, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW(), NOW())
        RETURNING id
      `,
      [
        userId,
        itemId,
        item.name,
        totalCoins,
        amountUsd,
        quantity,
        totalCoins,
        amountUsd,
        itemUsage,
        GRANT_TERMS_VERSION,
        grantTermsSnapshot,
      ]
    );

    await client.query("COMMIT");

    const orderId = orderResult.rows[0].id;
    trySyncShopOrderToAirtable(orderId).catch((error) => {
      console.error("[shop] Airtable _orders sync failed:", error.message);
    });

    return {
      item: toPublicShopItem(item),
      quantity,
      amountUsd,
      totalCoins,
      totalUsd: amountUsd,
      itemUsage,
      userCoins: Number(userResult.rows[0].coins ?? 0),
      orderId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function safeHttpUrl(value) {
  const text = textOrNull(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`URL must use http or https (got ${parsed.protocol})`);
    }
    return text;
  } catch (e) {
    throw new Error(e.message || "Invalid URL.");
  }
}

function normalizeShopItemInput(input = {}) {
  const price = optionalCoinPriceOrNull(input.price);
  const priceUsd = numberOrNull(input.priceUsd ?? input.price_usd);
  if (!textOrNull(input.name)) {
    throw new Error("Shop item name is required.");
  }
  if (price === null || price <= 0) {
    throw new Error("Set a positive whole-number coin cost for this shop item.");
  }
  if (priceUsd === null || priceUsd <= 0) {
    throw new Error("Set a positive grant amount for this shop item.");
  }
  if (Number(priceUsd.toFixed(2)) !== priceUsd) {
    throw new Error("Grant amount must use at most two decimal places.");
  }

  return {
    name: textOrNull(input.name),
    price,
    itemLink: safeHttpUrl(input.itemLink ?? input.item_link),
    imageUrl: safeHttpUrl(input.imageUrl ?? input.image_url),
    description: textOrNull(input.description),
    active: input.active === undefined ? true : Boolean(input.active),
    maxPerPerson: integerOrNull(input.maxPerPerson ?? input.max_per_person),
    priceUsd,
    discountPercent: discountPercentOrNull(input.discountPercent ?? input.discount_percent),
    airtableId: textOrNull(input.airtableId ?? input.airtable_id),
    syncedAt: dateOrNull(input.syncedAt ?? input.synced_at),
    position: integerOrNull(input.position),
    frameLabel: textOrNull(input.frameLabel ?? input.frame_label),
    requiredStars: integerOrNull(input.requiredStars ?? input.required_stars) || 0,
    frameLabelColor: normalizeShopLabelColor(input.frameLabelColor ?? input.frame_label_color),
  };
}

function shopItemValues(item) {
  return [
    item.name,
    item.price,
    item.itemLink,
    item.imageUrl,
    item.description,
    item.active,
    item.maxPerPerson,
    item.priceUsd,
    item.discountPercent,
    item.airtableId,
    item.syncedAt,
    item.requiredStars,
  ];
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function requiredText(value, label, maxLength) {
  const text = textOrNull(value);
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function optionalText(value, label, maxLength) {
  const text = textOrNull(value);
  if (text && text.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  return text;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.trunc(number);
}

function optionalCoinPriceOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const price = numberOrNull(value);
  if (price === null || !Number.isInteger(price) || price < 0) {
    throw new Error("Coin cost must be a non-negative whole number.");
  }
  return price;
}

function formatCoinAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function discountPercentOrNull(value) {
  const number = numberOrNull(value);
  if (number === null || number <= 0) return null;
  return Math.min(100, Number(number.toFixed(2)));
}

function dateOrNull(value) {
  const text = textOrNull(value);
  return text;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function listShopOrders() {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(`
    SELECT
      o.id,
      o.user_id,
      u.email,
      o.item_id,
      COALESCE(o.item_name_snapshot, i.name, 'Deleted shop item') AS item_name,
      COALESCE(o.item_price_snapshot, i.price) AS item_coins,
      COALESCE(o.item_price_usd_snapshot, i.price_usd) AS item_price_usd,
      o.quantity,
      o.total_coins,
      o.total_usd,
      o.item_usage,
      o.fulfilled,
      o.rejected,
      o.created_at,
      o.rejected_at,
      o.grant_terms_version,
      o.grant_terms_snapshot,
      o.grant_acknowledged_at,
      o.grant_issued_at,
      o.grant_issued_by_user_id,
      grant_issuer.email AS grant_issued_by_email,
      o.grant_issuance_reference,
      o.grant_issuance_note,
      o.fulfilled_at,
      o.fulfilled_by_user_id,
      fulfiller.email AS fulfilled_by_email,
      o.fulfillment_note
    FROM shop_orders o
    JOIN users u ON o.user_id = u.id
    LEFT JOIN shop_items i ON o.item_id = i.id
    LEFT JOIN users grant_issuer ON grant_issuer.id = o.grant_issued_by_user_id
    LEFT JOIN users fulfiller ON fulfiller.id = o.fulfilled_by_user_id
    ORDER BY o.created_at DESC
  `);

  return result.rows.map(toPublicShopOrder);
}

export async function listShopOrdersForUser(userId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(
    `
      SELECT
        o.id,
        o.user_id,
        u.email,
        o.item_id,
        COALESCE(o.item_name_snapshot, i.name, 'Deleted shop item') AS item_name,
        COALESCE(o.item_price_snapshot, i.price) AS item_coins,
        COALESCE(o.item_price_usd_snapshot, i.price_usd) AS item_price_usd,
        o.quantity,
        o.total_coins,
        o.total_usd,
        o.item_usage,
        o.fulfilled,
        o.rejected,
        o.created_at,
        o.rejected_at,
        o.grant_terms_version,
        o.grant_terms_snapshot,
        o.grant_acknowledged_at,
        o.grant_issued_at,
        o.grant_issued_by_user_id,
        o.grant_issuance_reference,
        o.grant_issuance_note,
        o.fulfilled_at,
        o.fulfilled_by_user_id,
        o.fulfillment_note
      FROM shop_orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN shop_items i ON o.item_id = i.id
      WHERE o.user_id = $1
      ORDER BY o.created_at DESC
    `,
    [userId]
  );

  return result.rows.map(toPublicShopOrder);
}

export async function listPendingShopOrdersForUser(userId) {
  const orders = await listShopOrdersForUser(userId);
  return orders.filter((order) => !order.fulfilled && !order.rejected);
}

/** Minimal order fields for staff review hour-reduction workflow (no email / usage text). */
export function toReviewParticipantShopOrder(order) {
  return {
    id: order.id,
    itemName: order.itemName,
    quantity: order.quantity,
    totalCoins: order.totalCoins,
    totalUsd: order.totalUsd,
    createdAt: order.createdAt,
  };
}

export async function recordShopOrderGrantIssuance(orderId, actorUserId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const reference = requiredText(input.reference ?? input.grantReference, "Grant reference", 256);
  const note = optionalText(input.note, "Issuance note", 2000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM shop_orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = current.rows[0];
    if (!order) throw new Error("Order not found.");
    if (order.rejected) throw new Error("Rejected orders cannot receive a grant.");
    if (order.fulfilled) throw new Error("Fulfilled orders cannot be changed.");
    if (order.grant_issued_at) throw new Error("A grant has already been recorded for this order.");

    const result = await client.query(
      `
        UPDATE shop_orders
        SET grant_issued_at = NOW(),
            grant_issued_by_user_id = $2,
            grant_issuance_reference = $3,
            grant_issuance_note = $4,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [orderId, actorUserId, reference, note]
    );
    await client.query("COMMIT");
    const issuedOrder = toPublicShopOrder(result.rows[0]);
    trySyncShopOrderToAirtable(orderId).catch((error) => {
      console.error("[shop] Airtable _orders sync failed:", error.message);
    });
    return issuedOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markShopOrderFulfilled(orderId, actorUserId, input = {}) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const note = requiredText(input.note, "Fulfillment note", 2000);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM shop_orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = current.rows[0];
    if (!order) throw new Error("Order not found.");
    if (order.rejected) throw new Error("Rejected orders cannot be fulfilled.");
    if (order.fulfilled) throw new Error("Order is already fulfilled.");
    if (!order.grant_issued_at || !order.grant_issuance_reference) {
      throw new Error("Record the issued grant reference before marking this order fulfilled.");
    }

    const result = await client.query(
      `
        UPDATE shop_orders
        SET fulfilled = TRUE,
            fulfilled_at = NOW(),
            fulfilled_by_user_id = $2,
            fulfillment_note = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [orderId, actorUserId, note]
    );
    await client.query("COMMIT");
    const fulfilledOrder = toPublicShopOrder(result.rows[0]);
    trySyncShopOrderToAirtable(orderId).catch((error) => {
      console.error("[shop] Airtable _orders sync failed:", error.message);
    });
    return fulfilledOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectShopOrderWithRefund(orderId, actorUserId = null) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `
        SELECT *
        FROM shop_orders
        WHERE id = $1
        FOR UPDATE
      `,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) throw new Error("Order not found.");
    if (order.fulfilled) throw new Error("Fulfilled orders cannot be rejected.");
    if (order.rejected) throw new Error("Order is already rejected.");
    if (order.grant_issued_at) throw new Error("An issued grant cannot be rejected or refunded here. Resolve it manually.");

    await setCoinLedgerContext(client, { reason: "shop_order_refund", referenceType: "shop_order", referenceId: orderId, actorUserId });
    await client.query("UPDATE users SET coins = coins + $1, updated_at = NOW() WHERE id = $2", [
      Number(order.total_coins ?? 0),
      order.user_id,
    ]);

    const result = await client.query(
      `
        UPDATE shop_orders
        SET rejected = TRUE,
            rejected_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [orderId]
    );

    await client.query("COMMIT");
    const rejectedOrder = toPublicShopOrder(result.rows[0]);
    trySyncShopOrderToAirtable(orderId).catch((error) => {
      console.error("[shop] Airtable _orders sync failed:", error.message);
    });
    return rejectedOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getShopOrderRowForAirtableSync(orderId) {
  if (!pool) return null;
  const result = await pool.query(
    `
      SELECT
        o.*,
        u.email,
        COALESCE(o.item_name_snapshot, i.name, 'Deleted shop item') AS item_name
      FROM shop_orders o
      JOIN users u ON o.user_id = u.id
      LEFT JOIN shop_items i ON o.item_id = i.id
      WHERE o.id = $1
    `,
    [orderId]
  );
  return result.rows[0] ?? null;
}

async function trySyncShopOrderToAirtable(orderId) {
  const row = await getShopOrderRowForAirtableSync(orderId);
  if (!row) return;
  try {
    const result = await syncShopOrderToAirtable(row);
    if (result.recordId) {
      await persistOrderAirtableRecordId(orderId, result.recordId);
    }
    if (result.ok && !result.skipped) {
      console.log("[shop] Airtable orders sync:", {
        orderId,
        recordId: result.recordId,
        created: result.created,
      });
    } else if (result.skipped) {
      console.warn("[shop] Airtable orders sync skipped:", { orderId, reason: result.reason });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[shop] Airtable orders sync failed:", { orderId, message });
    throw error;
  }
}

function shopItemImageUrl(row) {
  return row.image_url || row.link || null;
}

function toPublicShopItem(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    itemLink: row.item_link,
    imageUrl: shopItemImageUrl(row),
    description: row.description,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    maxPerPerson: row.max_per_person,
    priceUsd: row.price_usd,
    discountPercent: row.discount_percent,
    airtableId: row.airtable_id,
    syncedAt: row.synced_at,
    position: row.position ?? 0,
    frameLabel: row.frame_label,
    frameLabelColor: normalizeShopLabelColor(row.frame_label_color),
    requiredStars: Number(row.required_stars ?? 0),
    frameLabelHex: shopLabelColorHex(row.frame_label_color),
  };
}

function toPublicShopOrder(row) {
  let grantTermsSnapshot = row.grant_terms_snapshot ?? [];
  if (typeof grantTermsSnapshot === "string") {
    try {
      grantTermsSnapshot = JSON.parse(grantTermsSnapshot);
    } catch {
      grantTermsSnapshot = [];
    }
  }

  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    itemId: row.item_id,
    itemName: row.item_name ?? row.item_name_snapshot ?? "Deleted shop item",
    itemCoins: row.item_coins ?? row.item_price_snapshot,
    itemPriceUsd: row.item_price_usd ?? row.item_price_usd_snapshot,
    quantity: row.quantity,
    totalCoins: row.total_coins,
    totalUsd: row.total_usd,
    itemUsage: row.item_usage,
    fulfilled: row.fulfilled,
    rejected: row.rejected,
    status: row.rejected ? "rejected" : row.fulfilled ? "fulfilled" : row.grant_issued_at ? "issued" : "pending",
    createdAt: row.created_at,
    rejectedAt: row.rejected_at,
    grantTermsVersion: row.grant_terms_version,
    grantTermsSnapshot,
    grantAcknowledgedAt: row.grant_acknowledged_at,
    grantIssuedAt: row.grant_issued_at,
    grantIssuedByUserId: row.grant_issued_by_user_id,
    grantIssuedByEmail: row.grant_issued_by_email,
    grantIssuanceReference: row.grant_issuance_reference,
    grantIssuanceNote: row.grant_issuance_note,
    fulfilledAt: row.fulfilled_at,
    fulfilledByUserId: row.fulfilled_by_user_id,
    fulfilledByEmail: row.fulfilled_by_email,
    fulfillmentNote: row.fulfillment_note,
  };
}
