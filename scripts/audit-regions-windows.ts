/**
 * Edge-case investigation: why every region shows -70%+ YoY.
 *
 * Cross-check the two 30-day windows used by fetchRegions with raw monthly
 * totals so we can rule out a window-alignment bug vs. a real demand
 * collapse / data-cutoff artifact.
 */
import { runReadOnly } from "../packages/core/src/index.js";

async function main() {
  // 1) Daily total invoiced amount in each of the two windows
  const sql1 = `
    SELECT
      'son'                AS pencere,
      CONVERT(date, f.TRHISLEMTARIHI) AS gun,
      COUNT(*)             AS satir,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0 AND d.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
    GROUP BY CONVERT(date, f.TRHISLEMTARIHI)
    UNION ALL
    SELECT
      'onceki'             AS pencere,
      CONVERT(date, f.TRHISLEMTARIHI) AS gun,
      COUNT(*)             AS satir,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0 AND d.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -395, GETDATE())
      AND f.TRHISLEMTARIHI <  DATEADD(day, -365, GETDATE())
    GROUP BY CONVERT(date, f.TRHISLEMTARIHI)
    ORDER BY pencere, gun
  `;
  const o1 = await runReadOnly(sql1, { limit: 200, timeoutMs: 120_000 });

  const byWindow: Record<string, { gun: string; satir: number; ciro: number }[]> = { son: [], onceki: [] };
  for (const r of o1.rows as any[]) {
    const w = String(r.pencere);
    byWindow[w].push({ gun: String(r.gun), satir: Number(r.satir), ciro: Number(r.ciro) });
  }

  const sum = (xs: { ciro: number }[]) => xs.reduce((s, x) => s + x.ciro, 0);
  console.log("=== Window totals (all regions) ===");
  console.log("son    days:", byWindow.son.length, "total ciro:", sum(byWindow.son).toLocaleString("tr-TR"));
  console.log("onceki days:", byWindow.onceki.length, "total ciro:", sum(byWindow.onceki).toLocaleString("tr-TR"));
  if (sum(byWindow.onceki) > 0) {
    const yoy = ((sum(byWindow.son) - sum(byWindow.onceki)) / sum(byWindow.onceki)) * 100;
    console.log("Composite YoY:", yoy.toFixed(2), "%");
  }
  console.log();
  console.log("=== son (-30g) daily ===");
  for (const r of byWindow.son) console.log(`  ${r.gun}  ${String(r.satir).padStart(5)}  ${r.ciro.toLocaleString("tr-TR")}`);
  console.log();
  console.log("=== onceki (-395g..-365g) daily ===");
  for (const r of byWindow.onceki) console.log(`  ${r.gun}  ${String(r.satir).padStart(5)}  ${r.ciro.toLocaleString("tr-TR")}`);

  // 2) IST-AVRUPA isolation — same windows, raw counts and TBLDIST rows used.
  const sql2 = `
    SELECT
      'son'  AS pencere,
      COUNT(*) AS satir,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro,
      MIN(f.TRHISLEMTARIHI) AS minTrh,
      MAX(f.TRHISLEMTARIHI) AS maxTrh
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d      ON d.LNGKOD = f.LNGDISTKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0 AND d.BYTDURUM = 0
      AND d.TXTGRUP = '60'
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
    UNION ALL
    SELECT
      'onceki' AS pencere,
      COUNT(*) AS satir,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro,
      MIN(f.TRHISLEMTARIHI) AS minTrh,
      MAX(f.TRHISLEMTARIHI) AS maxTrh
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d      ON d.LNGKOD = f.LNGDISTKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0 AND d.BYTDURUM = 0
      AND d.TXTGRUP = '60'
      AND f.TRHISLEMTARIHI >= DATEADD(day, -395, GETDATE())
      AND f.TRHISLEMTARIHI <  DATEADD(day, -365, GETDATE())
  `;
  const o2 = await runReadOnly(sql2, { limit: 5, timeoutMs: 60_000 });
  console.log();
  console.log("=== IST-AVRUPA (TXTGRUP='60') raw ===");
  for (const r of o2.rows as any[]) {
    console.log(`  ${r.pencere}: satir=${r.satir} ciro=${Number(r.ciro).toLocaleString("tr-TR")}  trh ${r.minTrh}..${r.maxTrh}`);
  }

  // 3) Sanity: total invoices per month for last 18 months
  const sql3 = `
    SELECT TOP 24
      DATEPART(year, f.TRHISLEMTARIHI)  AS yil,
      DATEPART(month, f.TRHISLEMTARIHI) AS ay,
      COUNT(*) AS satir,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0 AND d.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(month, -24, GETDATE())
    GROUP BY DATEPART(year, f.TRHISLEMTARIHI), DATEPART(month, f.TRHISLEMTARIHI)
    ORDER BY yil DESC, ay DESC
  `;
  const o3 = await runReadOnly(sql3, { limit: 30, timeoutMs: 60_000 });
  console.log();
  console.log("=== Monthly trend (BYTTUR=0, BYTDURUM=0) ===");
  for (const r of o3.rows as any[]) {
    console.log(`  ${r.yil}-${String(r.ay).padStart(2, "0")}  satir=${String(r.satir).padStart(6)}  ciro=${Number(r.ciro).toLocaleString("tr-TR")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
