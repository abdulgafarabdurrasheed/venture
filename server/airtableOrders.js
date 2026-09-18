import { pool } from "./db.js";

/**
 * Airtable shop orders table (Stack default: `_orders`)
 *
 * | Logical     | Airtable field | Type              |
 * |-------------|----------------|-------------------|
 * | orderId     | Order ID       | Number            |
 * | userId      | User ID        | Number            |
 * | userEmail   | User Email     | Email             |
 * | itemId      | Item ID        | Number            |
 * | itemName    | Item Name      | Single line text  |
 * | totalUsd    | Amount USD     | Number            |
 * | totalCoins  | Total Coins    | Number            |
 * | quantity    | Quantity       | Number            |
 * | status      | Status         | Single select     |
 * | itemUsage   | Item_usage     | Long text         |
 * | createdAt   | Created At     | Date              |
 */
const STANDARD_FIELD_NAMES = {
  orderId: "Order ID",
  userId: "User ID",
  userEmail: "User Email",
  itemId: "Item ID",
  itemName: "Item Name",
  totalUsd: "Amount USD",
  totalCoins: "Total Coins",
  quantity: "Quantity",
  status: "Status",
  itemUsage: "Item_usage",
  createdAt: "Created At",
};

const CANONICAL_FIELD_LABELS = {
  orderId: ["Order ID"],
  userId: ["User ID"],
  userEmail: ["User Email", "Email"],
  itemId: ["Item ID"],
  itemName: ["Item Name", "Name"],
  totalUsd: ["Amount USD", "Total USD", "USD"],
  totalCoins: ["Total Coins", "Coins"],
  quantity: ["Quantity", "Qty"],
  status: ["Status", "Order Status"],
  itemUsage: ["Item_usage", "Item Usage", "Item usage"],
  createdAt: ["Created At", "Created"],
};

const FIELD_FALLBACK_MATCHERS = {
  orderId: (name) => /order\s*id/i.test(name),
  userEmail: (name) => /user\s*email/i.test(name) || name.toLowerCase() === "email",
  totalUsd: (name) => /amount.*usd/i.test(name) || /total.*usd/i.test(name),
  itemUsage: (name) => /item.*usage/i.test(name),
  status: (name) => /\bstatus\b/i.test(name),
};

const airtableToken =
  process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;

function resolveOrdersAirtableTarget() {
  const fallbackBase = process.env.AIRTABLE_BASE_ID || process.env.AIRTABLE_APP || "";
  let configuredBase =
    process.env.AIRTABLE_ORDERS_BASE_ID || process.env.AIRTABLE_APP || process.env.AIRTABLE_BASE_ID || "";
  const configuredTableId = process.env.AIRTABLE_ORDERS_TABLE_ID || "";
  const configuredTableName = process.env.AIRTABLE_ORDERS_TABLE_NAME || "";
  const warnings = [];

  let tableTarget = configuredTableId || configuredTableName || "_orders";

  if (configuredBase.startsWith("tbl")) {
    if (!configuredTableId && !configuredTableName) {
      tableTarget = configuredBase;
      configuredBase = fallbackBase;
      warnings.push(
        "AIRTABLE_ORDERS_BASE_ID looked like a table ID (tbl…); using it as the orders table. Set AIRTABLE_BASE_ID=app… for the base."
      );
    } else {
      configuredBase = fallbackBase;
      warnings.push(
        "AIRTABLE_ORDERS_BASE_ID looked like a table ID (tbl…); ignored it in favor of AIRTABLE_BASE_ID."
      );
    }
  }

  const baseId = configuredBase;

  if (!baseId.startsWith("app")) {
    warnings.push("Airtable base ID should start with app… (set AIRTABLE_BASE_ID).");
  }

  return {
    baseId,
    table: tableTarget,
    tableKind: tableTarget.startsWith("tbl") ? "id" : "name",
    warnings,
  };
}

const ordersTarget = resolveOrdersAirtableTarget();
const airtableBaseId = ordersTarget.baseId;
const ordersTableTarget = ordersTarget.table;

export const hasAirtableOrdersConfig = Boolean(airtableToken && airtableBaseId?.startsWith("app"));

let cachedFieldMap = null;
let cachedFieldMapMeta = null;
let lastOrdersSyncError = null;

function getAirtableHeaders() {
  return {
    Authorization: `Bearer ${airtableToken}`,
    "Content-Type": "application/json",
  };
}

function getOrdersTableUrl() {
  return `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(ordersTableTarget)}`;
}

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function formulaField(fieldName) {
  const escaped = fieldName.replace(/\\/g, "\\\\").replace(/}/g, "\\}");
  return `{${escaped}}`;
}

