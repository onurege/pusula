import { runReadOnly } from "./db.js";

export type MapCustomer = {
  id: number;
  unvan: string;
  adres: string | null;
  sehir: string | null;
  ilce: string | null;
  distributor: string | null;
  lat: number;
  lng: number;
  ciro30: number;
  fatura30: number;
};

export type MapCustomerFilters = {
  /** Restrict to customers in this city. */
  sehir?: string;
  /** Restrict to a single distributor. */
  distKod?: number;
  /** Only customers whose 30-day ciro >= this. */
  minCiro?: number;
  /** Hard cap on rows returned. */
  limit?: number;
};

/**
 * Customers + last 30 days revenue + invoice count, scoped to those with
 * geographic coordinates. Uses a single pre-aggregated CTE over
 * TBLMSDFATURA (one pass on the date-indexed range, GROUP BY müşteri+dist)
 * and LEFT JOINs that into TBLMUSTERI. Much faster than OUTER APPLY when
 * the customer set is large — TBLMSDFATURA is read once instead of
 * per-row. Result is TOP-capped; clustering happens client-side.
 */
export async function listMapCustomers(
  filters: MapCustomerFilters = {},
): Promise<MapCustomer[]> {
  const limit = Math.min(Math.max(filters.limit ?? 5000, 1), 50_000);

  const where: string[] = [
    "m.DBLKOORDINATX > 0",
    "m.DBLKOORDINATY > 0",
    "m.BYTONAY = 1",
  ];

  if (filters.sehir) {
    // Quote-escape — applyParams in radar.ts handles this for templated SQL,
    // but here we build inline so do it ourselves.
    const safe = filters.sehir.replace(/'/g, "''");
    where.push(`m.TXTSEHIR = N'${safe}'`);
  }
  if (typeof filters.distKod === "number" && Number.isFinite(filters.distKod)) {
    where.push(`m.LNGDISTKOD = ${Math.floor(filters.distKod)}`);
  }
  if (typeof filters.minCiro === "number" && filters.minCiro > 0) {
    where.push(`ISNULL(c.ciro30, 0) >= ${Math.floor(filters.minCiro)}`);
  }

  const sql = `
    WITH ciro_30 AS (
      SELECT
        f.LNGMUSTERIKOD,
        f.LNGDISTKOD,
        SUM(f.DBLNETTUTAR) AS ciro30,
        COUNT(*)           AS fatura30
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        AND f.BYTTUR  = 0
        AND f.BYTDURUM = 0
      GROUP BY f.LNGMUSTERIKOD, f.LNGDISTKOD
    )
    SELECT TOP ${limit}
      m.LNGKOD       AS id,
      m.TXTUNVAN     AS unvan,
      m.TXTADRES1    AS adres,
      m.TXTSEHIR     AS sehir,
      m.TXTILCE      AS ilce,
      d.TXTAD        AS distributor,
      CAST(m.DBLKOORDINATX AS FLOAT) AS lat,
      CAST(m.DBLKOORDINATY AS FLOAT) AS lng,
      ISNULL(c.ciro30, 0)   AS ciro30,
      ISNULL(c.fatura30, 0) AS fatura30
    FROM dbo.TBLMUSTERI AS m
    LEFT JOIN dbo.TBLDIST AS d ON d.LNGKOD = m.LNGDISTKOD
    LEFT JOIN ciro_30   AS c ON c.LNGMUSTERIKOD = m.LNGKOD
                            AND c.LNGDISTKOD    = m.LNGDISTKOD
    WHERE ${where.join(" AND ")}
    ORDER BY ISNULL(c.ciro30, 0) DESC
  `;

  const result = await runReadOnly(sql, { limit, timeoutMs: 90_000 });
  return result.rows.map((r) => ({
    id: Number(r.id),
    unvan: String(r.unvan ?? ""),
    adres: (r.adres as string | null) ?? null,
    sehir: (r.sehir as string | null) ?? null,
    ilce: (r.ilce as string | null) ?? null,
    distributor: (r.distributor as string | null) ?? null,
    lat: Number(r.lat),
    lng: Number(r.lng),
    ciro30: Number(r.ciro30 ?? 0),
    fatura30: Number(r.fatura30 ?? 0),
  }));
}
