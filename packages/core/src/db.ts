import sql from "mssql";
import { sqlNow, nowIsOverridden, setNowAnchor } from "./now.js";
import { getTenantConfig, resolveDatabaseName } from "./tenant/index.js";
import { getDbConnectionMeta, getDecryptedDbConnectionOverride } from "./tenant/db-connection-config.js";
import { getActiveDbId } from "./request-context.js";

// Havuzlar `${prefix}::${dbId}` anahtarıyla tutulur — çok-DB (login'de DB
// seçimi) için: aynı prefix altında farklı dbId'ler AYRI havuz alır, böylece
// iki kullanıcı iki farklı DB'de EŞZAMANLI çalışabilir (tek-havuz modeli her
// istekte kapat-aç yapardı). Tek-DB tenant'larda dbId hep boş → tek anahtar
// (`${prefix}::`) → bugünkü davranış birebir.
const pools = new Map<string, sql.ConnectionPool>();
// Havuzlar hangi tenant/prefix için açıldığını izler — DEĞİŞİNCE (tenant
// switch) tüm havuzlar kapatılır. Kaynak TİPİ (env/store) izlenmez (bkz.
// `getPool()` "neden cache-hit yolunda I/O yok"); o karar yalnız cache-miss'te.
let poolPrefix: string | null = null;

function readEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

/** `.env` prefix'inden (`${prefix}SERVER` vb.) — bugünkü davranış, BİREBİR
 *  korunur (pernod/wietnauer regresyon-sıfır: store override yoksa bu dal). */
function buildConfigFromEnv(prefix: string): sql.config {
  return {
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
}

/**
 * Konfigüratörün şifreli store override'ından (Faz A Dalga 2 "creds →
 * getPool wire") — `decryptSecret` BURADA, yalnız YENİ bir pool açılırken
 * (cache-miss) çağrılır; `getPool()`'un cache-hit dalı bu fonksiyona hiç
 * girmez, dolayısıyla her istekte değil, yalnız gerçek pool-init'te çözülür.
 * Store `port`/`encrypt`/`trustServerCertificate` alanlarını taşımaz (bugünkü
 * `DbConnectionInput` şeması kasıtlı dar) — güvenli varsayılanlar kullanılır
 * (`.env` dalıyla AYNI TLS varsayılan mantığı: prod'da sertifika doğrulanır).
 */
function buildConfigFromOverride(tenantId: string): sql.config {
  const override = getDecryptedDbConnectionOverride(tenantId);
  if (!override) {
    throw new Error(`[db] "${tenantId}" için beklenen DB override okunamadı (race?).`);
  }
  return {
    server: override.server,
    port: 1433,
    database: override.database,
    user: override.user,
    password: override.password,
    requestTimeout: 120_000,
    connectionTimeout: 30_000,
    options: {
      encrypt: true,
      trustServerCertificate: process.env.NODE_ENV !== "production",
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
  };
}

/**
 * Aktif tenant'ın DB bağlantı havuzu. Kaynak sırası (additive, `tenant/
 * index.ts getTenantConfig()` additive fallback'iyle AYNI felsefe):
 *   1. Konfigüratörün şifreli store override'ı (`db-connection-config.ts`
 *      `saveDbConnectionOverride`) VARSA — o kullanılır (kodsuz DB kurulumu).
 *   2. YOKSA — bugünkü `.env` `${prefix}SERVER/...` fallback'i (pernod/
 *      wietnauer'ın DAVRANIŞI BİREBİR KORUNUR, hiçbir override kaydı yoksa
 *      bu fonksiyon eskisiyle AYNI kod yolunu izler).
 *
 * PERFORMANS (Collina — hot path'i ölç, tahmin etme): `runReadOnly()` HER
 * sorguda `getPool()` çağırır. Cache-HIT yolunda (bağlı pool + aynı prefix)
 * BİLİNÇLİ OLARAK hiçbir disk I/O yapılmaz — store override var mı kontrolü
 * (`getDbConnectionMeta`, senkron `fs.readFileSync`) yalnız YENİ bir pool
 * açılırken (cache-MISS: ilk çağrı, tenant switch, ya da `closePool()`
 * sonrası) çalışır. Bunu her çağrıda tekrarlamak, event loop'u HER sorguda
 * gereksiz bir senkron dosya okumasıyla bloklardı.
 *
 * Bunun BEDELİ: env→store geçişi (creds ilk kez store'a yazılır) `poolPrefix`
 * aynı kaldığı için KENDİLİĞİNDEN yakalanmaz — bu yüzden creds
 * kaydedildikten SONRA `closePool()` çağırmak ZORUNLUDUR (admin/setup save
 * endpoint'leri bunu YAPAR, bkz. `server.ts`). `closePool()` cache'i
 * sıfırlar; bir sonraki `getPool()` store'un o an var olup olmadığını taze
 * okur.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  const tenant = getTenantConfig();
  const prefix = tenant.mssqlEnvPrefix || "MSSQL_";

  // Prefix değişti (tenant switch) — tüm havuzları kapat.
  if (poolPrefix !== null && poolPrefix !== prefix) {
    await closeAllPools();
  }
  poolPrefix = prefix;

  // Aktif isteğin seçili DB'si — ALS'ten (ucuz, I/O yok). Tek-DB'de undefined.
  // Anahtarı ham database adı DEĞİL, ucuz dbId ile kuruyoruz: böylece cache-HIT
  // yolunda hiçbir dosya okuması / decrypt YOK (store meta ve resolve yalnız
  // aşağıdaki MISS dalında çalışır — hot-path davranışı birebir korunur).
  const activeDbId = getActiveDbId();
  const key = `${prefix}::${activeDbId ?? ""}`;

  const existing = pools.get(key);
  if (existing && existing.connected) return existing;
  if (existing) {
    try {
      await existing.close();
    } catch {
      /* yok say */
    }
    pools.delete(key);
  }

  // --- cache-MISS dalı (ilk çağrı / tenant switch / closePool sonrası) ---
  // dbId → gerçek `database` adı (allowlist, fail-closed; tek-DB'de null).
  const activeDatabase = resolveDatabaseName(activeDbId);
  // Yalnız VARLIK kontrolü — decrypt YOK (ucuz), ve yalnız BURADA çalışır.
  const hasStoreOverride = getDbConnectionMeta(tenant.id).hasPassword;
  const config = hasStoreOverride ? buildConfigFromOverride(tenant.id) : buildConfigFromEnv(prefix);
  // Çok-DB: bağlantının yalnız `database` alanını override et (sunucu/kimlik AYNI).
  if (activeDatabase) config.database = activeDatabase;

  const p = await new sql.ConnectionPool(config).connect();
  pools.set(key, p);
  return p;
}