function airtableDate(value) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function assignAirtableField(fields, key, value) {
  if (!key || value === undefined || value === null || value === "") return;
  fields[key] = value;
}

function resolveSchemaField(byName, labels) {
  for (const label of labels) {
    const field = byName.get(String(label).toLowerCase());
    if (field) return field;
  }
  return null;
}

function applyFieldFallbacks(table, map) {
  for (const [key, matcher] of Object.entries(FIELD_FALLBACK_MATCHERS)) {
    if (map[key]) continue;
    const field = (table.fields || []).find((entry) => matcher(entry.name));
    if (field) map[key] = field.id;
  }
}

function missingCanonicalLabels(map) {
  return Object.entries(CANONICAL_FIELD_LABELS)
    .filter(([key]) => !map[key])
    .map(([, labels]) => labels[0]);
}

async function fetchOrdersTableSchema() {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${airtableBaseId}/tables`, {
    headers: getAirtableHeaders(),
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || text || response.statusText;
    throw new Error(`Airtable orders schema request failed (${response.status}): ${message}`);
  }

  const table = (data.tables || []).find(
    (entry) =>
      entry.id === ordersTableTarget ||
      entry.name === ordersTableTarget ||
      entry.name?.toLowerCase() === String(ordersTableTarget).toLowerCase()
  );
  if (!table) {
    const available = (data.tables || []).map((entry) => `${entry.name} (${entry.id})`).join(", ");
    throw new Error(
      `Orders table "${ordersTableTarget}" not found in base ${airtableBaseId}. Available: ${available || "none"}`
    );
  }
  return table;
}

async function loadOrdersFieldMap() {
  if (cachedFieldMap) return cachedFieldMap;

  if (!hasAirtableOrdersConfig) {
    throw new Error("Airtable orders not configured.");
  }

  try {
    const table = await fetchOrdersTableSchema();
    const byName = new Map((table.fields || []).map((field) => [field.name.toLowerCase(), field]));
    const map = {};

    for (const [key, labels] of Object.entries(CANONICAL_FIELD_LABELS)) {
      const field = resolveSchemaField(byName, labels);
      if (field) {
        map[key] = field.id;
      }
    }

    applyFieldFallbacks(table, map);
    const missing = missingCanonicalLabels(map);

    if (Object.keys(map).length === 0) {
      throw new Error(`No matching order fields found on table "${table.name}".`);
    }

    cachedFieldMap = map;
    cachedFieldMapMeta = {
      mode: "schema-ids",
      tableName: table.name,
      resolved: Object.keys(map).length,
      missing,
      availableFieldNames: (table.fields || []).map((field) => field.name),
    };

    if (missing.length > 0) {
      console.warn(`[orders] Airtable table "${table.name}" missing optional fields: ${missing.join(", ")}`);
    } else {
      console.log(`[orders] Resolved ${Object.keys(map).length} order field IDs from table "${table.name}".`);
    }

    return cachedFieldMap;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[orders] Schema lookup failed, falling back to field names: ${message}`);
    cachedFieldMap = STANDARD_FIELD_NAMES;
    cachedFieldMapMeta = {
      mode: "names-fallback",
      resolved: Object.keys(STANDARD_FIELD_NAMES).length,
      missing: [],
      fieldMapError: message,
    };
    return cachedFieldMap;
  }
}

export function warmOrdersFieldMap() {
  if (!hasAirtableOrdersConfig) return Promise.resolve(null);
  return loadOrdersFieldMap();
}

export function getOrdersAirtableConfigStatus() {
  return {
    configured: hasAirtableOrdersConfig,
    baseId: airtableBaseId || null,
    table: ordersTableTarget,
    tableKind: ordersTarget.tableKind,
    warnings: ordersTarget.warnings,
    fieldMode: cachedFieldMapMeta?.mode || (hasAirtableOrdersConfig ? "pending" : null),
    fieldResolution: cachedFieldMapMeta,
    fieldMapError: cachedFieldMapMeta?.fieldMapError || null,
    lastError: lastOrdersSyncError,
  };
}

export function mapOrderStatusToAirtable(row) {
  if (row.rejected) return "rejected";
  if (row.fulfilled) return "fulfilled";
  return "pending";
}

