import { runReadOnly } from "../packages/core/src/index.js";

async function main() {
  // 1. TBLMUSTERI'nin tüm kolonları
  const sql1 = `
    SELECT TOP 1 *
    FROM dbo.TBLMUSTERI
  `;
  const out1 = await runReadOnly(sql1, { limit: 1, timeoutMs: 30_000 });
  if (out1.rows[0]) {
    const cols = Object.keys(out1.rows[0]).filter(c => /GRUP|KANAL|KATEGORI|SINIF|TIP|SEGMENT/i.test(c));
    console.log("TBLMUSTERI grup/kanal kolonları:", cols);
  }

  // 2. TBLMUSTERIGRUP içeriği
  const sql2 = `SELECT TOP 30 * FROM dbo.TBLMUSTERIGRUP ORDER BY 1`;
  try {
    const out2 = await runReadOnly(sql2, { limit: 30, timeoutMs: 30_000 });
    console.log("\nTBLMUSTERIGRUP (ilk 30):");
    for (const r of out2.rows) console.log(JSON.stringify(r));
  } catch (e: any) {
    console.log("TBLMUSTERIGRUP yok ya da yetkisiz:", e.message);
  }

  // 3. TBLMUSTERIKATEGORITANIM
  try {
    const sql3 = `SELECT TOP 30 * FROM dbo.TBLMUSTERIKATEGORITANIM`;
    const out3 = await runReadOnly(sql3, { limit: 30, timeoutMs: 30_000 });
    console.log("\nTBLMUSTERIKATEGORITANIM (ilk 30):");
    for (const r of out3.rows) console.log(JSON.stringify(r));
  } catch (e: any) {
    console.log("TBLMUSTERIKATEGORITANIM yok:", e.message);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
