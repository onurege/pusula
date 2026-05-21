/**
 * Independent audit of Komuta Köprüsü region YoY metrics.
 *
 * Re-derives ciro / ciroPrev / deltaPct from scratch against MSSQL using a
 * different shape from komuta.ts:fetchRegions (LEFT JOIN driver = TBLDISTGRUP,
 * not the "son" CTE) so a copy-paste bug would surface as a delta.
 *
 * Also returns TWO distSayisi candidates for semantic comparison:
 *   - distAktif    : COUNT TBLDIST WHERE BYTDURUM=0 in that bölge
 *   - distSatisli30g: distinct LNGDISTKOD with non-cancelled invoices in
 *                     the last 30 days for that bölge
 *
 * Read-only. SELECT only.
 */
import { runReadOnly } from "../packages/core/src/index.js";

type Row = {
  bolge: string;
  bolgeKod: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
  distAktif: number;
  distSatisli30g: number;
};

async function main() {
  // Driver: every active TBLDISTGRUP. LEFT-JOIN into both windows so that
  // a bölge with zero current sales still shows up. This is structurally
  // different from fetchRegions which drives off the "son" CTE — meaning
  // any group with current sales but missing distSayisi would still show
  // up here, exposing semantic gaps.
  const sql = `
    WITH dist_aktif AS (
      SELECT
        d.TXTGRUP        AS bolgeKod,
        COUNT(*)         AS distAktif
      FROM dbo.TBLDIST d
      WHERE d.BYTDURUM = 0
      GROUP BY d.TXTGRUP
    ),
    dist_satisli AS (
      SELECT
        d.TXTGRUP                AS bolgeKod,
        COUNT(DISTINCT d.LNGKOD) AS distSatisli30g
      FROM dbo.TBLDIST d
      INNER JOIN dbo.TBLMSDFATURA f ON f.LNGDISTKOD = d.LNGKOD
      WHERE d.BYTDURUM = 0
        AND f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      GROUP BY d.TXTGRUP
    ),
    son AS (
      SELECT
        d.TXTGRUP            AS bolgeKod,
        SUM(f.DBLNETTUTAR)   AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND d.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      GROUP BY d.TXTGRUP
    ),
    onceki AS (
      SELECT
        d.TXTGRUP            AS bolgeKod,
        SUM(f.DBLNETTUTAR)   AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND d.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -395, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -365, GETDATE())
      GROUP BY d.TXTGRUP
    )
    SELECT
      dg.TXTAD                       AS bolge,
      dg.TXTKOD                      AS bolgeKod,
      ISNULL(s.ciro, 0)              AS ciro,
      ISNULL(o.ciro, 0)              AS ciroPrev,
      ISNULL(a.distAktif, 0)         AS distAktif,
      ISNULL(ds.distSatisli30g, 0)   AS distSatisli30g
    FROM dbo.TBLDISTGRUP dg
    LEFT JOIN son        s  ON s.bolgeKod  = dg.TXTKOD
    LEFT JOIN onceki     o  ON o.bolgeKod  = dg.TXTKOD
    LEFT JOIN dist_aktif a  ON a.bolgeKod  = dg.TXTKOD
    LEFT JOIN dist_satisli ds ON ds.bolgeKod = dg.TXTKOD
    WHERE ISNULL(s.ciro, 0) > 0 OR ISNULL(o.ciro, 0) > 0
    ORDER BY ISNULL(s.ciro, 0) DESC
  `;

  const out = await runReadOnly(sql, { limit: 100, timeoutMs: 180_000 });

  const rows: Row[] = out.rows.map((r: any) => {
    const ciro = Number(r.ciro ?? 0);
    const ciroPrev = Number(r.ciroPrev ?? 0);
    const deltaPct = ciroPrev > 0 ? ((ciro - ciroPrev) / ciroPrev) * 100 : null;
    return {
      bolge: String(r.bolge ?? "").trim(),
      bolgeKod: String(r.bolgeKod ?? "").trim(),
      ciro,
      ciroPrev,
      deltaPct,
      distAktif: Number(r.distAktif ?? 0),
      distSatisli30g: Number(r.distSatisli30g ?? 0),
    };
  });

  // Hard-stamp diagnostics: confirm GETDATE so we know we're on the live clock.
  const clockOut = await runReadOnly(
    `SELECT GETDATE() AS now, DATEADD(day, -30, GETDATE()) AS son_baslangic,
            DATEADD(day, -365, GETDATE()) AS onceki_son,
            DATEADD(day, -395, GETDATE()) AS onceki_baslangic`,
    { limit: 1, timeoutMs: 15_000 },
  );

  console.log(JSON.stringify({
    auditedAt: new Date().toISOString(),
    serverClock: clockOut.rows[0],
    rowCount: rows.length,
    rows,
  }, null, 2));
}

main().catch((e) => {
  console.error("AUDIT ERROR:", e);
  process.exit(1);
});
