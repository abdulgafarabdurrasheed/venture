import pg from "pg";

const { Pool } = pg;

const rawConnectionString = process.env.DATABASE_URL;
const SSL_QUERY_PARAMS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

function parseDatabaseUrl(urlString) {
  if (!urlString) return null;

  try {
    return new URL(urlString.replace(/^postgresql:/i, "postgres:"));
  } catch {
    return null;
  }
}

function isInternalPostgresHost(hostname) {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  // Coolify / Docker Compose service names (e.g. postgres, e97ywnx9sow3ua9iyztfcnlf)
  return !hostname.includes(".");
}

function stripSslParamsFromUrl(urlString) {
  const parsed = parseDatabaseUrl(urlString);
  if (!parsed) return urlString;

  for (const param of SSL_QUERY_PARAMS) {
    parsed.searchParams.delete(param);
  }

  const protocol = /^postgresql:/i.test(urlString) ? "postgresql:" : "postgres:";
  return `${protocol}${parsed.toString().slice("postgres:".length)}`;
}

function resolvePoolConfig(urlString) {
  const parsed = parseDatabaseUrl(urlString);
  const hostname = parsed?.hostname ?? "";
  const internal = isInternalPostgresHost(hostname);

  if (internal) {
    return {
      connectionString: stripSslParamsFromUrl(urlString),
      // Must be `false`, not undefined — pg otherwise reads PGSSLMODE=require from the env.
      ssl: false,
      internal,
      hostname,
    };
  }

  const urlSslMode = parsed?.searchParams.get("sslmode")?.toLowerCase();
  const envSslMode = process.env.PGSSLMODE?.toLowerCase();

  if (envSslMode === "disable" || urlSslMode === "disable") {
    return { connectionString: urlString, ssl: false, internal, hostname };
  }

  if (
    envSslMode === "require" ||
    envSslMode === "no-verify" ||
    urlSslMode === "require" ||
    urlSslMode === "no-verify"
  ) {
    return {
      connectionString: urlString,
      ssl: { rejectUnauthorized: false },
      internal,
      hostname,
    };
  }

  if (process.env.NODE_ENV === "production" && hostname.includes(".")) {
    return {
      connectionString: urlString,
      ssl: { rejectUnauthorized: false },
      internal,
      hostname,
    };
  }

  return { connectionString: urlString, ssl: false, internal, hostname };
}

const poolConfig = resolvePoolConfig(rawConnectionString);

if (poolConfig.hostname && poolConfig.internal) {
  console.log(`[db] Using internal Postgres host "${poolConfig.hostname}" (SSL disabled).`);
}

export const hasDatabaseConfig = Boolean(rawConnectionString);

export const pool = hasDatabaseConfig
  ? new Pool({
      connectionString: poolConfig.connectionString,
      ssl: poolConfig.ssl,
    })
  : null;

export async function checkDatabaseConnection() {
  if (!pool) {
    return {
      ok: false,
      configured: false,
      message: "DATABASE_URL is not set.",
    };
  }

  const result = await pool.query("select now() as now");

  return {
    ok: true,
    configured: true,
    now: result.rows[0].now,
  };
}

export async function getTestRows() {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query("select * from test");
  return result.rows;
}

export async function getPublicTables() {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    order by table_name
  `);

  return result.rows.map((row) => row.table_name);
}

export async function getTableColumns(tableName) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
      order by ordinal_position
    `,
    [tableName]
  );

  return result.rows.map((row) => row.column_name);
}

export async function getTablePrimaryKeyColumns(tableName) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(
    `
      select key_column_usage.column_name
      from information_schema.table_constraints
      join information_schema.key_column_usage
        on table_constraints.constraint_name = key_column_usage.constraint_name
        and table_constraints.table_schema = key_column_usage.table_schema
        and table_constraints.table_name = key_column_usage.table_name
      where table_constraints.table_schema = 'public'
        and table_constraints.table_name = $1
        and table_constraints.constraint_type = 'PRIMARY KEY'
      order by key_column_usage.ordinal_position
    `,
    [tableName]
  );

  return result.rows.map((row) => row.column_name);
}

export async function getTableRows(tableName) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(`select * from ${quoteIdentifier(tableName)}`);
  return result.rows;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
