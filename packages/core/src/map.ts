import { runReadOnly } from "./db.js";
import { cachedClear, withCache } from "./cache.js";
import { getLocalDb } from "./local-db.js";

export type RiskTier = "high" | "medium" | "low" | "active";

export type MapCustomer = {
  id: number;
  distKod: number | null;
  unvan: string;
  kisaAd: string | null;
  adres: string | null;
  sehir: string | null;
  ilce: string | null;
  distributor: string | null;
  lat: number;
  lng: number;
  /** True if this customer has at least one approved sales invoice in the
   *  last 30 days. Used both for the activity filter and for marker tone. */
  hasSales: boolean;
  /** Days since most recent approved sales invoice. NULL = never bought. */
  daysSinceLastSale: number | null;
  /** Days since most recent recorded visit. NULL = never visited. */
  daysSinceLastVisit: number | null;
  /** 30-day ciro and the prior 30-day ciro — feed momentum view. */
  ciro30: number;
  ciroPrev30: number;
  /** Risk tier computed at sync time. See computeRiskTier(). */
  riskTier: RiskTier;
};

/**
 * Derives a risk tier from activity recency and ciro momentum. The thresholds
 * are intentionally simple — a sales manager can override in the UI but the
 * default should never bury a HIGH tier customer.
 */
export function computeRiskTier(input: {
  daysSinceLastSale: number | null;
  daysSinceLastVisit: number | null;
  ciro30: number;
  ciroPrev30: number;
}): RiskTier {
  const { daysSinceLastSale: dSale, daysSinceLastVisit: dVisit, ciro30, ciroPrev30 } = input;

  // Never-engaged customer (no recorded sale) — not "risk", just dormant.
  if (dSale === null) return "low";

  // High-value customer (was buying ≥ X ₺/month) going silent ≥30 days → HIGH risk.
  if (dSale >= 30 && ciroPrev30 >= 50_000) return "high";

  // Long silence (60+ days no sale) on any non-dormant account → HIGH.
  if (dSale >= 60 && ciroPrev30 >= 5_000) return "high";

  // Big momentum drop (≥50% decline 30d vs prev 30d) on meaningful baseline.
  if (ciroPrev30 >= 10_000 && ciro30 < ciroPrev30 * 0.5) return "high";

  // Stale visit (90+ days no visit) AND non-trivial baseline.
  if ((dVisit ?? 999) >= 90 && ciroPrev30 >= 5_000) return "medium";

  // Moderate silence — 30-60 days no sale, low/medium baseline.
  if (dSale >= 30 && ciroPrev30 >= 1_000) return "medium";

  // Active customer with recent sale.
  if (dSale <= 14) return "active";

  return "low";
}