async function buildFieldsFromOrderRow(row) {
  const fieldMap = await loadOrdersFieldMap();
  const fields = {};

  assignAirtableField(fields, fieldMap.orderId, row.id);
  assignAirtableField(fields, fieldMap.userId, row.user_id);
  assignAirtableField(fields, fieldMap.userEmail, row.email || undefined);
  assignAirtableField(fields, fieldMap.itemId, row.item_id);
  assignAirtableField(fields, fieldMap.itemName, row.item_name || undefined);
  assignAirtableField(fields, fieldMap.totalUsd, numberOrZero(row.total_usd));
  assignAirtableField(fields, fieldMap.totalCoins, numberOrZero(row.total_coins));
  assignAirtableField(fields, fieldMap.quantity, numberOrZero(row.quantity ?? 1));
  assignAirtableField(fields, fieldMap.status, mapOrderStatusToAirtable(row));
  assignAirtableField(fields, fieldMap.itemUsage, row.item_usage || undefined);
  assignAirtableField(fields, fieldMap.createdAt, airtableDate(row.created_at));

  return fields;
}

async function airtableRequest(path, options = {}) {
  const response = await fetch(`${getOrdersTableUrl()}${path}`, {
    ...options,
    headers: {
      ...getAirtableHeaders(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const message = data?.error?.message || data?.error || text || response.statusText;
    throw new Error(`Airtable orders request failed (${response.status}): ${message}`);
  }

  return data;
}

async function findOrderRecord({ orderId, airtableRecordId }) {
  if (airtableRecordId) {
    try {
      const data = await airtableRequest(`/${airtableRecordId}`);
      if (data?.id) return data;
    } catch {
      // fall through to order id lookup
    }
  }

  if (!orderId) {
    return null;
  }

  const fieldMap = await loadOrdersFieldMap();
  const orderIdField = fieldMap.orderId || STANDARD_FIELD_NAMES.orderId;
  const formula = `${formulaField(orderIdField)}=${Number(orderId)}`;
  const params = new URLSearchParams({
    filterByFormula: formula,
    maxRecords: "1",
  });

  const data = await airtableRequest(`?${params.toString()}`);
  return data.records?.[0] ?? null;
}

export async function syncShopOrderToAirtable(row) {
  if (!hasAirtableOrdersConfig) {
    return { ok: false, skipped: true, reason: "Airtable orders not configured." };
  }

  if (!row?.id) {
    return { ok: false, skipped: true, reason: "Missing order id." };
  }

  const fields = await buildFieldsFromOrderRow(row);
  const existing = await findOrderRecord({
    orderId: row.id,
    airtableRecordId: row.airtable_record_id,
  });

  if (existing?.id) {
    const data = await airtableRequest(`/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields, typecast: true }),
    });

    if (!data?.id) {
      throw new Error("Airtable orders PATCH succeeded but returned no record id.");
    }

    lastOrdersSyncError = null;
    return {
      ok: true,
      created: false,
      recordId: data.id,
      postgresOrderId: row.id,
    };
  }

  const data = await airtableRequest("", {
    method: "POST",
    body: JSON.stringify({ fields, typecast: true }),
  });

  if (!data?.id) {
    throw new Error("Airtable orders POST succeeded but returned no record id.");
  }

  lastOrdersSyncError = null;
  return {
    ok: true,
    created: true,
    recordId: data.id,
    postgresOrderId: row.id,
  };
}

export async function syncAllShopOrdersToAirtable() {
  if (!pool) {
    return { ok: false, skipped: true, reason: "DATABASE_URL is not set." };
  }

  if (!hasAirtableOrdersConfig) {
    return { ok: false, skipped: true, reason: "Airtable orders not configured." };
  }

  const result = await pool.query(`
    SELECT
      o.*,
      u.email,
      i.name AS item_name
    FROM shop_orders o
    JOIN users u ON o.user_id = u.id
    JOIN shop_items i ON o.item_id = i.id
    ORDER BY o.id ASC
  `);

  const summary = {
    ok: true,
    synced: 0,
    failed: 0,
    total: result.rows.length,
    lastError: null,
  };

  for (const row of result.rows) {
    try {
      const syncResult = await syncShopOrderToAirtable(row);
      if (syncResult.skipped) {
        continue;
      }
      if (syncResult.ok && syncResult.recordId) {
        await persistOrderAirtableRecordId(row.id, syncResult.recordId);
        summary.synced += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      summary.ok = false;
      summary.lastError = error instanceof Error ? error.message : String(error);
      lastOrdersSyncError = summary.lastError;
      console.error("[orders] Airtable sync failed:", {
        orderId: row.id,
        message: summary.lastError,
      });
    }
  }

  return summary;
}

export async function persistOrderAirtableRecordId(orderId, recordId) {
  if (!pool || !orderId || !recordId) return;
  await pool.query(
    `
      UPDATE shop_orders
      SET airtable_record_id = $1, updated_at = NOW()
      WHERE id = $2
        AND (airtable_record_id IS NULL OR airtable_record_id != $1)
    `,
    [recordId, orderId]
  );
}
