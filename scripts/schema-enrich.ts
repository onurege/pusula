import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { enrichSnapshot, type SchemaSnapshot } from "@enroute/core";

const IN_PATH = path.resolve("data/schema-v2.json");
const OUT_PATH = path.resolve("data/schema-v2.enriched.json");

async function main() {
  const limit = process.env.ENRICH_LIMIT ? parseInt(process.env.ENRICH_LIMIT, 10) : undefined;
  const concurrency = parseInt(process.env.ENRICH_CONCURRENCY ?? "4", 10);

  console.log(`[enrich] reading ${IN_PATH}`);
  const raw = await readFile(IN_PATH, "utf-8");
  const snapshot = JSON.parse(raw) as SchemaSnapshot;

  const candidates = snapshot.tables.filter((t) => !t.description).length;
  const target = limit ? Math.min(limit, candidates) : candidates;
  console.log(`[enrich] tables without description: ${candidates}, will enrich: ${target}, concurrency=${concurrency}`);

  let lastLog = 0;
  await enrichSnapshot(snapshot, {
    skipExisting: true,
    limit,
    concurrency,
    sampleRowsInPrompt: 3,
    onProgress: (done, total) => {
      const now = Date.now();
      if (done === total || now - lastLog > 2000) {
        console.log(`[enrich] ${done}/${total}`);
        lastLog = now;
      }
    },
  });

  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`[enrich] wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
