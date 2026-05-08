import sql from "mssql";

let pool: sql.ConnectionPool | null = null;

function readEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;

  const config: sql.config = {
    server: readEnv("MSSQL_SERVER"),
    port: parseInt(readEnv("MSSQL_PORT", "1433"), 10),
    database: readEnv("MSSQL_DATABASE"),
    user: readEnv("MSSQL_USER"),
    password: readEnv("MSSQL_PASSWORD"),
    options: {
      encrypt: readEnv("MSSQL_ENCRYPT", "true") === "true",
      trustServerCertificate:
        readEnv("MSSQL_TRUST_SERVER_CERT", "true") === "true",
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
  };

  pool = await new sql.ConnectionPool(config).connect();
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

// Read-only guard. Even though the connection user should be db_datareader,
// we refuse anything that looks like a write at the application layer.
const FORBIDDEN_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bTRUNCATE\b/i,
  /\bMERGE\b/i,
  /\bEXEC(UTE)?\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bDENY\b/i,
];

export function assertReadOnly(query: string): void {
  const stripped = query
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(stripped)) {
      throw new Error(
        `Read-only guard rejected query: matched ${pat.source}`,
      );
    }
  }
}

export type RunOptions = {
  /** Hard cap on rows returned. Defaults to 1000. */
  limit?: number;
  /** Statement timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
};

export type RunResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
};

export async function runReadOnly(
  query: string,
  options: RunOptions = {},
): Promise<RunResult> {
  assertReadOnly(query);
  const limit = options.limit ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const p = await getPool();
  const request = p.request();
  // mssql v12 keeps the per-request timeout off the public type but honors it at runtime.
  (request as unknown as { timeout: number }).timeout = timeoutMs;

  const started = Date.now();
  const result = await request.query(query);
  const durationMs = Date.now() - started;

  const all = (result.recordset ?? []) as Record<string, unknown>[];
  const truncated = all.length > limit;
  const rows = truncated ? all.slice(0, limit) : all;

  return { rows, rowCount: all.length, truncated, durationMs };
}
