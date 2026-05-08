import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatRetrievalForPrompt, retrieve } from "../src/retrieve.js";
import type { SchemaSnapshot } from "../src/types.js";

async function loadSnapshot(): Promise<SchemaSnapshot> {
  const candidates = [
    "data/schema-v2.enriched.json",
    "data/schema-v2.json",
    "data/seed/schema-v1.json",
  ];
  for (const c of candidates) {
    try {
      const raw = await readFile(path.resolve(c), "utf-8");
      console.log(`[test-retrieve] using ${c}`);
      return JSON.parse(raw) as SchemaSnapshot;
    } catch {
      continue;
    }
  }
  throw new Error("No snapshot found. Run `npm run schema:introspect` first.");
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('Usage: npm run test:retrieve "<query>"');
    process.exit(1);
  }

  const topK = process.env.TOPK ? parseInt(process.env.TOPK, 10) : 10;
  const snapshot = await loadSnapshot();
  console.log(`[test-retrieve] snapshot tables=${snapshot.tables.length} fks=${snapshot.foreignKeys.length}`);
  console.log(`[test-retrieve] query: ${query}`);
  console.log("");

  const results = retrieve(query, snapshot, { topK, expandFkNeighbors: true });

  if (results.length === 0) {
    console.log("(no matches)");
    return;
  }

  console.log(`Top ${results.length} tables:`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    console.log(`  ${i + 1}. ${r.table.fullName}  score=${r.score}`);
    console.log(`     reasons: ${r.reasons.join("; ")}`);
    if (r.fkNeighbors.length > 0) {
      console.log(`     FK neighbors: ${r.fkNeighbors.map((n) => n.table).join(", ")}`);
    }
  }

  console.log("\n--- formatted prompt context ---\n");
  console.log(formatRetrievalForPrompt(results));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
