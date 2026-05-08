import { runReadOnly } from "./db.js";

export type MapCustomer = {
  id: number;
  distKod: number | null;
  unvan: string;
  adres: string | null;
  sehir: string | null;
  ilce: string | null;
  distributor: string | null;
  lat: number;
  lng: number;
};

export type MapCustomerFilters = {
  sehir?: string;
  distKod?: number;
  limit?: number;
};

/**
 * Customers with geographic coordinates only — no revenue join here.
 * Joining the 5.7M-row TBLMSDFATURA per page load was overkill and was
 * timing out in production; sales numbers are now fetched lazily for
 * each customer when the user clicks a marker (getCustomerSales below).
 */
export async function listMapCustomers(
  filters: MapCustomerFilters = {},
): Promise<MapCustomer[]> {
  const limit = Math.min(Math.max(filters.limit ?? 5000, 1), 50_000);

  const where: string[] = [
    "m.DBLKOORDINATX > 0",
    "m.DBLKOORDINATY > 0",
  ];

  if (filters.sehir) {
    const safe = filters.sehir.replace(/'/g, "''");
    where.push(`m.TXTSEHIR = N'${safe}'`);
  }
  if (typeof filters.distKod === "number" && Number.isFinite(filters.distKod)) {
    where.push(`m.LNGDISTKOD = ${Math.floor(filters.distKod)}`);
  }

  const sql = `
    SELECT TOP ${limit}
      m.LNGKOD       AS id,
      m.LNGDISTKOD   AS distKod,
      m.TXTUNVAN     AS unvan,
      m.TXTADRES1    AS adres,
      m.TXTSEHIR     AS sehir,
      m.TXTILCE      AS ilce,
      d.TXTAD        AS distributor,
      CAST(m.DBLKOORDINATX AS FLOAT) AS lat,
      CAST(m.DBLKOORDINATY AS FLOAT) AS lng
    FROM dbo.TBLMUSTERI AS m
    LEFT JOIN dbo.TBLDIST AS d ON d.LNGKOD = m.LNGDISTKOD
    WHERE ${where.join(" AND ")}
    ORDER BY m.LNGKOD
  `;

  const result = await runReadOnly(sql, { limit, timeoutMs: 30_000 });
  return result.rows.map((r) => ({
    id: Number(r.id),
    distKod: r.distKod == null ? null : Number(r.distKod),
    unvan: String(r.unvan ?? ""),
    adres: (r.adres as string | null) ?? null,
    sehir: (r.sehir as string | null) ?? null,
    ilce: (r.ilce as string | null) ?? null,
    distributor: (r.distributor as string | null) ?? null,
    lat: Number(r.lat),
    lng: Number(r.lng),
  }));
}

export type CustomerSales = {
  ciro30: number;
  fatura30: number;
  sonFaturaTarihi: string | null;
};

export type MapFacets = {
  cities: string[];
  distributors: { lngKod: number; ad: string }[];
};

/**
 * Distinct list of cities (any TBLMUSTERI row with a non-empty TXTSEHIR)
 * and active distributors. Cities are deliberately NOT filtered by
 * coordinates / BYTONAY — the map applies those when it actually pulls
 * customers, but the picker should show every city the user might
 * eventually scope to. Aliased so the recordset key is predictable.
 */
export async function getMapFacets(): Promise<MapFacets> {
  const citiesSql = `
    SELECT DISTINCT TOP 200 LTRIM(RTRIM(m.TXTSEHIR)) AS sehir
    FROM dbo.TBLMUSTERI AS m
    WHERE m.TXTSEHIR IS NOT NULL
      AND LTRIM(RTRIM(m.TXTSEHIR)) <> ''
    ORDER BY sehir
  `;
  const distSql = `
    SELECT TOP 200 d.LNGKOD AS lngKod, d.TXTAD AS ad
    FROM dbo.TBLDIST AS d
    WHERE d.BYTDURUM = 0
      AND d.TXTAD IS NOT NULL
      AND LTRIM(RTRIM(d.TXTAD)) <> ''
    ORDER BY ad
  `;

  const [citiesRes, distsRes] = await Promise.all([
    runReadOnly(citiesSql, { limit: 200, timeoutMs: 15_000 }),
    runReadOnly(distSql, { limit: 200, timeoutMs: 15_000 }),
  ]);

  return {
    cities: citiesRes.rows
      .map((r) => String(r.sehir ?? ""))
      .filter((s) => s.length > 0),
    distributors: distsRes.rows.map((r) => ({
      lngKod: Number(r.lngKod),
      ad: String(r.ad),
    })),
  };
}

/**
 * Single-customer revenue lookup — runs only when the user clicks a
 * marker. Filters by LNGMUSTERIKOD only; the distributor field on
 * TBLMUSTERI doesn't always match the LNGDISTKOD on each invoice
 * (a customer can transact across distributors), so locking on it
 * was hiding real activity. The /* distKod arg stays in the API for
 * back-compat but is ignored in the SQL.
 */
export async function getCustomerSales(
  musteriKod: number,
  _distKod: number | null,
  days = 30,
): Promise<CustomerSales> {
  const sql = `
    SELECT
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro30,
      COUNT(*)                      AS fatura30,
      MAX(f.TRHISLEMTARIHI)         AS sonFaturaTarihi
    FROM dbo.TBLMSDFATURA AS f
    WHERE f.LNGMUSTERIKOD = ${Math.floor(musteriKod)}
      AND f.TRHISLEMTARIHI >= DATEADD(day, -${Math.floor(days)}, GETDATE())
      AND f.BYTTUR  = 0
      AND f.BYTDURUM = 0
  `;

  const result = await runReadOnly(sql, { limit: 1, timeoutMs: 20_000 });
  const row = result.rows[0] ?? {};
  return {
    ciro30: Number(row.ciro30 ?? 0),
    fatura30: Number(row.fatura30 ?? 0),
    sonFaturaTarihi: row.sonFaturaTarihi
      ? new Date(row.sonFaturaTarihi as string).toISOString()
      : null,
  };
}
