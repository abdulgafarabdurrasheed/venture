import { persistOrderAirtableRecordId, syncShopOrderToAirtable } from "./airtableOrders.js";
import { MIN_PURCHASE_USD, usdToCoins } from "./coinRates.js";
import { pool } from "./db.js";
import { normalizeShopLabelColor, shopLabelColorHex } from "./shopLabelColors.js";

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
      synced_at DATE
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
      item_id BIGINT NOT NULL REFERENCES shop_items(id) ON DELETE CASCADE,
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

  await migrateLegacyShopOrdersSchema();

  for (const column of REMOVED_SHOP_ORDER_COLUMNS) {
    await pool.query(`ALTER TABLE shop_orders DROP COLUMN IF EXISTS ${column}`);
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
        price_usd, discount_percent, airtable_id, synced_at, position, frame_label, frame_label_color,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, NOW(), NOW()
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
        position = $12,
        frame_label = $13,
        frame_label_color = $14,
        updated_at = NOW()
      WHERE id = $15
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

  const amountUsd = numberOrNull(input.amountUsd ?? input.amount_usd ?? input.usdAmount);
  const totalCoins = usdToCoins(amountUsd);
  if (totalCoins === null) {
    throw new Error(`Minimum purchase is $${MIN_PURCHASE_USD.toFixed(2)}.`);
  }

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
        `Not enough coins. You have ${formatCoinAmount(availableCoins)} coins, but this costs ${formatCoinAmount(totalCoins)} (${formatUsdAmount(amountUsd)}).`
      );
    }

    const orderResult = await client.query(
      `
        INSERT INTO shop_orders (user_id, item_id, quantity, total_coins, total_usd, item_usage, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING id
      `,
      [userId, itemId, quantity, totalCoins, amountUsd, itemUsage]
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
  ];
}

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
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
  const price = integerOrNull(value);
  if (price === null || price < 0) {
    throw new Error("Legacy coin price must be a non-negative amount.");
  }
  return price;
}

function formatCoinAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
}

function formatUsdAmount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "$0.00";
  return `$${numeric.toFixed(2)}`;
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

export async function listShopOrders() {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(`
    SELECT
      o.id,
      o.user_id,
      u.email,
      o.item_id,
      i.name as item_name,
      i.price as item_coins,
      i.price_usd as item_price_usd,
      o.quantity,
      o.total_coins,
      o.total_usd,
      o.item_usage,
      o.fulfilled,
      o.rejected,
      o.created_at
    FROM shop_orders o
    JOIN users u ON o.user_id = u.id
    JOIN shop_items i ON o.item_id = i.id
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
        i.name as item_name,
        i.price as item_coins,
        i.price_usd as item_price_usd,
        o.quantity,
        o.total_coins,
        o.total_usd,
        o.item_usage,
        o.fulfilled,
        o.rejected,
        o.created_at
      FROM shop_orders o
      JOIN users u ON o.user_id = u.id
      JOIN shop_items i ON o.item_id = i.id
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

export async function markShopOrderFulfilled(orderId) {
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const result = await pool.query(
    `
      UPDATE shop_orders
      SET fulfilled = TRUE, updated_at = NOW()
      WHERE id = $1
        AND rejected IS NOT TRUE
      RETURNING *
    `,
    [orderId]
  );

  const order = result.rows[0] ? toPublicShopOrder(result.rows[0]) : null;
  if (order) {
    trySyncShopOrderToAirtable(orderId).catch((error) => {
      console.error("[shop] Airtable _orders sync failed:", error.message);
    });
  }
  return order;
}

export async function rejectShopOrderWithRefund(orderId) {
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
        i.name AS item_name
      FROM shop_orders o
      JOIN users u ON o.user_id = u.id
      JOIN shop_items i ON o.item_id = i.id
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
    frameLabelHex: shopLabelColorHex(row.frame_label_color),
  };
}

function toPublicShopOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    itemId: row.item_id,
    itemName: row.item_name,
    itemCoins: row.item_coins,
    itemPriceUsd: row.item_price_usd,
    quantity: row.quantity,
    totalCoins: row.total_coins,
    totalUsd: row.total_usd,
    itemUsage: row.item_usage,
    fulfilled: row.fulfilled,
    rejected: row.rejected,
    createdAt: row.created_at,
  };
}
