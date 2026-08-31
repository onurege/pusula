/**
 * Wietnauer Dashboard #7 — Ticari Yatırım & İskonto.
 *
 * Ne soruyu cevaplar:
 *   - Brüt → İskonto → Net akışı nedir? İskonto/ciro oranı sağlıklı mı?
 *   - Aylık trend: iskonto harcaması ve oranı zamana göre nasıl evriliyor?
 *   - Marka × etkinlik: hangi marka iskonto yatırımı topluyor, sağlıklı mı?
 *   - Müşteri ROI: en çok iskonto verilen müşteriler kim, premium mu bağımlı mı?
 *   - Segment kırılımı: müşteri grup kırılımına (Prestige/Premium/Standart…)
 *     göre iskonto stratejisi nasıl?
 *
 * Cache stratejisi: full dataset (tüm dist'ler) TEK cache anahtarı altında
 * `withCache` — wietnauer-stok.ts `scopedRows` deseni. Dist filtresi/scope
 * runtime'da JS'te uygulanır. Tüm fetcher'lar `Promise.all` ile paralel;
 * toplam latency = en yavaş sorgu.
 *
 * KAPALI PENCERE: tüm 30g sorgularında `>=` + `<` (DATEADD day, 1) kullanılır.
 * DEMO_DATE'in ötesini yutmamak için ÜST SINIR pazarlıksız.
 */
import { withCache } from "./cache.js";
import { sqlNow } from "./now.js";
import { runReadOnly } from "./db.js";
import { getTenantConfig } from "./tenant/index.js";
import { cityFactClause, cityCacheTag } from "./auth.js";

const CACHE_DOMAIN = "wietnauer-iskonto";
// v4: cache-key scope fragmentation düzeltmesi (VYK-01) — dist filtresi
// SQL'den çıkarıldı; tüm fetcher'lar scope'suz (tüm dist) tek cache anahtarı
// altında çekilir, dist_id (`LNGDISTKOD`) SELECT/GROUP BY'a eklendi ki JS
// tarafı scope filtresi + re-aggregate yapabilsin.
// v5: (a) segment kaynağı TBLMUSTERIGRUP → TBLMUSTERIGRUPKIRILIM (md), (b) yeni
// ekGrupSegments alanı (müşteri ek grup, top 5 + Diğer — Yönetim segment paneli).
const CACHE_VERSION = "v5";

// ---------- Tipler ----------------------------------------------------------

export type DiscountOverall = {
  brut: number;
  iskonto: number;
  net: number;
  /** iskonto / brüt × 100 */
  iskontoOraniPct: number;
  faturaCount: number;
  aktifMusteriCount: number;
};

export type DiscountMonthlyPoint = {
  /** YYYY-MM */
  yyyymm: string;
  /** Türkçe kısa ay (Oca, Şub, ...) */
  ay: string;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
};

export type DiscountBrandRow = {
  marka: string;
  markaKod: string;
  brut: number;
  iskonto: number;
  net: number;
  /** iskonto / brüt × 100 */
  iskontoOraniPct: number;
  /** Geçen yıla göre net büyüme (yoY %), bilinmiyorsa null */
  yoyNetPct: number | null;
  rank: number;
  isStratejik: boolean;
};

export type DiscountTopCustomer = {
  id: number;
  unvan: string;
  sehir: string | null;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  faturaSayisi: number;
  rank: number;
  /** Davranış etiketi — düşük oran = premium, yüksek = iskonto bağımlı */
  etiket: "premium" | "saglikli" | "bagimli";
};

export type DiscountSegmentRow = {
  segment: string;
  brut: number;
  iskonto: number;
  net: number;
  /** Segment için ortalama iskonto oranı (toplam iskonto / toplam brüt × 100) */
  iskontoOraniPct: number;
  musteriSayi: number;
  faturaSayisi: number;
};

export type WietnauerIskontoSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  overall: DiscountOverall;
  monthly: DiscountMonthlyPoint[]; // son 12 ay
  brands: DiscountBrandRow[]; // top 15 (brut DESC)
  topCustomers: DiscountTopCustomer[]; // top 20 (iskonto DESC)
  /** Müşteri Grup Kırılımı (Prestige/Premium/Standart…) × iskonto */
  segments: DiscountSegmentRow[];
  /** Müşteri Ek Grup (TBLMUSTERIEKGRUP: TEKEL/BÜFE/MARKET/BAR…) × iskonto —
   *  brüt'e göre ilk 5, kalanı "Diğer" başlığı altında toplanır. */
  ekGrupSegments: DiscountSegmentRow[];
};

