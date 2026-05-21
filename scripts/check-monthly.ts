import { runReadOnly } from "../packages/core/src/index.js";

async function main() {
  const sql = `
    SELECT
      DATEPART(year, f.TRHISLEMTARIHI)  AS yil,
      DATEPART(month, f.TRHISLEMTARIHI) AS ay,
      COUNT(*) AS satir,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro
    FROM dbo.TBLMSDFATURA f
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(month, -30, GETDATE())
    GROUP BY DATEPART(year, f.TRHISLEMTARIHI), DATEPART(month, f.TRHISLEMTARIHI)
    ORDER BY yil, ay
  `;
  const out = await runReadOnly(sql, { limit: 40, timeoutMs: 60_000 });
  console.log("Toplam ay sayısı:", out.rows.length);
  for (const r of out.rows) {
    const ciro = Number(r.ciro);
    console.log(`${r.yil}-${String(r.ay).padStart(2,'0')}  satır=${r.satir}  ciro=${ciro.toLocaleString('tr-TR')}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
