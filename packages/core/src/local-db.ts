import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getTenantConfig } from "./tenant/index.js";

let dbInstance: Database.Database | null = null;
let dbRoot: string | null = null;
let dbFileName: string | null = null;

/**
 * Open (or create) the tenant's local SQLite database next to the repo's
 * data folder. Cached for the process lifetime — better-sqlite3 is
 * synchronous and a single connection is the recommended pattern.
 *
 * Tenant config'inden `sqliteFileName` okunur:
 *   - Pernod: `data/local.sqlite` (default, legacy path)
 *   - FMCG demo: `data/fmcg-demo.sqlite`
 *
 * TENANT env var değiştirilirse cached instance kapatılıp yenisi açılır —
 * runtime switcher (Faz 3) için hazır.
 *
 * Schema is created idempotently on first open; safe to call from any
 * code path.
 */
export function getLocalDb(repoRoot: string): Database.Database {
  const tenant = getTenantConfig();
  if (
    dbInstance &&
    dbRoot === repoRoot &&
    dbFileName === tenant.sqliteFileName
  ) {
    return dbInstance;
  }
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  const dataDir = path.join(repoRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, tenant.sqliteFileName);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Mirror table for the map customer set. Stays small (a few thousand rows
  // in pilot scale) so a full DELETE+INSERT on each sync is fine.
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_customers (
      id           INTEGER PRIMARY KEY,
      dist_kod     INTEGER,
      unvan        TEXT NOT NULL,
      kisa_ad      TEXT,
      adres        TEXT,
      sehir        TEXT,
      ilce         TEXT,
      distributor  TEXT,
      lat          REAL NOT NULL,
      lng          REAL NOT NULL,
      has_sales    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_map_customers_sehir ON map_customers(sehir);
    CREATE INDEX IF NOT EXISTS idx_map_customers_dist  ON map_customers(dist_kod);
    CREATE INDEX IF NOT EXISTS idx_map_customers_sales ON map_customers(has_sales);

    CREATE TABLE IF NOT EXISTS map_cities (
      sehir TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS map_distributors (
      lng_kod INTEGER PRIMARY KEY,
      ad      TEXT NOT NULL
    );

    -- One-row table; key is hardcoded "map" so we can extend with other
    -- sync targets later without changing schema.
    CREATE TABLE IF NOT EXISTS sync_state (
      domain         TEXT PRIMARY KEY,
      last_sync_at   TEXT NOT NULL,
      duration_ms    INTEGER NOT NULL,
      customer_count INTEGER NOT NULL,
      city_count     INTEGER NOT NULL,
      dist_count     INTEGER NOT NULL
    );

    -- Generic key-value cache. Every expensive read path can stash its
    -- result here keyed by (domain, key). Reads are O(log n) via the PK
    -- index; writes are upserts. No TTL — invalidation is manual via the
    -- "Yenile" affordance in the UI, mirroring the map-sync pattern.
    CREATE TABLE IF NOT EXISTS cache_entries (
      domain       TEXT NOT NULL,
      key          TEXT NOT NULL,
      payload      TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      duration_ms  INTEGER,
      PRIMARY KEY (domain, key)
    );
    CREATE INDEX IF NOT EXISTS idx_cache_entries_domain
      ON cache_entries(domain);
  `);

  // Idempotent column migrations. SQLite's CREATE TABLE IF NOT EXISTS won't
  // touch an existing table, so columns added after the initial schema must
  // be applied via ALTER TABLE guarded by pragma_table_info().
  ensureColumn(db, "map_customers", "kisa_ad", "TEXT");
  // Risk / activity recency fields, populated during sync. Letting these be
  // NULL is intentional — a customer with no recorded sale/visit yet should
  // show as "?" instead of "0 gün ago" (which would imply today).
  ensureColumn(db, "map_customers", "days_since_last_sale", "INTEGER");
  ensureColumn(db, "map_customers", "days_since_last_visit", "INTEGER");
  ensureColumn(db, "map_customers", "ciro_30d", "REAL");
  ensureColumn(db, "map_customers", "ciro_prev_30d", "REAL");
  ensureColumn(db, "map_customers", "risk_tier", "TEXT");
  // Bölge: TBLDIST.TXTGRUP (kod) → TBLDISTGRUP.TXTAD (okunabilir ad). Sync
  // sırasında doldurulur. Bölge-bazlı harita görünümü ve filtreleri kullanır.
  ensureColumn(db, "map_customers", "bolge", "TEXT");

  // Bölge filtresi için index — region görünümünde aggregate + drill-down
  // sırasında kullanılır.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_map_customers_bolge ON map_customers(bolge);`);

  // -- Composite Risk Score modeli (0..100, 4 bileşenli) -----------------------
  // Önceki tek-tier `risk_tier` kolonu legacy olarak kalır; yeni model paralelde
  // doldurulur. UI cutover'ı (Faz 3) sonrası eski kolon kaldırılabilir.
  //
  // Yeni veri alanları — `syncMapData` her sync'te doldurur. Hepsi nullable;
  // veri yoksa skor `risk_score = NULL` + `risk_tier_v2 = 'unknown'` döner.
  ensureColumn(db, "map_customers", "ciro_t90", "REAL");
  ensureColumn(db, "map_customers", "ciro_yoy_30d", "REAL");
  ensureColumn(db, "map_customers", "fatura_30d", "INTEGER");
  ensureColumn(db, "map_customers", "fatura_prev_30d", "INTEGER");
  ensureColumn(db, "map_customers", "fatura_t90", "INTEGER");
  ensureColumn(db, "map_customers", "urun_grup_30d", "INTEGER");
  ensureColumn(db, "map_customers", "urun_grup_prev_30d", "INTEGER");
  ensureColumn(db, "map_customers", "ziyaret_90d", "INTEGER");
  // Composite + components + reasons. components ve reasons JSON-encoded
  // (SQLite native JSON yok ama TEXT'te tutmak yeterli; okurken parse edilir).
  ensureColumn(db, "map_customers", "risk_score", "INTEGER");
  ensureColumn(db, "map_customers", "risk_tier_v2", "TEXT");
  ensureColumn(db, "map_customers", "risk_components", "TEXT");
  ensureColumn(db, "map_customers", "risk_reasons", "TEXT");

  // Yeni tier üzerinden filtreleme/sıralama için index.
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_map_customers_tier_v2 ON map_customers(risk_tier_v2);`,
  );

  dbInstance = db;
  dbRoot = repoRoot;
  dbFileName = tenant.sqliteFileName;
  return db;
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  type: string,
): void {
  const exists = db
    .prepare(
      `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    )
    .get(table, column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function closeLocalDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbRoot = null;
    dbFileName = null;
  }
}
