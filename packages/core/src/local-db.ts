import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

let dbInstance: Database.Database | null = null;
let dbRoot: string | null = null;

/**
 * Open (or create) the local SQLite database next to the repo's data
 * folder. Cached for the process lifetime — better-sqlite3 is synchronous
 * and a single connection is the recommended pattern.
 *
 * Schema is created idempotently on first open; safe to call from any
 * code path. The DB lives at <repoRoot>/data/local.sqlite by default.
 */
export function getLocalDb(repoRoot: string): Database.Database {
  if (dbInstance && dbRoot === repoRoot) return dbInstance;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  const dataDir = path.join(repoRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "local.sqlite");
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
  `);

  dbInstance = db;
  dbRoot = repoRoot;
  return db;
}

export function closeLocalDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbRoot = null;
  }
}
