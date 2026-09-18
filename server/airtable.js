import { getPublicTables, getTableColumns, getTablePrimaryKeyColumns, getTableRows } from "./db.js";

const airtableToken =
  process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
const airtableBaseId = process.env.AIRTABLE_APP || process.env.AIRTABLE_BASE_ID;
const syncIntervalMs = Number(process.env.AIRTABLE_SYNC_INTERVAL_MS || 5 * 60 * 1000);

let syncTimer = null;
let syncInProgress = false;
let lastSync = null;

export const hasAirtableConfig = Boolean(airtableToken && airtableBaseId);

const GENERIC_SYNC_SKIP_TABLES = new Set(["users", "projects", "journal_entries", "shop_orders"]);

function getAirtableUrl(tableName) {
  const tablePath = encodeURIComponent(tableName);
  return `https://api.airtable.com/v0/${airtableBaseId}/${tablePath}`;
}

function getAirtableHeaders() {
  return {
    Authorization: `Bearer ${airtableToken}`,
    "Content-Type": "application/json",
  };
}

function chunkRecords(records, size = 10) {
  const chunks = [];

  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }

  return chunks;
}

async function getAirtableTables() {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${airtableBaseId}/tables`, {
    headers: getAirtableHeaders(),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to load Airtable schema (${response.status}): ${details}`);
  }

  const data = await response.json();
  return data.tables || [];
}

async function upsertAirtableRecords(tableName, mergeFields, records) {
  let synced = 0;

  for (const chunk of chunkRecords(records)) {
    const response = await fetch(getAirtableUrl(tableName), {
      method: "PATCH",
      headers: getAirtableHeaders(),
      body: JSON.stringify({
        performUpsert: {
          fieldsToMergeOn: mergeFields,
        },
        records: chunk,
      }),
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Airtable sync failed (${response.status}): ${details}`);
    }

    const data = await response.json();
    synced += data.records?.length || 0;
  }

  return synced;
}

function normalizeAirtableValue(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function buildAirtableRecord(row, sharedFields) {
  const fields = {};

  for (const field of sharedFields) {
    fields[field] = normalizeAirtableValue(row[field]);
  }

  return { fields };
}

function chooseMergeFields(primaryKeyColumns, sharedFields) {
  const sharedPrimaryKey = primaryKeyColumns.filter((column) => sharedFields.includes(column));

  if (sharedPrimaryKey.length > 0) {
    return sharedPrimaryKey;
  }

  return sharedFields.slice(0, 1);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function syncDatabaseToAirtable() {
  if (!hasAirtableConfig) {
    return {
      ok: false,
      configured: false,
      message: "AIRTABLE_TOKEN and AIRTABLE_APP are required.",
    };
  }

  if (syncInProgress) {
    return {
      ok: false,
      configured: true,
      message: "Airtable sync is already running.",
    };
  }

  syncInProgress = true;

  try {
    const [postgresTables, airtableTables] = await Promise.all([getPublicTables(), getAirtableTables()]);
    const airtableTablesByName = new Map(airtableTables.map((table) => [table.name, table]));
    const results = [];

    for (const tableName of postgresTables) {
      if (GENERIC_SYNC_SKIP_TABLES.has(tableName)) {
        results.push({
          table: tableName,
          synced: 0,
          skipped: true,
          reason: "Uses dedicated Airtable sync module.",
        });
        continue;
      }

      const airtableTable = airtableTablesByName.get(tableName);

      if (!airtableTable) {
        results.push({
          table: tableName,
          synced: 0,
          skipped: true,
          reason: "Missing Airtable table.",
        });
        continue;
      }

      const airtableFields = airtableTable.fields.map((field) => field.name);
      const [postgresColumns, primaryKeyColumns, rows] = await Promise.all([
        getTableColumns(tableName),
        getTablePrimaryKeyColumns(tableName),
        getTableRows(tableName),
      ]);
      const sharedFields = postgresColumns.filter((column) => airtableFields.includes(column));

      if (sharedFields.length === 0) {
        results.push({
          table: tableName,
          synced: 0,
          skipped: true,
          reason: "No matching Airtable fields.",
        });
        continue;
      }

      const mergeFields = chooseMergeFields(primaryKeyColumns, sharedFields);
      const records = rows
        .filter((row) => mergeFields.every((field) => row[field] !== null && row[field] !== undefined))
        .map((row) => buildAirtableRecord(row, sharedFields));

      const synced = await upsertAirtableRecords(tableName, mergeFields, records);

      results.push({
        table: tableName,
        synced,
        skippedRows: rows.length - records.length,
        sourceRows: rows.length,
        mergeFields,
        fields: sharedFields,
      });
    }

    lastSync = {
      ok: true,
      configured: true,
      tables: results,
      syncedTables: results.filter((result) => !result.skipped).length,
      skippedTables: results.filter((result) => result.skipped).length,
      skippedAirtableTables: airtableTables
        .filter((table) => !postgresTables.includes(table.name))
        .map((table) => table.name),
      syncedAt: new Date().toISOString(),
    };

    return lastSync;
  } catch (error) {
    lastSync = {
      ok: false,
      configured: true,
      error: getErrorMessage(error),
      syncedAt: new Date().toISOString(),
    };

    throw error;
  } finally {
    syncInProgress = false;
  }
}

export function getAirtableSyncStatus() {
  return {
    configured: hasAirtableConfig,
    running: syncInProgress,
    intervalMs: syncIntervalMs,
    lastSync,
  };
}

export function startAirtableAutoSync() {
  if (!hasAirtableConfig || syncTimer) {
    return;
  }

  syncDatabaseToAirtable().catch((error) => {
    console.error("Initial Airtable sync failed:", error);
  });

  syncTimer = setInterval(() => {
    syncDatabaseToAirtable().catch((error) => {
      console.error("Scheduled Airtable sync failed:", error);
    });
  }, syncIntervalMs);
}
