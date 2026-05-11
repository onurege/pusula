import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLocalDb } from "./local-db.js";

// Resolve repo root from this file's own location — same pattern we use in
// snapshot.ts so callers don't have to pass repoRoot around.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../../..");

export type CacheEntry<T> = {
  payload: T;
  generatedAt: string;
  durationMs: number | null;
};

/** Read a cached value. Returns null if no entry exists. */
export function cachedRead<T>(domain: string, key: string): CacheEntry<T> | null {
  const db = getLocalDb(DEFAULT_REPO_ROOT);
  const row = db
    .prepare(
      `SELECT payload, generated_at AS generatedAt, duration_ms AS durationMs
       FROM cache_entries WHERE domain = ? AND key = ?`,
    )
    .get(domain, key) as
    | { payload: string; generatedAt: string; durationMs: number | null }
    | undefined;
  if (!row) return null;
  try {
    return {
      payload: JSON.parse(row.payload) as T,
      generatedAt: row.generatedAt,
      durationMs: row.durationMs,
    };
  } catch {
    // Corrupted payload — drop it and pretend it never existed.
    cachedClear(domain, key);
    return null;
  }
}

/** Write a value to the cache, upserting on (domain, key). */
export function cachedWrite<T>(
  domain: string,
  key: string,
  payload: T,
  durationMs?: number,
): void {
  const db = getLocalDb(DEFAULT_REPO_ROOT);
  db.prepare(
    `INSERT INTO cache_entries (domain, key, payload, generated_at, duration_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(domain, key) DO UPDATE SET
       payload      = excluded.payload,
       generated_at = excluded.generated_at,
       duration_ms  = excluded.duration_ms`,
  ).run(
    domain,
    key,
    JSON.stringify(payload),
    new Date().toISOString(),
    durationMs ?? null,
  );
}

/**
 * Drop a single entry, all entries for a domain, or everything.
 * - cachedClear() → wipes the whole table
 * - cachedClear("foresight") → wipes the foresight domain
 * - cachedClear("foresight", "42:14") → wipes a single entry
 */
export function cachedClear(domain?: string, key?: string): number {
  const db = getLocalDb(DEFAULT_REPO_ROOT);
  if (domain && key) {
    return db
      .prepare(`DELETE FROM cache_entries WHERE domain = ? AND key = ?`)
      .run(domain, key).changes;
  }
  if (domain) {
    return db.prepare(`DELETE FROM cache_entries WHERE domain = ?`).run(domain)
      .changes;
  }
  return db.prepare(`DELETE FROM cache_entries`).run().changes;
}

/**
 * Convenience wrapper: read-through with auto-populate. If forceRefresh is
 * true, skips the read and writes a fresh value. Returns both the value and
 * an `age` flag so callers can show "cached" vs "fresh" indicators.
 */
export async function withCache<T>(
  domain: string,
  key: string,
  loader: () => Promise<T>,
  options: { forceRefresh?: boolean } = {},
): Promise<{ value: T; cached: boolean; generatedAt: string; durationMs: number | null }> {
  if (!options.forceRefresh) {
    const hit = cachedRead<T>(domain, key);
    if (hit) {
      return {
        value: hit.payload,
        cached: true,
        generatedAt: hit.generatedAt,
        durationMs: hit.durationMs,
      };
    }
  }
  const startedAt = Date.now();
  const value = await loader();
  const durationMs = Date.now() - startedAt;
  cachedWrite(domain, key, value, durationMs);
  return {
    value,
    cached: false,
    generatedAt: new Date().toISOString(),
    durationMs,
  };
}

/** Build a stable cache key from an object — sorted JSON. */
export function makeCacheKey(parts: Record<string, unknown>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${stringifyKeyValue(parts[k])}`)
    .join("|");
  return sorted;
}

function stringifyKeyValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export type CacheDomainStats = {
  domain: string;
  count: number;
  oldest: string | null;
  newest: string | null;
};

/** Cache observability — what's stashed by domain. */
export function cacheStats(): CacheDomainStats[] {
  const db = getLocalDb(DEFAULT_REPO_ROOT);
  return db
    .prepare(
      `SELECT domain,
              COUNT(*) AS count,
              MIN(generated_at) AS oldest,
              MAX(generated_at) AS newest
       FROM cache_entries
       GROUP BY domain
       ORDER BY domain`,
    )
    .all() as CacheDomainStats[];
}
