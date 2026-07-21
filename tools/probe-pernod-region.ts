// Pernod'da distribütör bölge kaynağını teşhis et — TBLDISTGRUP vs TBLDISTEKGRUP
// hangisi coğrafi bölge tutuyor?
import { runReadOnly } from "@enroute/core";

async function dump(label: string, sql: string) {
  console.log(`\n=== ${label} ===`);
  try {
    const r = await runReadOnly(sql, { limit: 50 });
    for (const row of r.rows) console.log("  ", JSON.stringify(row));
  } catch (e) {
    console.log("  ERR:", (e as Error).message);
  }
}

await dump(
  "TBLDISTGRUP (distinct TXTAD)",
  "SELECT TXTKOD, TXTAD FROM dbo.TBLDISTGRUP ORDER BY TXTKOD",
);
await dump(
  "TBLDISTEKGRUP (distinct TXTAD)",
  "SELECT TXTKOD, TXTAD FROM dbo.TBLDISTEKGRUP ORDER BY TXTKOD",
);
await dump(
  "TBLDIST örnek (TXTGRUP / TXTEKGRUP kolonları)",
  "SELECT TOP 10 LNGKOD, TXTAD, TXTGRUP, TXTEKGRUP FROM dbo.TBLDIST WHERE BYTDURUM = 0",
);
console.log("\n[probe] bitti.");