// ---------- Tarih aralığı yardımcıları --------------------------------------

/** `dateFrom`/`dateTo` yalnızca YYYY-MM-DD formatındaysa kabul edilir — SQL
 * interpolasyonu öncesi enjeksiyon emniyeti (defense in depth; server.ts
 * ?from&to'yu zaten aynı regex ile doğruluyor). */
function isIsoDate(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Normalize edilmiş {dateFrom, dateTo} — ikisi de geçerli YYYY-MM-DD değilse
 * ikisi de null döner (kısmi aralık kabul edilmez, varsayılan pencereye düşer).
 */
function normalizeDateRange(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
): { dateFrom: string | null; dateTo: string | null } {
  if (isIsoDate(dateFrom) && isIsoDate(dateTo)) return { dateFrom, dateTo };
  return { dateFrom: null, dateTo: null };
}

/**
 * KAPALI PENCERE tarih clause'u: aralık verilmişse `>= dateFrom AND <
 * dateTo+1gün`; verilmemişse `defaultClause` (fetcher'ın kendi varsayılan
 * penceresi, ör. son 30g / son 12 ay) kullanılır.
 */
function dateRangeClause(
  column: string,
  dateFrom: string | null,
  dateTo: string | null,
  defaultClause: string,
): string {
  if (dateFrom != null && dateTo != null) {
    return `${column} >= '${dateFrom}' AND ${column} < DATEADD(day, 1, '${dateTo}')`;
  }
  return defaultClause;
}

/**
 * Marka fetcher'ının YoY karşılaştırması için — aynı aralığın bir yıl
 * öncesi. Aralık verilmemişse `defaultClause` kullanılır.
 */
function dateRangeClausePrevYear(
  column: string,
  dateFrom: string | null,
  dateTo: string | null,
  defaultClause: string,
): string {
  if (dateFrom != null && dateTo != null) {
    return `${column} >= DATEADD(year, -1, '${dateFrom}') AND ${column} < DATEADD(day, 1, DATEADD(year, -1, '${dateTo}'))`;
  }
  return defaultClause;
}

// ---------- Fetcher'lar -----------------------------------------------------

/**
 * Header toplamları: brüt, iskonto, net, oran, fatura/aktif müşteri.
 * TBLMSDFATURA.DBLISKONTOTUTARI fatura başlığındaki TOPLAM iskonto;
 * brüt = DBLBRUTTUTAR, net = DBLNETTUTAR. Header-bazlı çünkü hızlı &
 * snapshot-grade. Marka/SKU kırılımı için detay sorgusu ayrı.
 *
 * Varsayılan pencere: son 30g. `dateFrom`/`dateTo` verilirse KAPALI PENCERE
 * (`>=`/`<`) o aralığa daralır.
 */
type DiscountOverallRawRow = {
  distId: number | null;
  brut: number;
  iskonto: number;
  net: number;
  faturaCount: number;
  aktifMusteriCount: number;
};

/** Scope-free ham satırlar — dist bazında (~31 satır, ucuz). */
async function fetchDiscountOverallRaw(
  cities: string[] | null | undefined,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<DiscountOverallRawRow[]> {
  const dateClause = dateRangeClause(
    "TRHISLEMTARIHI",
    dateFrom,
    dateTo,
    `TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()}) AND TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()})`,
  );
  const sql = `
    SELECT
      LNGDISTKOD AS dist_id,
      ISNULL(SUM(DBLBRUTTUTAR), 0) AS brut,
      ISNULL(SUM(DBLISKONTOTUTARI), 0) AS iskonto,
      ISNULL(SUM(DBLNETTUTAR), 0) AS net,
      COUNT(*) AS fatura_count,
      COUNT(DISTINCT LNGMUSTERIKOD) AS aktif_musteri_count
    FROM dbo.TBLMSDFATURA
    WHERE BYTTUR = 0 AND BYTDURUM = 0
      AND ${dateClause}${cityFactClause(cities, "LNGMUSTERIKOD")}
    GROUP BY LNGDISTKOD
  `;
  const result = await runReadOnly(sql, { limit: 200 });
  return result.rows.map((r) => ({
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    brut: Number(r.brut ?? 0),
    iskonto: Number(r.iskonto ?? 0),
    net: Number(r.net ?? 0),
    faturaCount: Number(r.fatura_count ?? 0),
    aktifMusteriCount: Number(r.aktif_musteri_count ?? 0),
  }));
}

/** dist-scope uygulanmış satırları toplayıp overall KPI'ya çevirir. */
function aggregateDiscountOverall(rows: DiscountOverallRawRow[]): DiscountOverall {
  const brut = rows.reduce((a, r) => a + r.brut, 0);
  const iskonto = rows.reduce((a, r) => a + r.iskonto, 0);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const faturaCount = rows.reduce((a, r) => a + r.faturaCount, 0);
  const aktifMusteriCount = rows.reduce((a, r) => a + r.aktifMusteriCount, 0);
  return {
    brut,
    iskonto,
    net,
    iskontoOraniPct: brut > 0 ? Number(((iskonto / brut) * 100).toFixed(2)) : 0,
    faturaCount,
    aktifMusteriCount,
  };
}

/**
 * Son 12 ay × {brüt, iskonto, net, oran}. KAPALI PENCERE: 12 ay önceki ayın
 * başından bugünün sonuna. Header bazlı toplam; trend görselleştirmesi için
 * yeterli granülerlik.
 */
type DiscountMonthlyRawRow = {
  distId: number | null;
  yyyymm: string;
  brut: number;
  iskonto: number;
  net: number;
};

/**
 * Son 12 ay (veya `dateFrom`/`dateTo` verilmişse o aralık) × dist × {brüt,
 * iskonto, net} ham satırları — scope-free. `LNGDISTKOD` GROUP BY'a eklendi
 * (31 dist × 12 ay ≈ 372 satır — ucuz).
 */
async function fetchDiscountMonthlyTrendRaw(
  cities: string[] | null | undefined,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<DiscountMonthlyRawRow[]> {
  const dateClause = dateRangeClause(
    "TRHISLEMTARIHI",
    dateFrom,
    dateTo,
    `TRHISLEMTARIHI >= DATEADD(month, -12, ${sqlNow()}) AND TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()})`,
  );
  const sql = `
    SELECT
      LNGDISTKOD AS dist_id,
      DATEPART(year,  TRHISLEMTARIHI) AS yil,
      DATEPART(month, TRHISLEMTARIHI) AS ay,
      ISNULL(SUM(DBLBRUTTUTAR), 0) AS brut,
      ISNULL(SUM(DBLISKONTOTUTARI), 0) AS iskonto,
      ISNULL(SUM(DBLNETTUTAR), 0) AS net
    FROM dbo.TBLMSDFATURA
    WHERE BYTTUR = 0 AND BYTDURUM = 0
      AND ${dateClause}${cityFactClause(cities, "LNGMUSTERIKOD")}
    GROUP BY LNGDISTKOD, DATEPART(year, TRHISLEMTARIHI), DATEPART(month, TRHISLEMTARIHI)
    ORDER BY yil, ay
  `;
  const result = await runReadOnly(sql, { limit: 1000, timeoutMs: 30_000 });
  return result.rows.map((r) => {
    const yil = Number(r.yil);
    const ay = Number(r.ay);
    return {
      distId: r.dist_id != null ? Number(r.dist_id) : null,
      yyyymm: `${yil}-${String(ay).padStart(2, "0")}`,
      brut: Number(r.brut ?? 0),
      iskonto: Number(r.iskonto ?? 0),
      net: Number(r.net ?? 0),
    };
  });
}

/** dist-scope uygulanmış satırları ay bazında re-aggregate eder. */
function aggregateDiscountMonthlyTrend(rows: DiscountMonthlyRawRow[]): DiscountMonthlyPoint[] {
  const monthsTR = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  const byMonth = new Map<string, { brut: number; iskonto: number; net: number }>();
  for (const row of rows) {
    const existing = byMonth.get(row.yyyymm);
    if (existing) {
      existing.brut += row.brut;
      existing.iskonto += row.iskonto;
      existing.net += row.net;
    } else {
      byMonth.set(row.yyyymm, { brut: row.brut, iskonto: row.iskonto, net: row.net });
    }
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([yyyymm, m]) => {
      const ayNum = Number(yyyymm.split("-")[1]);
      const oran = m.brut > 0 ? (m.iskonto / m.brut) * 100 : 0;
      return {
        yyyymm,
        ay: monthsTR[ayNum - 1] ?? "?",
        brut: m.brut,
        iskonto: m.iskonto,
        net: m.net,
        iskontoOraniPct: Number(oran.toFixed(2)),
      };
    });
}

/**
 * Marka × iskonto etkinliği — son 30g detay seviyesinde.
 * Detay tablosunda:
 *   brüt satır = DBLBIRIMFIYAT × DBLMIKTAR
 *   net satır  = DBLNETFIYAT  (zaten satır toplamı)
 *   iskonto    = brüt - net
 *
 * yoY: aynı 30g ama bir yıl öncesi penceresinden net ciro. Marka kodu
 * üzerinden eşleştirilir; geçen yıl satışı yoksa null.
 */
type DiscountBrandRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  brut: number;
  net: number;
  netPrev: number;
};

/**
 * Marka × dist iskonto etkinliği ham satırları — scope-free. `TOP 30`
 * kaldırıldı, `f.LNGDISTKOD` GROUP BY'a eklendi (55 marka × 31 dist ≈ 1700
 * satır — ucuz). Top 30 + YoY% scope SONRASI public API'de hesaplanır.
 */
async function fetchDiscountByBrandRaw(
  cities: string[] | null | undefined,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<DiscountBrandRawRow[]> {
  const tenant = getTenantConfig();
  const brandTable = tenant.brandTable;
  const joinCol = tenant.brandJoinColumn;

  // SQL injection emniyeti — enum doğrulama (config TS union'dan gelir)
  if (!["TBLURUNEKGRUP", "TBLURUNGRUP"].includes(brandTable))
    throw new Error(`Geçersiz brandTable: ${brandTable}`);
  if (!["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"].includes(joinCol))
    throw new Error(`Geçersiz brandJoinColumn: ${joinCol}`);

  const curClause = dateRangeClause(
    "f.TRHISLEMTARIHI",
    dateFrom,
    dateTo,
    `f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()})`,
  );
  const prevClause = dateRangeClausePrevYear(
    "f.TRHISLEMTARIHI",
    dateFrom,
    dateTo,
    `f.TRHISLEMTARIHI >= DATEADD(day, -30, DATEADD(year, -1, ${sqlNow()})) AND f.TRHISLEMTARIHI < DATEADD(day, 1, DATEADD(year, -1, ${sqlNow()}))`,
  );

  const sql = `
    WITH cur AS (
      SELECT
        b.TXTKOD AS marka_kod,
        b.TXTAD  AS marka,
        f.LNGDISTKOD AS dist_id,
        SUM(d.DBLBIRIMFIYAT * d.DBLMIKTAR) AS brut,
        SUM(d.DBLNETFIYAT) AS net
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND ${curClause}${cityFactClause(cities)}
      GROUP BY b.TXTKOD, b.TXTAD, f.LNGDISTKOD
    ),
    prev AS (
      SELECT
        b.TXTKOD AS marka_kod,
        f.LNGDISTKOD AS dist_id,
        SUM(d.DBLNETFIYAT) AS net_prev
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND ${prevClause}${cityFactClause(cities)}
      GROUP BY b.TXTKOD, f.LNGDISTKOD
    )
    SELECT
      cur.marka_kod,
      cur.marka,
      cur.dist_id,
      cur.brut,
      cur.net,
      prev.net_prev
    FROM cur
    LEFT JOIN prev ON prev.marka_kod = cur.marka_kod AND prev.dist_id = cur.dist_id
    ORDER BY cur.brut DESC
  `;
  const result = await runReadOnly(sql, { limit: 3000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    markaKod: String(r.marka_kod ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    brut: Number(r.brut ?? 0),
    net: Number(r.net ?? 0),
    netPrev: Number(r.net_prev ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları marka bazında re-aggregate eder + YoY%/rank hesaplar. */
function aggregateDiscountByBrand(
  rows: DiscountBrandRawRow[],
  strategicBrands: string[],
): DiscountBrandRow[] {
  const byMarka = new Map<
    string,
    { marka: string; markaKod: string; brut: number; net: number; netPrev: number }
  >();
  for (const row of rows) {
    const existing = byMarka.get(row.markaKod);
    if (existing) {
      existing.brut += row.brut;
      existing.net += row.net;
      existing.netPrev += row.netPrev;
    } else {
      byMarka.set(row.markaKod, {
        marka: row.marka,
        markaKod: row.markaKod,
        brut: row.brut,
        net: row.net,
        netPrev: row.netPrev,
      });
    }
  }
  const stratSet = new Set(strategicBrands.map((b) => b.toLocaleLowerCase("tr")));
  return [...byMarka.values()]
    .sort((a, b) => b.brut - a.brut)
    .slice(0, 30)
    .map((m, i) => {
      const iskonto = m.brut - m.net;
      return {
        marka: m.marka,
        markaKod: m.markaKod,
        brut: m.brut,
        iskonto,
        net: m.net,
        iskontoOraniPct: m.brut > 0 ? Number(((iskonto / m.brut) * 100).toFixed(2)) : 0,
        yoyNetPct: m.netPrev > 0 ? Number((((m.net - m.netPrev) / m.netPrev) * 100).toFixed(2)) : null,
        rank: i + 1,
        isStratejik: stratSet.has(m.marka.toLocaleLowerCase("tr")),
      };
    });
}

/**
 * Son 30g iskonto verilen Top 20 müşteri — header bazlı.
 * Sıralama: iskonto DESC (en çok iskonto YEMİŞ). Etiket eşikleri:
 *   <10%   → "premium"   (düşük iskonto / yüksek değer)
 *   10-25% → "saglikli"  (sektör normali)
 *   >25%   → "bagimli"   (iskonto bağımlı, ROI sorgulanır)
 */
type DiscountTopCustomerRawRow = Omit<DiscountTopCustomer, "rank" | "etiket" | "iskontoOraniPct"> & {
  distId: number | null;
};

/**
 * Tüm müşteriler (iskonto > 0, son 30g) — scope-free. `TOP 20` kaldırıldı;
 * dist scope uygulanmadan Top 20 kesilirse küçük dist'in kendi top
 * müşterileri listeden düşebilir. ~8-9K aktif müşteri (30g) — wietnauer-
 * stok.ts'teki cardinality ile aynı mertebede, güvenli. Top 20 + etiket
 * scope SONRASI public API'de hesaplanır.
 */
async function fetchDiscountTopCustomersRaw(
  cities: string[] | null | undefined,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<DiscountTopCustomerRawRow[]> {
  const dateClause = dateRangeClause(
    "f.TRHISLEMTARIHI",
    dateFrom,
    dateTo,
    `f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()})`,
  );
  const sql = `
    SELECT
      f.LNGMUSTERIKOD AS id,
      f.LNGDISTKOD AS dist_id,
      m.TXTUNVAN AS unvan,
      m.TXTSEHIR AS sehir,
      SUM(f.DBLBRUTTUTAR)     AS brut,
      SUM(f.DBLISKONTOTUTARI) AS iskonto,
      SUM(f.DBLNETTUTAR)      AS net,
      COUNT(*)                AS fatura
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND ${dateClause}
      AND f.DBLISKONTOTUTARI > 0${cityFactClause(cities)}
    GROUP BY f.LNGMUSTERIKOD, f.LNGDISTKOD, m.TXTUNVAN, m.TXTSEHIR
    ORDER BY SUM(f.DBLISKONTOTUTARI) DESC
  `;
  const result = await runReadOnly(sql, { limit: 20_000, timeoutMs: 60_000 });
  return result.rows.map((r) => ({
    id: Number(r.id),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    unvan: String(r.unvan ?? ""),
    sehir: r.sehir ? String(r.sehir) : null,
    brut: Number(r.brut ?? 0),
    iskonto: Number(r.iskonto ?? 0),
    net: Number(r.net ?? 0),
    faturaSayisi: Number(r.fatura ?? 0),
  }));
}

/** dist-scope uygulanmış satırları iskonto DESC sıralayıp Top 20'yi + etiketi hesaplar. */
function aggregateDiscountTopCustomers(rows: DiscountTopCustomerRawRow[]): DiscountTopCustomer[] {
  return [...rows]
    .sort((a, b) => b.iskonto - a.iskonto)
    .slice(0, 20)
    .map((r, i) => {
      const oran = r.brut > 0 ? Number(((r.iskonto / r.brut) * 100).toFixed(2)) : 0;
      const etiket: DiscountTopCustomer["etiket"] =
        oran < 10 ? "premium" : oran < 25 ? "saglikli" : "bagimli";
      return {
        id: r.id,
        unvan: r.unvan,
        sehir: r.sehir,
        brut: r.brut,
        iskonto: r.iskonto,
        net: r.net,
        iskontoOraniPct: oran,
        faturaSayisi: r.faturaSayisi,
        rank: i + 1,
        etiket,
      };
    });
}

/**
 * Müşteri Grup Kırılımı (TBLMUSTERIGRUPKIRILIM.TXTAD × TBLMUSTERI.TXTGRUPKIRILIMKOD)
 * × iskonto ortalaması. Değerler: Prestige, Premium, Premium Plus, Standart,
 * Standart Plus, "Off Trade C&PS Tedarikçi vb." (kod 1..6). Kırılım kodu boş
 * olanlar "(Tanımsız)" fallback'e düşer. Oran = toplam_iskonto / toplam_brüt
 * × 100 — ağırlıklı ortalama (her segment kendi içinde dengeli).
 *
 * md34 deseni — komuta.ts `fetchChannelByCustomerType` ile aynı kaynak: eski
 * TBLMUSTERIGRUP (Müşteri Tipi) yerine TBLMUSTERIGRUPKIRILIM (Müşteri Grup
 * Kırılımı) kullanılır.
 */
type DiscountSegmentRawRow = Omit<DiscountSegmentRow, "iskontoOraniPct"> & { distId: number | null };

/**
 * Segment (müşteri grup kırılımı) × dist ham satırları — scope-free.
 * `f.LNGDISTKOD` GROUP BY'a eklendi (kırılım sayısı küçük ~6 × 31 dist ≈ 186
 * satır — ucuz).
 */
async function fetchDiscountBySegmentRaw(
  cities: string[] | null | undefined,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<DiscountSegmentRawRow[]> {
  const dateClause = dateRangeClause(
    "f.TRHISLEMTARIHI",
    dateFrom,
    dateTo,
    `f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()})`,
  );
  const sql = `
    WITH base AS (
      SELECT
        ISNULL(NULLIF(LTRIM(RTRIM(k.TXTAD)), ''), '(Tanımsız)') AS segment,
        f.LNGDISTKOD AS dist_id,
        f.LNGMUSTERIKOD AS musteri_id,
        f.DBLBRUTTUTAR     AS brut,
        f.DBLISKONTOTUTARI AS iskonto,
        f.DBLNETTUTAR      AS net
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      LEFT JOIN dbo.TBLMUSTERIGRUPKIRILIM k ON k.TXTKOD = m.TXTGRUPKIRILIMKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND m.BYTDURUM = 0
        AND ${dateClause}${cityFactClause(cities)}
    )
    SELECT
      segment,
      dist_id,
      ISNULL(SUM(brut), 0)     AS brut,
      ISNULL(SUM(iskonto), 0)  AS iskonto,
      ISNULL(SUM(net), 0)      AS net,
      COUNT(DISTINCT musteri_id) AS musteri_sayi,
      COUNT(*)                   AS fatura_sayi
    FROM base
    GROUP BY segment, dist_id
    ORDER BY SUM(brut) DESC
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 30_000 });
  return result.rows.map((r) => ({
    segment: String(r.segment ?? "(Tanımsız)"),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    brut: Number(r.brut ?? 0),
    iskonto: Number(r.iskonto ?? 0),
    net: Number(r.net ?? 0),
    musteriSayi: Number(r.musteri_sayi ?? 0),
    faturaSayisi: Number(r.fatura_sayi ?? 0),
  }));
}

/**
 * Müşteri Ek Grup (TBLMUSTERIEKGRUP: TEKEL/BÜFE/MARKET/BAR… — TBLMUSTERI.
 * TXTEKGRUPKOD "direct" link) × iskonto ham satırları — scope-free (dist_id
 * GROUP BY'da). `fetchDiscountBySegmentRaw` ile birebir aynı yapı; tek fark
 * boyut kaynağı: kırılım yerine ek grup. Ek grup boşsa "(Tanımsız)".
 */
async function fetchDiscountByEkGrupRaw(
  cities: string[] | null | undefined,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<DiscountSegmentRawRow[]> {
  const dateClause = dateRangeClause(
    "f.TRHISLEMTARIHI",
    dateFrom,
    dateTo,
    `f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()})`,
  );
  const sql = `
    WITH base AS (
      SELECT
        ISNULL(NULLIF(LTRIM(RTRIM(eg.TXTAD)), ''), '(Tanımsız)') AS segment,
        f.LNGDISTKOD AS dist_id,
        f.LNGMUSTERIKOD AS musteri_id,
        f.DBLBRUTTUTAR     AS brut,
        f.DBLISKONTOTUTARI AS iskonto,
        f.DBLNETTUTAR      AS net
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      LEFT JOIN dbo.TBLMUSTERIEKGRUP eg ON eg.TXTKOD = m.TXTEKGRUPKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND m.BYTDURUM = 0
        AND ${dateClause}${cityFactClause(cities)}
    )
    SELECT
      segment,
      dist_id,
      ISNULL(SUM(brut), 0)     AS brut,
      ISNULL(SUM(iskonto), 0)  AS iskonto,
      ISNULL(SUM(net), 0)      AS net,
      COUNT(DISTINCT musteri_id) AS musteri_sayi,
      COUNT(*)                   AS fatura_sayi
    FROM base
    GROUP BY segment, dist_id
    ORDER BY SUM(brut) DESC
  `;
  const result = await runReadOnly(sql, { limit: 4000, timeoutMs: 30_000 });
  return result.rows.map((r) => ({
    segment: String(r.segment ?? "(Tanımsız)"),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    brut: Number(r.brut ?? 0),
    iskonto: Number(r.iskonto ?? 0),
    net: Number(r.net ?? 0),
    musteriSayi: Number(r.musteri_sayi ?? 0),
    faturaSayisi: Number(r.fatura_sayi ?? 0),
  }));
}

/**
 * Aggregate edilmiş (brüt DESC sıralı) satırları ilk N'e indirir; kalanı tek
 * bir "Diğer" satırında toplar (brüt/iskonto/net/müşteri/fatura toplanır, oran
 * yeniden hesaplanır). Ek grup gibi kuyruk-uzun boyutlar için.
 */
function collapseToTopN(rows: DiscountSegmentRow[], n: number): DiscountSegmentRow[] {
  if (rows.length <= n) return rows;
  const head = rows.slice(0, n);
  const tail = rows.slice(n);
  const rest = tail.reduce(
    (acc, r) => {
      acc.brut += r.brut;
      acc.iskonto += r.iskonto;
      acc.net += r.net;
      acc.musteriSayi += r.musteriSayi;
      acc.faturaSayisi += r.faturaSayisi;
      return acc;
    },
    { brut: 0, iskonto: 0, net: 0, musteriSayi: 0, faturaSayisi: 0 },
  );
  head.push({
    segment: `Diğer (${tail.length})`,
    ...rest,
    iskontoOraniPct: rest.brut > 0 ? Number(((rest.iskonto / rest.brut) * 100).toFixed(2)) : 0,
  });
  return head;
}

/** dist-scope uygulanmış ham satırları segment bazında re-aggregate eder. */
function aggregateDiscountBySegment(rows: DiscountSegmentRawRow[]): DiscountSegmentRow[] {
  const bySegment = new Map<
    string,
    { segment: string; brut: number; iskonto: number; net: number; musteriSayi: number; faturaSayisi: number }
  >();
  for (const row of rows) {
    const existing = bySegment.get(row.segment);
    if (existing) {
      existing.brut += row.brut;
      existing.iskonto += row.iskonto;
      existing.net += row.net;
      existing.musteriSayi += row.musteriSayi;
      existing.faturaSayisi += row.faturaSayisi;
    } else {
      bySegment.set(row.segment, {
        segment: row.segment,
        brut: row.brut,
        iskonto: row.iskonto,
        net: row.net,
        musteriSayi: row.musteriSayi,
        faturaSayisi: row.faturaSayisi,
      });
    }
  }
  return [...bySegment.values()]
    .sort((a, b) => b.brut - a.brut)
    .map((s) => ({
      ...s,
      iskontoOraniPct: s.brut > 0 ? Number(((s.iskonto / s.brut) * 100).toFixed(2)) : 0,
    }));
}

// ---------- Public API ------------------------------------------------------

type RawIskontoBundle = {
  overall: DiscountOverallRawRow[];
  monthly: DiscountMonthlyRawRow[];
  brands: DiscountBrandRawRow[];
  topCustomers: DiscountTopCustomerRawRow[];
  segments: DiscountSegmentRawRow[];
  ekGrupSegments: DiscountSegmentRawRow[];
  generatedAt: string;
};

/**
 * Cache stratejisi: full dataset (tüm dist'ler) TEK cache anahtarı
 * (`${CACHE_VERSION}-30g-all`) altında çekilir — wietnauer-stok.ts'teki
 * `scopedRows` deseniyle aynı. Dist filtresi/scope + stratejik marka vurgusu
 * runtime'da JS'te uygulanır; `strategicBrands` artık cache key'e girmiyor.
 */
export async function getWietnauerIskontoSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    allowedDistKods?: number[] | null;
    distId?: number | null;
    /** Kullanıcının izinli şehirleri (null → kısıt yok). SQL'e semi-join
     * predikatı olarak uygulanır; cache key şehir kümesine göre ayrışır. */
    allowedCities?: string[] | null;
    /** Faz — tarih aralığı filtresi (YYYY-MM-DD). İkisi de verilmezse
     * fetcher'ların varsayılan pencereleri (son 30g / son 12 ay) kullanılır.
     * Kısmi (yalnız biri verilmiş) aralık yok sayılır. */
    dateFrom?: string | null;
    dateTo?: string | null;
  } = {},
): Promise<WietnauerIskontoSnapshot> {
  const strategicBrands = options.strategicBrands ?? [];
  const cities = options.allowedCities ?? null;
  const { dateFrom, dateTo } = normalizeDateRange(options.dateFrom, options.dateTo);
  const hasRange = dateFrom != null && dateTo != null;

  // Aralık yokken cache key eskisiyle birebir aynı kalır (mevcut cache
  // ısıtması bozulmaz); aralık verildiğinde ayrı bir key altına düşer.
  const cacheKey = hasRange
    ? `${CACHE_VERSION}-range-${cityCacheTag(cities)}-${dateFrom}_${dateTo}`
    : `${CACHE_VERSION}-30g-${cityCacheTag(cities)}`;
  const result = await withCache<RawIskontoBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      // 5 sorgu paralel — toplam latency = en yavaş sorgu
      const [overall, monthly, brands, topCustomers, segments, ekGrupSegments] = await Promise.all([
        fetchDiscountOverallRaw(cities, dateFrom, dateTo),
        fetchDiscountMonthlyTrendRaw(cities, dateFrom, dateTo),
        fetchDiscountByBrandRaw(cities, dateFrom, dateTo),
        fetchDiscountTopCustomersRaw(cities, dateFrom, dateTo),
        fetchDiscountBySegmentRaw(cities, dateFrom, dateTo),
        fetchDiscountByEkGrupRaw(cities, dateFrom, dateTo),
      ]);
      return {
        overall,
        monthly,
        brands,
        topCustomers,
        segments,
        ekGrupSegments,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const {
    overall: rawOverall,
    monthly: rawMonthly,
    brands: rawBrands,
    topCustomers: rawTopCustomers,
    segments: rawSegments,
    ekGrupSegments: rawEkGrupSegments,
    generatedAt,
  } = result.value;

  // Yetki kapsamı — dist kullanıcı için önce izinli dist'lere daralt.
  const effectiveDistKods =
    options.distId != null ? [options.distId] : (options.allowedDistKods ?? null);
  const inScope = (distId: number | null): boolean => {
    if (effectiveDistKods == null) return true; // merkez, filtresiz
    if (effectiveDistKods.length === 0) return false; // izinli dist yok
    return distId != null && effectiveDistKods.includes(distId);
  };

  const overall = aggregateDiscountOverall(rawOverall.filter((r) => inScope(r.distId)));
  const monthly = aggregateDiscountMonthlyTrend(rawMonthly.filter((r) => inScope(r.distId)));
  const brands = aggregateDiscountByBrand(
    rawBrands.filter((r) => inScope(r.distId)),
    strategicBrands,
  ).slice(0, 15);
  const topCustomers = aggregateDiscountTopCustomers(rawTopCustomers.filter((r) => inScope(r.distId)));
  const segments = aggregateDiscountBySegment(rawSegments.filter((r) => inScope(r.distId)));
  // Ek grup: aggregate → brüt DESC → ilk 5 + "Diğer".
  const ekGrupSegments = collapseToTopN(
    aggregateDiscountBySegment(rawEkGrupSegments.filter((r) => inScope(r.distId))),
    5,
  );

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    overall,
    monthly,
    brands,
    topCustomers,
    segments,
    ekGrupSegments,
  };
}
