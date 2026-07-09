import sql from "mssql";
import { sqlNow, isDemoMode } from "./now.js";
import { getTenantConfig } from "./tenant/index.js";

let pool: sql.ConnectionPool | null = null;
let poolPrefix: string | null = null;

function readEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

export async function getPool(): Promise<sql.ConnectionPool> {
  // Tenant'a göre env prefix — Pernod: "MSSQL_", Wietnauer: "W_MSSQL_". Aynı
  // Univera sunucusu, farklı DB. Tenant switch'inde pool yeniden açılır.
  const prefix = getTenantConfig().mssqlEnvPrefix || "MSSQL_";

  if (pool && pool.connected && poolPrefix === prefix) return pool;

  // Prefix değişti — eski pool'u kapat.
  if (pool) {
    try {
      await pool.close();
    } catch {
      /* yok say */
    }
    pool = null;
  }

  const config: sql.config = {
    server: readEnv(`${prefix}SERVER`),
    port: parseInt(readEnv(`${prefix}PORT`, "1433"), 10),
    database: readEnv(`${prefix}DATABASE`),
    user: readEnv(`${prefix}USER`),
    password: readEnv(`${prefix}PASSWORD`),
    requestTimeout: 120_000,
    connectionTimeout: 30_000,
    options: {
      encrypt: readEnv(`${prefix}ENCRYPT`, "true") === "true",
      // GUV-05: Üretimde geçerli bir CA sertifikası zorunlu tutulur —
      // trustServerCertificate=true sunucu sertifikasını doğrulamadan kabul
      // eder, bu da MITM saldırısına açık kapı bırakır (TLS sadece şifreler,
      // kimlik doğrulamaz). Dev'de sertifika genelde self-signed olduğundan
      // mevcut davranış (true) korunur. Üretimde açıkça
      // `${prefix}TRUST_SERVER_CERT=true` verilirse yine de override
      // edilebilir (örn. geçici olarak, bilinçli risk kabulüyle) — ama
      // varsayılan artık güvenli taraf.
      trustServerCertificate:
        readEnv(
          `${prefix}TRUST_SERVER_CERT`,
          process.env.NODE_ENV === "production" ? "false" : "true",
        ) === "true",
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
  };

  pool = await new sql.ConnectionPool(config).connect();
  poolPrefix = prefix;
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    poolPrefix = null;
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

/**
 * Demo modunda SQL içindeki `GETDATE()` literalini sabit demo tarihiyle
 * değiştirir. Böylece Gemini'nin ürettiği SQL'ler dahil her sorgu otomatik
 * olarak demo "bugün"e bağlanır. Canlıda no-op (string olduğu gibi döner).
 *
 * Kelime sınırı (\b) ile sadece `GETDATE()` çağrısını yakalar, false-positive
 * yapmamak için açılış parantezi de zorunlu.
 */
function applyDemoDate(query: string): string {
  if (!isDemoMode()) return query;
  return query.replace(/\bGETDATE\s*\(\s*\)/gi, sqlNow());
}

/**
 * VYK-04: Varsayılan (READ COMMITTED) izolasyonda okuma sorguları paylaşımlı
 * kilit (S-lock) alır ve canlı ERP'nin OLTP yazımlarıyla çakışıp blocking'e
 * yol açabilir — özellikle yoğun saha saatlerinde. Bu uygulama tümüyle
 * read-only analytics/dashboard katmanı olduğundan ve veri zaten
 * cache'li/gecikmeli tüketildiğinden, dirty-read riski (commit edilmemiş
 * veriyi görme) kabul edilebilir bir tradeoff'tur — buna karşılık canlı
 * sistemi bloke etmemeyi önceliklendiriyoruz.
 *
 * Hedef DB'de READ_COMMITTED_SNAPSHOT açıksa (row-versioning) bu prefix
 * zaten gereksizdir (READ COMMITTED de lock-free okur) ama zararsızdır —
 * READ UNCOMMITTED yalnızca daha da gevşetir, ekstra maliyeti yoktur.
 *
 * `SET TRANSACTION ISOLATION LEVEL` bir DML/DDL değildir, assertReadOnly
 * guard'ındaki FORBIDDEN_PATTERNS listesinde yer almaz — reddedilmez.
 * Isolation level connection/session ömrü boyunca kalıcıdır ve pool
 * bağlantıları request'ler arasında yeniden kullanılır (round-robin). Bu
 * yüzden her sorguda seviyeyi AÇIKÇA set ediyoruz — toggle açıkken
 * READ UNCOMMITTED'a, kapalıyken READ COMMITTED'a (session default) —
 * aksi halde bir önceki request'in seviyesi sonraki request'e "sızabilir"
 * (ör. toggle sonradan kapatılırsa bile eski bağlantı READ UNCOMMITTED'da
 * takılı kalır).
 *
 * Kapatmak için: MSSQL_READ_UNCOMMITTED=0 (varsayılan: açık, "1").
 */
function readUncommittedEnabled(): boolean {
  return readEnv("MSSQL_READ_UNCOMMITTED", "1") !== "0";
}

export async function runReadOnly(
  query: string,
  options: RunOptions = {},
): Promise<RunResult> {
  assertReadOnly(query);
  const finalQuery = applyDemoDate(query);
  const limit = options.limit ?? 1000;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const p = await getPool();
  const request = p.request();
  // mssql v12 keeps the per-request timeout off the public type but honors it at runtime.
  (request as unknown as { timeout: number }).timeout = timeoutMs;

  const isolationSql = readUncommittedEnabled()
    ? "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;"
    : "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;";
  const batch = `${isolationSql}\n${finalQuery}`;

  const started = Date.now();
  const result = await request.query(batch);
  const durationMs = Date.now() - started;

  const all = (result.recordset ?? []) as Record<string, unknown>[];
  const truncated = all.length > limit;
  const rows = truncated ? all.slice(0, limit) : all;

  return { rows, rowCount: all.length, truncated, durationMs };
}
