import { runReadOnly } from "../packages/core/src/index.js";

async function main() {
  // En çok satılan 15 ürünün hacim/birim kolonlarını incele
  const sql = `
    SELECT TOP 15
      u.TXTAD,
      u.DBLLITRE,
      u.DBLHACIM,
      u.DBLKOLIICIADET,
      u.BYTURUNBIRIM,
      u.TXTBIRIM1, u.TXTBIRIM2,
      SUM(d.DBLMIKTAR) AS toplam_miktar,
      COUNT(*) AS satir_sayisi
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL AND d.LNGFATURAKOD = f.LNGBELGEKOD AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, CAST('2026-04-17 23:59:59' AS DATETIME))
    GROUP BY u.TXTAD, u.DBLLITRE, u.DBLHACIM, u.DBLKOLIICIADET, u.BYTURUNBIRIM, u.TXTBIRIM1, u.TXTBIRIM2
    ORDER BY SUM(d.DBLNETFIYAT * d.DBLMIKTAR) DESC
  `;
  const out = await runReadOnly(sql, { limit: 20, timeoutMs: 60_000 });
  for (const r of out.rows) {
    console.log(`"${r.TXTAD}"`);
    console.log(`  DBLLITRE=${r.DBLLITRE}  DBLHACIM=${r.DBLHACIM}  DBLKOLIICIADET=${r.DBLKOLIICIADET}`);
    console.log(`  BYTURUNBIRIM=${r.BYTURUNBIRIM}  TXTBIRIM1=${r.TXTBIRIM1}  TXTBIRIM2=${r.TXTBIRIM2}`);
    console.log(`  toplam_miktar(SUM)=${r.toplam_miktar}  satir_sayisi=${r.satir_sayisi}`);
    console.log("");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