export type MapCustomerFilters = {
  sehir?: string;
  distKod?: number;
  /** "with" → only customers with recent sales, "without" → only silent
   *  customers, undefined → no filter. */
  salesFilter?: "with" | "without";
  /** Filter by risk tier. Useful for the "kayıp riski" view. */
  riskTier?: RiskTier;
  /** Show only customers not visited for ≥ N days. */
  minDaysSinceVisit?: number;
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

  if (filters.riskTier) {
    where.push("risk_tier = @riskTier");
    params.riskTier = filters.riskTier;
  }
  if (typeof filters.minDaysSinceVisit === "number") {
    where.push("(days_since_last_visit IS NULL OR days_since_last_visit >= @minDaysSinceVisit)");
    params.minDaysSinceVisit = Math.floor(filters.minDaysSinceVisit);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sql = `
    SELECT id, dist_kod AS distKod, unvan, kisa_ad AS kisaAd, adres, sehir,
           ilce, distributor, lat, lng, has_sales AS hasSales,
           days_since_last_sale  AS daysSinceLastSale,
           days_since_last_visit AS daysSinceLastVisit,
           ciro_30d              AS ciro30,
           ciro_prev_30d         AS ciroPrev30,
           risk_tier             AS riskTier
    FROM map_customers
    ${whereSql}
    ORDER BY
      CASE risk_tier WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'active' THEN 2 ELSE 3 END,
      has_sales DESC,
      id
    LIMIT @limit
  `;
  const rows = db.prepare(sql).all({ ...params, limit }) as Array<{
    id: number;
    distKod: number | null;
    unvan: string;
    kisaAd: string | null;
    adres: string | null;
    sehir: string | null;
    ilce: string | null;
    distributor: string | null;
    lat: number;
    lng: number;
    hasSales: number;
    daysSinceLastSale: number | null;
    daysSinceLastVisit: number | null;
    ciro30: number | null;
    ciroPrev30: number | null;
    riskTier: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    distKod: r.distKod ?? null,
    unvan: r.unvan,
    kisaAd: r.kisaAd ?? null,
    adres: r.adres,
    sehir: r.sehir,
    ilce: r.ilce,
    distributor: r.distributor,
    lat: r.lat,
    lng: r.lng,
    hasSales: r.hasSales === 1,
    daysSinceLastSale: r.daysSinceLastSale ?? null,
    daysSinceLastVisit: r.daysSinceLastVisit ?? null,
    ciro30: r.ciro30 ?? 0,
    ciroPrev30: r.ciroPrev30 ?? 0,
    riskTier: (r.riskTier as RiskTier) ?? "low",
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

  // Pre-aggregated risk dimensions per customer — single trip during sync so
  // map page renders use only SQLite. Risk tier is derived in JS after the
  // pull (easier to tune thresholds without a SQL rewrite).
  const customerSql = `
    WITH son_satis AS (
      SELECT f.LNGMUSTERIKOD, MAX(f.TRHISLEMTARIHI) AS son
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      GROUP BY f.LNGMUSTERIKOD
    ),
    ciro_30 AS (
      SELECT f.LNGMUSTERIKOD, SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    ciro_prev_30 AS (
      SELECT f.LNGMUSTERIKOD, SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA AS f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -60, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -30, GETDATE())
      GROUP BY f.LNGMUSTERIKOD
    ),
    son_ziyaret AS (
      SELECT z.LNGMUSTERIKOD, MAX(z.TRHGIRIS) AS son
      FROM dbo.TBLPMPZIYARETBASLIK AS z
      WHERE z.TRHGIRIS IS NOT NULL
      GROUP BY z.LNGMUSTERIKOD
    )
    SELECT
      m.LNGKOD       AS id,
      m.LNGDISTKOD   AS distKod,
      m.TXTUNVAN     AS unvan,
      m.TXTKISAAD    AS kisaAd,
      m.TXTADRES1    AS adres,
      m.TXTSEHIR     AS sehir,
      m.TXTILCE      AS ilce,
      d.TXTAD        AS distributor,
      CAST(m.DBLKOORDINATX AS FLOAT) AS lat,
      CAST(m.DBLKOORDINATY AS FLOAT) AS lng,
      CASE WHEN c30.LNGMUSTERIKOD IS NULL THEN 0 ELSE 1 END AS hasSales,
      CASE WHEN s.son IS NULL THEN NULL ELSE DATEDIFF(day, s.son, GETDATE()) END AS daysSinceLastSale,
      CASE WHEN z.son IS NULL THEN NULL ELSE DATEDIFF(day, z.son, GETDATE()) END AS daysSinceLastVisit,
      ISNULL(c30.ciro, 0)   AS ciro30,
      ISNULL(cp30.ciro, 0)  AS ciroPrev30
    FROM dbo.TBLMUSTERI AS m
    LEFT JOIN dbo.TBLDIST    AS d   ON d.LNGKOD = m.LNGDISTKOD
    LEFT JOIN son_satis      AS s   ON s.LNGMUSTERIKOD = m.LNGKOD
    LEFT JOIN ciro_30        AS c30 ON c30.LNGMUSTERIKOD = m.LNGKOD
    LEFT JOIN ciro_prev_30   AS cp30 ON cp30.LNGMUSTERIKOD = m.LNGKOD
    LEFT JOIN son_ziyaret    AS z   ON z.LNGMUSTERIKOD = m.LNGKOD
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
      (id, dist_kod, unvan, kisa_ad, adres, sehir, ilce, distributor,
       lat, lng, has_sales,
       days_since_last_sale, days_since_last_visit,
       ciro_30d, ciro_prev_30d, risk_tier)
    VALUES
      (@id, @distKod, @unvan, @kisaAd, @adres, @sehir, @ilce, @distributor,
       @lat, @lng, @hasSales,
       @daysSinceLastSale, @daysSinceLastVisit,
       @ciro30, @ciroPrev30, @riskTier)
  `);
  const insCity = db.prepare("INSERT OR IGNORE INTO map_cities (sehir) VALUES (?)");
  const insDist = db.prepare(
    "INSERT OR IGNORE INTO map_distributors (lng_kod, ad) VALUES (?, ?)",
  );

  const replaceAll = db.transaction(() => {
    db.exec("DELETE FROM map_customers; DELETE FROM map_cities; DELETE FROM map_distributors;");
    for (const r of customersRes.rows) {
      const daysSinceLastSale = r.daysSinceLastSale == null ? null : Number(r.daysSinceLastSale);
      const daysSinceLastVisit = r.daysSinceLastVisit == null ? null : Number(r.daysSinceLastVisit);
      const ciro30 = Number(r.ciro30 ?? 0);
      const ciroPrev30 = Number(r.ciroPrev30 ?? 0);
      insCustomer.run({
        id: Number(r.id),
        distKod: r.distKod == null ? null : Number(r.distKod),
        unvan: String(r.unvan ?? ""),
        kisaAd: (r.kisaAd as string | null) ?? null,
        adres: (r.adres as string | null) ?? null,
        sehir: (r.sehir as string | null) ?? null,
        ilce: (r.ilce as string | null) ?? null,
        distributor: (r.distributor as string | null) ?? null,
        lat: Number(r.lat),
        lng: Number(r.lng),
        hasSales: Number(r.hasSales) === 1 ? 1 : 0,
        daysSinceLastSale,
        daysSinceLastVisit,
        ciro30,
        ciroPrev30,
        riskTier: computeRiskTier({
          daysSinceLastSale,
          daysSinceLastVisit,
          ciro30,
          ciroPrev30,
        }),
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

  // Underlying MSSQL data may have shifted — invalidate every read-through
  // cache that reflects it (customer detail, foresight). Radar caches stay
  // because they have their own per-radar refresh affordance.
  cachedClear("customer-detail");
  cachedClear("foresight");

  return status;
}

export type CustomerDetail = {
  // Sales
  ciro30: number;
  fatura30: number;
  sonFaturaTarihi: string | null;

  // Visits (from TBLPMPZIYARETBASLIK)
  ziyaret30: number;
  rutIciZiyaret: number;
  rutDisiZiyaret: number;
  sonZiyaretTarihi: string | null;

  // Payments collected during visits (TBLMSDTAHSILAT joined through ZIYARETDETAY)
  // BYTISLEMKODU codes from SP 5190: 100=Nakit, 104=Çek, 108=Senet, 112=KK
  // (paired with iptal codes 102/106/110/114 — only count entries without iptal pair)
  tahsilatNakit: number;
  tahsilatCek: number;
  tahsilatSenet: number;
  tahsilatKK: number;

  // Document counts inside visits (TBLPMPZIYARETDETAY)
  // BYTISLEMKODU 4=Fatura kesildi, 30=İrsaliye, 60=Sipariş
  ziyaretFaturaSayisi: number;
  ziyaretIrsaliyeSayisi: number;
  ziyaretSiparisSayisi: number;
};

// Backwards-compat alias — older code paths used CustomerSales.
export type CustomerSales = CustomerDetail;

/**
 * Single-customer activity lookup — sales, visits, payments, and document
 * counts from the last N days. Four parallel queries against MSSQL; the
 * popup latency is max(four queries) not sum.
 *
 * The visit / payment / document logic mirrors Pernod's report 5190
 * (SSP_RPT_5190_ZIYARET_ANALIZI). Specifically:
 * - A visit is a TBLPMPZIYARETBASLIK row with TRHGIRIS NOT NULL.
 * - Payments live on TBLMSDTAHSILAT, joined into the visit through
 *   TBLPMPZIYARETDETAY.LNGBELGEKOD with BYTISLEMKODU IN (100,104,108,112).
 *   Each transaction code has a paired "iptal" code (+2); we exclude
 *   payments that have an iptal pair on the same belge.
 * - Document codes: 4=Fatura, 30=İrsaliye, 60=Sipariş — same pattern,
 *   each has an iptal counterpart (+2) we exclude.
 */
export async function getCustomerDetail(
  musteriKod: number,
  days = 30,
  options: { forceRefresh?: boolean } = {},
): Promise<CustomerDetail> {
  const id = Math.floor(musteriKod);
  const d = Math.floor(days);

  const cacheKey = `${id}:${d}`;
  const result = await withCache<CustomerDetail>(
    "customer-detail",
    cacheKey,
    () => loadCustomerDetailFromMssql(id, d),
    { forceRefresh: options.forceRefresh },
  );
  return result.value;
}

async function loadCustomerDetailFromMssql(
  id: number,
  d: number,
): Promise<CustomerDetail> {

  const salesSql = `
    SELECT
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro,
      COUNT(*)                      AS fatura,
      MAX(f.TRHISLEMTARIHI)         AS sonTarih
    FROM dbo.TBLMSDFATURA AS f
    WHERE f.LNGMUSTERIKOD = ${id}
      AND f.TRHISLEMTARIHI >= DATEADD(day, -${d}, GETDATE())
      AND f.BYTTUR  = 0
      AND f.BYTDURUM = 0
  `;

  const visitSql = `
    SELECT
      COUNT(*)                                            AS ziyaret,
      SUM(CASE WHEN z.BYTRUTKODU = 0 THEN 1 ELSE 0 END)   AS rutIci,
      SUM(CASE WHEN z.BYTRUTKODU = 1 THEN 1 ELSE 0 END)   AS rutDisi,
      MAX(z.TRHGIRIS)                                     AS sonZiyaret
    FROM dbo.TBLPMPZIYARETBASLIK AS z
    WHERE z.LNGMUSTERIKOD = ${id}
      AND z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -${d}, GETDATE())
  `;

  const tahsilatSql = `
    SELECT
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 100 THEN t.DBLTUTAR ELSE 0 END), 0) AS nakit,
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 104 THEN t.DBLTUTAR ELSE 0 END), 0) AS cek,
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 108 THEN t.DBLTUTAR ELSE 0 END), 0) AS senet,
      ISNULL(SUM(CASE WHEN d.BYTISLEMKODU = 112 THEN t.DBLTUTAR ELSE 0 END), 0) AS kk
    FROM dbo.TBLPMPZIYARETDETAY    AS d
    INNER JOIN dbo.TBLPMPZIYARETBASLIK AS z ON z.LNGKOD = d.LNGBASLIKKOD
    INNER JOIN dbo.TBLMSDTAHSILAT  AS t ON t.LNGKOD = d.LNGBELGEKOD
    WHERE z.LNGMUSTERIKOD = ${id}
      AND z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -${d}, GETDATE())
      AND d.BYTISLEMKODU IN (100, 104, 108, 112)
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TBLPMPZIYARETDETAY x
        WHERE x.LNGBELGEKOD = d.LNGBELGEKOD
          AND x.BYTISLEMKODU IN (102, 106, 110, 114)
      )
  `;

  const belgeSql = `
    SELECT
      SUM(CASE WHEN d.BYTISLEMKODU = 4 THEN 1 ELSE 0 END)  AS faturaSayi,
      SUM(CASE WHEN d.BYTISLEMKODU = 30 THEN 1 ELSE 0 END) AS irsaliyeSayi,
      SUM(CASE WHEN d.BYTISLEMKODU = 60 THEN 1 ELSE 0 END) AS siparisSayi
    FROM dbo.TBLPMPZIYARETDETAY    AS d
    INNER JOIN dbo.TBLPMPZIYARETBASLIK AS z ON z.LNGKOD = d.LNGBASLIKKOD
    WHERE z.LNGMUSTERIKOD = ${id}
      AND z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -${d}, GETDATE())
      AND d.BYTISLEMKODU IN (4, 30, 60)
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TBLPMPZIYARETDETAY x
        WHERE x.LNGBELGEKOD = d.LNGBELGEKOD
          AND x.BYTISLEMKODU = d.BYTISLEMKODU + 2
      )
  `;

  const [sales, visits, tahsilat, belge] = await Promise.all([
    runReadOnly(salesSql, { limit: 1, timeoutMs: 20_000 }),
    runReadOnly(visitSql, { limit: 1, timeoutMs: 20_000 }),
    runReadOnly(tahsilatSql, { limit: 1, timeoutMs: 30_000 }),
    runReadOnly(belgeSql, { limit: 1, timeoutMs: 20_000 }),
  ]);

  const s = sales.rows[0] ?? {};
  const v = visits.rows[0] ?? {};
  const t = tahsilat.rows[0] ?? {};
  const b = belge.rows[0] ?? {};

  return {
    ciro30: Number(s.ciro ?? 0),
    fatura30: Number(s.fatura ?? 0),
    sonFaturaTarihi: s.sonTarih
      ? new Date(s.sonTarih as string).toISOString()
      : null,

    ziyaret30: Number(v.ziyaret ?? 0),
    rutIciZiyaret: Number(v.rutIci ?? 0),
    rutDisiZiyaret: Number(v.rutDisi ?? 0),
    sonZiyaretTarihi: v.sonZiyaret
      ? new Date(v.sonZiyaret as string).toISOString()
      : null,

    tahsilatNakit: Number(t.nakit ?? 0),
    tahsilatCek: Number(t.cek ?? 0),
    tahsilatSenet: Number(t.senet ?? 0),
    tahsilatKK: Number(t.kk ?? 0),

    ziyaretFaturaSayisi: Number(b.faturaSayi ?? 0),
    ziyaretIrsaliyeSayisi: Number(b.irsaliyeSayi ?? 0),
    ziyaretSiparisSayisi: Number(b.siparisSayi ?? 0),
  };
}

// Old name kept so existing callers (api server route, mcp tools) continue
// to work without a breaking change in this PR. Original signature was
// (musteriKod, distKod, days) — distKod argument is now ignored.
export async function getCustomerSales(
  musteriKod: number,
  _distKod: number | null,
  days = 30,
  options: { forceRefresh?: boolean } = {},
): Promise<CustomerDetail> {
  return getCustomerDetail(musteriKod, days, options);
}
