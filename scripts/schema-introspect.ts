import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { closePool, introspect } from "@enroute/core";

const OUT_PATH = path.resolve("data/schema-v2.json");

async function main() {
  const sampleRows = parseInt(process.env.INTROSPECT_SAMPLE_ROWS ?? "0", 10);
  const includeSystem = process.env.INTROSPECT_INCLUDE_SYSTEM_TABLES === "true";

  console.log(`[introspect] connecting to ${process.env.MSSQL_DATABASE}@${process.env.MSSQL_SERVER}`);
  console.log(`[introspect] sampleRows=${sampleRows} includeSystem=${includeSystem}`);

  const started = Date.now();
  const snapshot = await introspect({
    database: process.env.MSSQL_DATABASE ?? "unknown",
    sampleRows,
    includeRowCounts: true,
    tableFilter: includeSystem
      ? undefined
      : (_s, t) => !t.startsWith("sysdiagrams") && !t.startsWith("aspnet_"),
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const tableCount = snapshot.tables.length;
  const fkCount = snapshot.foreignKeys.length;
  const colCount = snapshot.tables.reduce((n, t) => n + t.columns.length, 0);
  const tablesWithDesc = snapshot.tables.filter((t) => t.description).length;

  console.log(`[introspect] tables=${tableCount} columns=${colCount} foreignKeys=${fkCount} tablesWithExtPropDescription=${tablesWithDesc} elapsed=${elapsed}s`);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`[introspect] wrote ${OUT_PATH}`);

  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => {});
  process.exit(1);
});
