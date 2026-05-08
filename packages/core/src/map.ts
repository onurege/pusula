import { runReadOnly } from "./db.js";
import { getLocalDb } from "./local-db.js";

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
  /** True if this customer has at least one approved sales invoice in the
   *  last 30 days. Used both for the activity filter and for marker tone. */
  hasSales: boolean;
};

export type MapCustomerFilters = {
  sehir?: string;
  distKod?: number;
  /** "with" → only customers with recent sales, "without" → only silent
   *  customers, undefined → no filter. */
  salesFilter?: "with" | "without";
  limit?: number;
};

export type MapFacets = {
  cities: string[];
  distributors: { lngKod: number; ad: string }[];
};

export type MapSyncStatus = {
  lastSyncAt: string | null;
  durationMs: number;
  customerCount: number;
  cityCount: number;
  distCount: number;
};

/**
 * Reads the customer set from the LOCAL SQLite mirror — never touches
 * MSSQL on the request path. The mirror is populated by syncMapData()
 * (see below), which is the only function that reaches out to MSSQL.
 *
 * Filter combinations are applied in JavaScript here too — at pilot
 * scale the cached set is at most a few thousand rows so it's fine.
 */
export function listMapCustomers(
  repoRoot: string,
  filters: MapCustomerFilters = {},
): MapCustomer[] {
  const db = getLocalDb(repoRoot);
  const limit = Math.min(Math.max(filters.limit ?? 5000, 1), 50_000);

  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filters.sehir) {
    where.push("sehir = @sehir");
    params.sehir = filters.sehir;
  }
  if (typeof filters.distKod === "number" && Number.isFinite(filters.distKod)) {
    where.push("dist_kod = @distKod");
    params.distKod = Math.floor(filters.distKod);
  }
  if (filters.salesFilter === "with") {
    where.push("has_sales = 1");
  } else if (filters.salesFilter === "without") {
    where.push("has_sales = 0");
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT id, dist_kod AS distKod, unvan, adres, sehir, ilce, distributor,
           lat, lng, has_sales AS hasSales
    FROM map_customers
    ${whereSql}
    ORDER BY has_sales DESC, id
    LIMIT @limit
  `;
  const rows = db.prepare(sql).all({ ...params, limit }) as Array<{
    id: number;
    distKod: number | null;
    unvan: string;
    adres: string | null;
    sehir: string | null;
    ilce: string | null;
    distributor: string | null;
    lat: number;
    lng: number;
    hasSales: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    distKod: r.distKod ?? null,
    unvan: r.unvan,
    adres: r.adres,
    sehir: r.sehir,
    ilce: r.ilce,
    distributor: r.distributor,
    lat: r.lat,
    lng: r.lng,
    hasSales: r.hasSales === 1,
  }));
}

export function getMapFacets(repoRoot: string): MapFacets {
  const db = getLocalDb(repoRoot);
  const cities = (
    db.prepare("SELECT sehir FROM map_cities ORDER BY sehir").all() as Array<{ sehir: string }>
  ).map((r) => r.sehir);
  const distributors = (
    db
      .prepare("SELECT lng_kod AS lngKod, ad FROM map_distributors ORDER BY ad")
      .all() as Array<{ lngKod: number; ad: string }>
  ).map((r) => ({ lngKod: r.lngKod, ad: r.ad }));
  return { cities, distributors };
}

export function getSyncStatus(repoRoot: string): MapSyncStatus {
  const db = getLocalDb(repoRoot);
  const row = db
    .prepare(
      `SELECT last_sync_at AS lastSyncAt, duration_ms AS durationMs,
              customer_count AS customerCount, city_count AS cityCount,
              dist_count AS distCount
       FROM sync_state WHERE domain = 'map'`,
    )
    .get() as MapSyncStatus | undefined;
  return (
    row ?? {
      lastSyncAt: null,
      durationMs: 0,
      customerCount: 0,
      cityCount: 0,
      distCount: 0,
    }
  );
}

/**
 * Pulls the map customer set + facet lists from MSSQL in a single trip
 * each, then replaces the SQLite mirror inside one transaction. This is
 * the ONLY function that talks to MSSQL on the map data path; the
 * dashboard reads from SQLite afterwards.
 */
export async function syncMapData(repoRoot: string): Promise<MapSyncStatus> {
  const startedAt = Date.now();

  const customerSql = `
    WITH satisli AS (
      SELECT DISTINCT f.LNGMUSTERIKOD
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        AND f.BYTTUR  = 0
        AND f.BYTDURUM = 0
    )
    SELECT
      m.LNGKOD       AS id,
      m.LNGDISTKOD   AS distKod,
      m.TXTUNVAN     AS unvan,
      m.TXTADRES1    AS adres,
      m.TXTSEHIR     AS sehir,
      m.TXTILCE      AS ilce,
      d.TXTAD        AS distributor,
      CAST(m.DBLKOORDINATX AS FLOAT) AS lat,
      CAST(m.DBLKOORDINATY AS FLOAT) AS lng,
      CASE WHEN s.LNGMUSTERIKOD IS NULL THEN 0 ELSE 1 END AS hasSales
    FROM dbo.TBLMUSTERI AS m
    LEFT JOIN dbo.TBLDIST AS d ON d.LNGKOD = m.LNGDISTKOD
    LEFT JOIN satisli   AS s ON s.LNGMUSTERIKOD = m.LNGKOD
    WHERE m.DBLKOORDINATX > 0 AND m.DBLKOORDINATY > 0
    ORDER BY hasSales DESC, m.LNGKOD
  `;
  const cityFacetSql = `
    SELECT DISTINCT TOP 500 LTRIM(RTRIM(m.TXTSEHIR)) AS sehir
    FROM dbo.TBLMUSTERI AS m
    WHERE m.TXTSEHIR IS NOT NULL
      AND LTRIM(RTRIM(m.TXTSEHIR)) <> ''
    ORDER BY sehir
  `;
  const distFacetSql = `
    SELECT TOP 500 d.LNGKOD AS lngKod, d.TXTAD AS ad
    FROM dbo.TBLDIST AS d
    WHERE d.BYTDURUM = 0 AND d.TXTAD IS NOT NULL
      AND LTRIM(RTRIM(d.TXTAD)) <> ''
    ORDER BY ad
  `;

  const [customersRes, citiesRes, distsRes] = await Promise.all([
    runReadOnly(customerSql, { limit: 200_000, timeoutMs: 120_000 }),
    runReadOnly(cityFacetSql, { limit: 1000, timeoutMs: 30_000 }),
    runReadOnly(distFacetSql, { limit: 1000, timeoutMs: 30_000 }),
  ]);

  const db = getLocalDb(repoRoot);
  const insCustomer = db.prepare(`
    INSERT INTO map_customers
      (id, dist_kod, unvan, adres, sehir, ilce, distributor, lat, lng, has_sales)
    VALUES
      (@id, @distKod, @unvan, @adres, @sehir, @ilce, @distributor, @lat, @lng, @hasSales)
  `);
  const insCity = db.prepare("INSERT OR IGNORE INTO map_cities (sehir) VALUES (?)");
  const insDist = db.prepare(
    "INSERT OR IGNORE INTO map_distributors (lng_kod, ad) VALUES (?, ?)",
  );

  const replaceAll = db.transaction(() => {
    db.exec("DELETE FROM map_customers; DELETE FROM map_cities; DELETE FROM map_distributors;");
    for (const r of customersRes.rows) {
      insCustomer.run({
        id: Number(r.id),
        distKod: r.distKod == null ? null : Number(r.distKod),
        unvan: String(r.unvan ?? ""),
        adres: (r.adres as string | null) ?? null,
        sehir: (r.sehir as string | null) ?? null,
        ilce: (r.ilce as string | null) ?? null,
        distributor: (r.distributor as string | null) ?? null,
        lat: Number(r.lat),
        lng: Number(r.lng),
        hasSales: Number(r.hasSales) === 1 ? 1 : 0,
      });
    }
    for (const r of citiesRes.rows) {
      const v = String(r.sehir ?? "").trim();
      if (v) insCity.run(v);
    }
    for (const r of distsRes.rows) {
      const k = Number(r.lngKod);
      const a = String(r.ad ?? "").trim();
      if (Number.isFinite(k) && a) insDist.run(k, a);
    }
  });
  replaceAll();

  const durationMs = Date.now() - startedAt;
  const status: MapSyncStatus = {
    lastSyncAt: new Date().toISOString(),
    durationMs,
    customerCount: customersRes.rows.length,
    cityCount: citiesRes.rows.length,
    distCount: distsRes.rows.length,
  };
  db.prepare(
    `INSERT INTO sync_state (domain, last_sync_at, duration_ms, customer_count, city_count, dist_count)
     VALUES ('map', @lastSyncAt, @durationMs, @customerCount, @cityCount, @distCount)
     ON CONFLICT(domain) DO UPDATE SET
       last_sync_at = excluded.last_sync_at,
       duration_ms  = excluded.duration_ms,
       customer_count = excluded.customer_count,
       city_count = excluded.city_count,
       dist_count = excluded.dist_count`,
  ).run(status);

  return status;
}

export type CustomerSales = {
  ciro30: number;
  fatura30: number;
  sonFaturaTarihi: string | null;
};

/**
 * Single-customer revenue lookup — the one function on the map path
 * that still goes to MSSQL, because per-click sales numbers are too
 * dynamic to mirror cheaply. Indexed seek on LNGMUSTERIKOD; sub-second.
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
