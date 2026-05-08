import "dotenv/config";
import { closePool, runReadOnly } from "@enroute/core";

/**
 * One-off inspector for TBLRAPORBASLIK rows. Pernod stores every named
 * report (the SQL behind it, where clauses, etc.) in this table keyed by
 * TXTKOD. Pulling a single row tells us exactly how the operations team
 * computes things like "ziyaret sayısı" — which we can then bake into our
 * own SQL or hand to the agent verbatim.
 *
 * Usage:
 *   npx tsx scripts/inspect-report.ts 5190
 */
async function main() {
  const kod = process.argv[2]?.trim();
  if (!kod) {
    console.error('Usage: npx tsx scripts/inspect-report.ts "<TXTKOD>"');
    process.exit(1);
  }

  const safe = kod.replace(/'/g, "''");
  const sql = `
    SELECT TXTKOD, TXTACIKLAMA, BYTTIP, TXTBILGI,
           TXTVERI, TXTWHEREKOSUL, TXTORDER,
           TXTRESOURCEKEY, LEN(TXTVERI) AS sqlLen
    FROM dbo.TBLRAPORBASLIK
    WHERE TXTKOD = N'${safe}'
  `;

  try {
    const result = await runReadOnly(sql, { limit: 5, timeoutMs: 15_000 });
    if (result.rows.length === 0) {
      console.log(`Rapor bulunamadı: TXTKOD = '${kod}'`);
      console.log("");
      console.log("İlk 20 ziyaret/aktivite içeren rapor:");
      const list = await runReadOnly(
        `SELECT TOP 20 TXTKOD, TXTACIKLAMA
         FROM dbo.TBLRAPORBASLIK
         WHERE TXTACIKLAMA LIKE N'%ziyaret%' OR TXTACIKLAMA LIKE N'%aktivite%'
         ORDER BY TXTKOD`,
        { limit: 20, timeoutMs: 10_000 },
      );
      for (const r of list.rows) {
        console.log(`  ${String(r.TXTKOD).padEnd(8)} ${r.TXTACIKLAMA}`);
      }
      return;
    }

    for (const r of result.rows) {
      console.log("=".repeat(80));
      console.log(`TXTKOD     : ${r.TXTKOD}`);
      console.log(`TXTACIKLAMA: ${r.TXTACIKLAMA}`);
      console.log(`BYTTIP     : ${r.BYTTIP}`);
      console.log(`TXTBILGI   : ${r.TXTBILGI ?? "(yok)"}`);
      console.log(`SQL boyutu : ${r.sqlLen} karakter`);
      console.log(`TXTRESOURCEKEY: ${r.TXTRESOURCEKEY ?? "(yok)"}`);
      console.log("");
      console.log("--- TXTVERI (rapor kaynağı) ---");
      const veri = String(r.TXTVERI ?? "").trim();
      console.log(veri || "(boş)");
      console.log("");

      // If TXTVERI is just a stored-proc name (no spaces, no SELECT), pull
      // its definition from sys.sql_modules so we can read the actual logic.
      if (veri && !/\s/.test(veri) && !/^select\b/i.test(veri)) {
        console.log(`--- ${veri} stored procedure içeriği ---`);
        const safeName = veri.replace(/'/g, "''");
        const def = await runReadOnly(
          `SELECT OBJECT_DEFINITION(OBJECT_ID(N'${safeName}')) AS def`,
          { limit: 1, timeoutMs: 15_000 },
        );
        const body = def.rows[0]?.def;
        console.log(body ? String(body) : "(SP bulunamadı veya tanım okunamadı)");
        console.log("");
      }

      if (r.TXTWHEREKOSUL) {
        console.log("--- TXTWHEREKOSUL (ek where) ---");
        console.log(r.TXTWHEREKOSUL);
        console.log("");
      }
      if (r.TXTORDER) {
        console.log("--- TXTORDER ---");
        console.log(r.TXTORDER);
      }
    }
  } finally {
    await closePool();
  }
}

main().catch(async (err) => {
  console.error(err);
  await closePool().catch(() => {});
  process.exit(1);
});