/** Tüm açık havuzları kapatır ve cache'i sıfırlar. */
async function closeAllPools(): Promise<void> {
  for (const p of pools.values()) {
    try {
      await p.close();
    } catch {
      /* yok say */
    }
  }
  pools.clear();
  poolPrefix = null;
}

/**
 * TÜM havuzları kapatır VE cache'i sıfırlar — DB creds kaydedildikten sonra bir
 * sonraki `getPool()` çağrısının YENİ bağlantı açmasını (taze store/env
 * kararıyla) garanti eden güvenli reset yolu. SIGINT handler'ı da bunu
 * kullanır (mevcut davranış).
 */
export async function closePool(): Promise<void> {
  await closeAllPools();
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
  // Security M1 (defense-in-depth): WAITFOR DELAY/TIME kendi başına bir yazım
  // değil ama (a) bilinen bir blind-injection zaman-tabanlı keşif primitifi
  // ve (b) read-only sözleşmesinin ruhuna aykırı bir DoS/askıya-alma vektörü
  // (istek havuzunu `requestTimeout`e kadar bloke eder). Konfigüratör
  // endpoint'leri kullanıcı girdisini SQL'e hiç interpolate etmese de bu
  // guard tüm `runReadOnly` çağıranları için tek yerde geçerli.
  /\bWAITFOR\b/i,
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
  // DEMO_DATE ya da çözülmüş max-invoice anchor aktifse, ham GETDATE()
  // literallerini de (ör. Gemini'nin ürettiği SQL) sqlNow() ile hizala.
  if (!nowIsOverridden()) return query;
  return query.replace(/\bGETDATE\s*\(\s*\)/gi, sqlNow());
}

/**
 * NOW_MODE=max-invoice anchor'ını DB'den BİR KEZ çözer ve now.ts'e yazar.
 * Bozuk DB saatinde (GETDATE donuk) "now" = en son fatura günü. Server boot'ta
 * ve her gece/açılış refresh'inde çağrılır — anchor günlük ilerler.
 * NOW_MODE kapalıysa no-op (anchor null → sqlNow GETDATE'e düşer).
 */
export async function resolveNowAnchor(): Promise<string | null> {
  if (process.env.NOW_MODE?.trim() !== "max-invoice") {
    setNowAnchor(null);
    return null;
  }
  try {
    // Bu sorgunun kendisinde sqlNow/GETDATE yok — chicken-egg yok.
    const r = await runReadOnly(
      "SELECT CONVERT(varchar(10), MAX(TRHISLEMTARIHI), 23) AS d " +
        "FROM dbo.TBLMSDFATURA WHERE BYTTUR = 0 AND BYTDURUM = 0",
      { limit: 1, timeoutMs: 30_000 },
    );
    const d = (r.rows[0]?.d as string | undefined) ?? null;
    setNowAnchor(d);
    console.log(`[now-anchor] max-invoice = ${d ?? "(çözülemedi)"}`);
    return d;
  } catch (err) {
    console.error("[now-anchor] çözümlenemedi:", (err as Error).message);
    return null;
  }
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
