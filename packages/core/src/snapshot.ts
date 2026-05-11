import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SchemaSnapshot } from "./types.js";

let cached: SchemaSnapshot | null = null;
let loadingPromise: Promise<SchemaSnapshot> | null = null;

// Resolve repo root from this file's own location (packages/core/src/snapshot.ts
// → ../../.. is the repo root). cwd-based resolution broke when callers ran
// from apps/api/ instead of the repo root.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Resolve the snapshot path. Order:
 *   1. ENROUTE_SNAPSHOT_PATH env var
 *   2. <repoRoot>/data/schema-v2.enriched.json
 *   3. <repoRoot>/data/schema-v2.json
 *   4. <repoRoot>/data/seed/schema-v1.json
 */
function candidatePaths(repoRoot: string): string[] {
  const explicit = process.env.ENROUTE_SNAPSHOT_PATH;
  const list: string[] = [];
  if (explicit) list.push(explicit);
  list.push(
    path.join(repoRoot, "data/schema-v2.enriched.json"),
    path.join(repoRoot, "data/schema-v2.json"),
    path.join(repoRoot, "data/seed/schema-v1.json"),
  );
  return list;
}

export type LoadSnapshotOptions = {
  repoRoot?: string;
  /** Force re-read from disk even if cached. */
  reload?: boolean;
};

export async function loadSnapshot(
  options: LoadSnapshotOptions = {},
): Promise<SchemaSnapshot> {
  if (cached && !options.reload) return cached;
  if (loadingPromise && !options.reload) return loadingPromise;

  const repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;

  loadingPromise = (async () => {
    let lastErr: unknown = null;
    for (const p of candidatePaths(repoRoot)) {
      try {
        const raw = await readFile(p, "utf-8");
        const snap = JSON.parse(raw) as SchemaSnapshot;
        if (!snap.tables) snap.tables = [];
        if (!snap.foreignKeys) snap.foreignKeys = [];
        cached = snap;
        return snap;
      } catch (err) {
        lastErr = err;
        continue;
      }
    }
    throw new Error(
      `No schema snapshot found. Tried: ${candidatePaths(repoRoot).join(", ")}. Last error: ${(lastErr as Error)?.message}`,
    );
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function getCachedSnapshot(): SchemaSnapshot | null {
  return cached;
}
