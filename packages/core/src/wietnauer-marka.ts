/**
 * Wietnauer Dashboard #4 — Marka & SKU Performansı.
 *
 * Pernod'dan TERS yapı: Wietnauer'da `TBLURUNGRUP` = marka (JAGERMEISTER,
 * BELUGA, MACALLAN…), `TBLURUNEKGRUP` = kategori (VISKI, VODKA, CIN…).
 * Bu modül `tenant.brandTable` / `brandJoinColumn` soyutlamasını kullanır;
 * Pernod'da da aynı şema ile çalışır (sadece tablolar yer değiştirir).
 *
 * Sayfaya beslediği 5 panel:
 *   A) Brand Portfolio  — Top 20 marka × ciro × müşteri × pay%
 *   B) Top 10 SKU       — TBLURUN seviyesinde son 30g top SKU + markası
 *   C) Brand Penetration— Marka başına distinct müşteri / toplam aktif
 *   D) Strategic Zoom   — Stratejik markalar için 30g ciro + müşteri + Top 3 SKU
 *   E) 30g vs 90g vs YTD — Top 10 marka için 3 pencere + delta%
 *
 * Tüm fetcher'lar `Promise.all` ile paralel. Cache key: `${CACHE_VERSION}-all`
 * — TÜM dist'ler TEK cache anahtarıyla çekilir (scope-free), dist filtresi/
 * scope runtime'da JS'te uygulanır (wietnauer-stok.ts `scopedRows` deseni).
 * KAPALI PENCERE pattern her sorguda zorunlu (DEMO_DATE ötesi sızıntıyı önler).
 */
import { withCache } from "./cache.js";
import { sqlNow } from "./now.js";
import { runReadOnly } from "./db.js";
import { getTenantConfig } from "./tenant/index.js";
import { foldOther, sumBy } from "./fold-other.js";
import { cityFactClause, cityCacheTag } from "./auth.js";

const CACHE_DOMAIN = "wietnauer-marka";
// v3: cache-key scope fragmentation düzeltmesi (VYK-01) — dist filtresi
// SQL'den çıkarıldı; tüm fetcher'lar scope'suz (tüm dist) tek cache anahtarı
// altında çekilir, dist_id (`f.LNGDISTKOD`) SELECT/GROUP BY'a eklendi ki JS
// tarafı scope filtresi + re-aggregate yapabilsin. Cardinality doğrulandı:
// marka×dist ≈1700, SKU×dist ≈2000 satır (30g) — ucuz, wietnauer-stok.ts'teki
// ~6000 satırlık cardinality ile aynı mertebede.
const CACHE_VERSION = "v3";

// ---------- Tipler ----------------------------------------------------------

export type MarkaPortfolioRow = {
  marka: string;
  markaKod: string;
  ciro: number;
  musteriSayi: number;
  faturaSayisi: number;
  payPct: number;
  rank: number;
  isStratejik: boolean;
  /** "Diğer" katlanmış satır (Top-N dışı kalanların toplamı). */
  isOther?: boolean;
  /** Dip toplam satırı. */
  isTotal?: boolean;
};

export type TopSkuRow = {
  /** TBLURUN.LNGKOD */
  urunKod: number;
  /** TBLURUN.TXTAD — SKU adı */
  ad: string;
  /** Bağlı marka (brandTable.TXTAD) */
  marka: string;
  ciro: number;
  miktar: number;
  musteriSayi: number;
  payPct: number;
  rank: number;
  isStratejik: boolean;
  /** "Diğer" katlanmış satır (Top-N dışı kalanların toplamı). */
  isOther?: boolean;
  /** Dip toplam satırı. */
  isTotal?: boolean;
};

export type BrandPenetrationRow = {
  marka: string;
  markaKod: string;
  /** Bu markayı son 30g alan distinct müşteri */
  musteriSayi: number;
  /** Toplam aktif müşteri (son 30g fatura kesilen) */
  aktifMusteriToplam: number;
  /** musteriSayi / aktifMusteriToplam * 100 */
  penetrasyonPct: number;
  rank: number;
  isStratejik: boolean;
  /** "Diğer" katlanmış satır (Top-N dışı kalanların toplamı). */
  isOther?: boolean;
  /** Dip toplam / referans satırı (penetrasyon toplanamaz → aktif müşteri referansı). */
  isTotal?: boolean;
};

export type StratBrandTopSku = {
  urunKod: number;
  ad: string;
  ciro: number;
};

export type StrategicBrandDetail = {
  marka: string;
  markaKod: string;
  ciro: number;
  musteriSayi: number;
  faturaSayisi: number;
  /** Bu marka altında son 30g en çok ciro yapan 3 SKU */
  topSkus: StratBrandTopSku[];
  /** Marka portföyde tanımlı ama veri yoksa true — UI placeholder göster */
  hasData: boolean;
};

export type BrandWindowComparisonRow = {
  marka: string;
  markaKod: string;
  ciro30: number;
  ciro90: number;
  ciroYtd: number;
  /** 90g pencere içinde son 30g'in payı — ivme göstergesi */
  son30Pay90Pct: number;
  /** YTD içinde son 30g payı — ivme göstergesi */
  son30PayYtdPct: number;
  rank: number;
  isStratejik: boolean;
};

export type WietnauerMarkaSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  /** Tüm ciroların toplamı (son 30g) — pay% paydası kontrol için */
  toplamCiro30: number;
  /** Aktif müşteri (son 30g fatura kesilen distinct) — penetrasyon paydası */
  aktifMusteriToplam: number;
  portfolio: MarkaPortfolioRow[];
  topSkus: TopSkuRow[];
  penetration: BrandPenetrationRow[];
  strategic: StrategicBrandDetail[];
  windowComparison: BrandWindowComparisonRow[];
};

// ---------- Helpers ---------------------------------------------------------

/**
 * Tenant config'inden brandTable + joinColumn'u alıp doğrular. SQL string
 * interpolation'a girmeden önce hardcoded enum güvencesi.
 */
function getBrandTableMeta() {
  const tenant = getTenantConfig();
  const brandTable = tenant.brandTable;
  const joinCol = tenant.brandJoinColumn;
  if (!["TBLURUNEKGRUP", "TBLURUNGRUP"].includes(brandTable))
    throw new Error(`Geçersiz brandTable: ${brandTable}`);
  if (!["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"].includes(joinCol))
    throw new Error(`Geçersiz brandJoinColumn: ${joinCol}`);
  return { brandTable, joinCol };
}

function buildStratSet(strategicBrands: string[]): Set<string> {
  return new Set(strategicBrands.map((b) => b.toLocaleLowerCase("tr")));
}

// ---------- Fetcher'lar -----------------------------------------------------

type MarkaPortfolioRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro: number;
  musteriSayi: number;
  faturaSayisi: number;
};

/**
 * Tüm markalar × dist — son 30g ciro × distinct müşteri × distinct fatura.
 * Scope-free: `TOP 20` kaldırıldı, `f.LNGDISTKOD` GROUP BY'a eklendi
 * (55 marka × 31 dist ≈ 1700 satır — ucuz). Top 20 + pay% scope SONRASI
 * public API'de hesaplanır.
 */
async function fetchBrandPortfolioRaw(cities?: string[] | null): Promise<MarkaPortfolioRawRow[]> {
  const { brandTable, joinCol } = getBrandTableMeta();
  const sql = `
    SELECT
      b.TXTKOD AS marka_kod,
      b.TXTAD AS marka,
      f.LNGDISTKOD AS dist_id,
      SUM(d.DBLNETFIYAT) AS ciro,
      COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri_sayi,
      COUNT(DISTINCT CAST(f.LNGYIL AS VARCHAR) + '-' + CAST(f.LNGBELGEKOD AS VARCHAR) + '-' + CAST(f.LNGDISTKOD AS VARCHAR)) AS fatura_sayi
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
    INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    GROUP BY b.TXTKOD, b.TXTAD, f.LNGDISTKOD
    ORDER BY SUM(d.DBLNETFIYAT) DESC
  `;
  const result = await runReadOnly(sql, { limit: 3000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    markaKod: String(r.marka_kod ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    ciro: Number(r.ciro ?? 0),
    musteriSayi: Number(r.musteri_sayi ?? 0),
    faturaSayisi: Number(r.fatura_sayi ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları marka bazında re-aggregate eder + pay%/rank hesaplar. */
function aggregateBrandPortfolio(
  rows: MarkaPortfolioRawRow[],
  stratSet: Set<string>,
): { rows: MarkaPortfolioRow[]; toplamCiro: number } {
  const byMarka = new Map<
    string,
    { marka: string; markaKod: string; ciro: number; musteriSayi: number; faturaSayisi: number }
  >();
  for (const row of rows) {
    const existing = byMarka.get(row.markaKod);
    if (existing) {
      existing.ciro += row.ciro;
      existing.musteriSayi += row.musteriSayi;
      existing.faturaSayisi += row.faturaSayisi;
    } else {
      byMarka.set(row.markaKod, {
        marka: row.marka,
        markaKod: row.markaKod,
        ciro: row.ciro,
        musteriSayi: row.musteriSayi,
        faturaSayisi: row.faturaSayisi,
      });
    }
  }
  type MarkaAgg = {
    marka: string;
    markaKod: string;
    ciro: number;
    musteriSayi: number;
    faturaSayisi: number;
  };
  const all = [...byMarka.values()];
  const toplamCiro = all.reduce((a, b) => a + b.ciro, 0);
  const sorted = all.sort((a, b) => b.ciro - a.ciro);

  // Top 15 marka + "Diğer" (kalanların toplamı). Dip toplam ayrıca eklenir.
  const { rows: folded } = foldOther<MarkaAgg>(sorted, {
    keep: 15,
    other: (rest) => ({
      marka: "Diğer",
      markaKod: "__other__",
      ciro: sumBy(rest, (r) => r.ciro),
      musteriSayi: sumBy(rest, (r) => r.musteriSayi),
      faturaSayisi: sumBy(rest, (r) => r.faturaSayisi),
    }),
  });

  const out: MarkaPortfolioRow[] = folded.map((m, i) => {
    const isOther = m.markaKod === "__other__";
    const row: MarkaPortfolioRow = {
      marka: m.marka,
      markaKod: m.markaKod,
      ciro: m.ciro,
      musteriSayi: m.musteriSayi,
      faturaSayisi: m.faturaSayisi,
      payPct: toplamCiro > 0 ? Number(((m.ciro / toplamCiro) * 100).toFixed(2)) : 0,
      rank: isOther ? 0 : i + 1,
      isStratejik: isOther ? false : stratSet.has(m.marka.toLocaleLowerCase("tr")),
    };
    if (isOther) row.isOther = true;
    return row;
  });

  // Dip toplam satırı
  out.push({
    marka: "Toplam",
    markaKod: "__total__",
    ciro: toplamCiro,
    musteriSayi: sumBy(all, (r) => r.musteriSayi),
    faturaSayisi: sumBy(all, (r) => r.faturaSayisi),
    payPct: 100,
    rank: 0,
    isStratejik: false,
    isTotal: true,
  });

  return { rows: out, toplamCiro };
}

/**
 * Top 10 SKU — son 30g'de en çok ciro yapan ürünler (TBLURUN seviyesi).
 * Her satıra ait marka adı da gösterilir.
 */
type TopSkuRawRow = {
  urunKod: number;
  ad: string;
  marka: string;
  distId: number | null;
  ciro: number;
  miktar: number;
  musteriSayi: number;
};

/**
 * SKU × dist — son 30g. Scope-free: `TOP N` kaldırıldı, `f.LNGDISTKOD`
 * GROUP BY'a eklendi (~202 SKU × 21 dist ≈ 2000 satır — ölçüldü, ucuz).
 * Top-N + pay% scope SONRASI public API'de hesaplanır.
 */
async function fetchTopSkusRaw(cities?: string[] | null): Promise<TopSkuRawRow[]> {
  const { brandTable, joinCol } = getBrandTableMeta();
  const sql = `
    SELECT
      u.LNGKOD AS urun_kod,
      u.TXTAD AS ad,
      b.TXTAD AS marka,
      f.LNGDISTKOD AS dist_id,
      SUM(d.DBLNETFIYAT) AS ciro,
      SUM(d.DBLMIKTAR) AS miktar,
      COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri_sayi
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
    INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    GROUP BY u.LNGKOD, u.TXTAD, b.TXTAD, f.LNGDISTKOD
    ORDER BY SUM(d.DBLNETFIYAT) DESC
  `;
  const result = await runReadOnly(sql, { limit: 5000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    urunKod: Number(r.urun_kod),
    ad: String(r.ad ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    ciro: Number(r.ciro ?? 0),
    miktar: Number(r.miktar ?? 0),
    musteriSayi: Number(r.musteri_sayi ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları SKU bazında re-aggregate eder + pay%/rank hesaplar. */
function aggregateTopSkus(
  rows: TopSkuRawRow[],
  stratSet: Set<string>,
  toplamCiro30: number,
  limit = 10,
): TopSkuRow[] {
  const byUrun = new Map<
    number,
    { urunKod: number; ad: string; marka: string; ciro: number; miktar: number; musteriSayi: number }
  >();
  for (const row of rows) {
    const existing = byUrun.get(row.urunKod);
    if (existing) {
      existing.ciro += row.ciro;
      existing.miktar += row.miktar;
      existing.musteriSayi += row.musteriSayi;
    } else {
      byUrun.set(row.urunKod, {
        urunKod: row.urunKod,
        ad: row.ad,
        marka: row.marka,
        ciro: row.ciro,
        miktar: row.miktar,
        musteriSayi: row.musteriSayi,
      });
    }
  }
  type SkuAgg = {
    urunKod: number;
    ad: string;
    marka: string;
    ciro: number;
    miktar: number;
    musteriSayi: number;
  };
  const all = [...byUrun.values()];
  const sorted = all.sort((a, b) => b.ciro - a.ciro);

  // Top-N SKU + "Diğer" (kalanların toplamı). Dip toplam ayrıca eklenir.
  const { rows: folded } = foldOther<SkuAgg>(sorted, {
    keep: limit,
    other: (rest) => ({
      urunKod: 0,
      ad: "Diğer",
      marka: "",
      ciro: sumBy(rest, (r) => r.ciro),
      miktar: sumBy(rest, (r) => r.miktar),
      musteriSayi: sumBy(rest, (r) => r.musteriSayi),
    }),
  });

  const out: TopSkuRow[] = folded.map((r, i) => {
    const isOther = r.urunKod === 0 && r.ad === "Diğer";
    const row: TopSkuRow = {
      urunKod: r.urunKod,
      ad: r.ad,
      marka: r.marka,
      ciro: r.ciro,
      miktar: r.miktar,
      musteriSayi: r.musteriSayi,
      payPct: toplamCiro30 > 0 ? (r.ciro / toplamCiro30) * 100 : 0,
      rank: isOther ? 0 : i + 1,
      isStratejik: isOther ? false : stratSet.has(r.marka.toLocaleLowerCase("tr")),
    };
    if (isOther) row.isOther = true;
    return row;
  });

  // Dip toplam satırı — tüm SKU'ların toplamı
  const toplamCiro = sumBy(all, (r) => r.ciro);
  out.push({
    urunKod: -1,
    ad: "Toplam",
    marka: "",
    ciro: toplamCiro,
    miktar: sumBy(all, (r) => r.miktar),
    musteriSayi: sumBy(all, (r) => r.musteriSayi),
    payPct: toplamCiro30 > 0 ? (toplamCiro / toplamCiro30) * 100 : 0,
    rank: 0,
    isStratejik: false,
    isTotal: true,
  });

  return out;
}

/**
 * Marka penetrasyonu — son 30g her marka için distinct müşteri / toplam aktif
 * müşteri (son 30g fatura kesilen). En geniş portföye sahip markalar görselde
 * baskın çıkmasın diye absolute count yerine % gösterilir.
 */
type BrandPenetrationRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  musteriSayi: number;
};

type AktifToplamRawRow = { distId: number | null; toplam: number };

/**
 * Marka × dist müşteri sayısı ham satırları — scope-free (`TOP 20` kaldırıldı,
 * `f.LNGDISTKOD` GROUP BY'a eklendi, ~1700 satır). `musteri_sayi` dist bazında
 * COUNT DISTINCT olduğundan scope sonrası SUM ile doğru toplanır.
 */
async function fetchBrandPenetrationRaw(cities?: string[] | null): Promise<BrandPenetrationRawRow[]> {
  const { brandTable, joinCol } = getBrandTableMeta();
  const sql = `
    SELECT
      b.TXTKOD AS marka_kod,
      b.TXTAD AS marka,
      f.LNGDISTKOD AS dist_id,
      COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri_sayi
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
    INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    GROUP BY b.TXTKOD, b.TXTAD, f.LNGDISTKOD
    ORDER BY COUNT(DISTINCT f.LNGMUSTERIKOD) DESC
  `;
  const result = await runReadOnly(sql, { limit: 3000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    markaKod: String(r.marka_kod ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    musteriSayi: Number(r.musteri_sayi ?? 0),
  }));
}

/**
 * Aktif müşteri toplamı (penetrasyon paydası) — dist bazında (~31 satır).
 * Scope sonrası SUM ile doğru toplanır.
 */
async function fetchAktifMusteriToplamRaw(cities?: string[] | null): Promise<AktifToplamRawRow[]> {
  const sql = `
    SELECT
      LNGDISTKOD AS dist_id,
      COUNT(DISTINCT LNGMUSTERIKOD) AS toplam
    FROM dbo.TBLMSDFATURA
    WHERE BYTTUR = 0 AND BYTDURUM = 0
      AND TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities, "LNGMUSTERIKOD")}
    GROUP BY LNGDISTKOD
  `;
  const result = await runReadOnly(sql, { limit: 200 });
  return result.rows.map((r) => ({
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    toplam: Number(r.toplam ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları marka bazında re-aggregate eder + penetrasyon% hesaplar. */
function aggregateBrandPenetration(
  rows: BrandPenetrationRawRow[],
  aktifToplamRows: AktifToplamRawRow[],
  stratSet: Set<string>,
): { rows: BrandPenetrationRow[]; aktifMusteriToplam: number } {
  const aktifMusteriToplam = aktifToplamRows.reduce((a, r) => a + r.toplam, 0);
  const byMarka = new Map<string, { marka: string; markaKod: string; musteriSayi: number }>();
  for (const row of rows) {
    const existing = byMarka.get(row.markaKod);
    if (existing) {
      existing.musteriSayi += row.musteriSayi;
    } else {
      byMarka.set(row.markaKod, { marka: row.marka, markaKod: row.markaKod, musteriSayi: row.musteriSayi });
    }
  }
  type PenAgg = { marka: string; markaKod: string; musteriSayi: number };
  const sorted = [...byMarka.values()].sort((a, b) => b.musteriSayi - a.musteriSayi);

  // Top 15 marka + "Diğer" (kalanların distinct müşteri toplamı).
  const { rows: folded } = foldOther<PenAgg>(sorted, {
    keep: 15,
    other: (rest) => ({
      marka: "Diğer",
      markaKod: "__other__",
      musteriSayi: sumBy(rest, (r) => r.musteriSayi),
    }),
  });

  const out: BrandPenetrationRow[] = folded.map((m, i) => {
    const isOther = m.markaKod === "__other__";
    const row: BrandPenetrationRow = {
      marka: m.marka,
      markaKod: m.markaKod,
      musteriSayi: m.musteriSayi,
      aktifMusteriToplam,
      penetrasyonPct:
        aktifMusteriToplam > 0
          ? Number(((m.musteriSayi * 100) / aktifMusteriToplam).toFixed(2))
          : 0,
      rank: isOther ? 0 : i + 1,
      isStratejik: isOther ? false : stratSet.has(m.marka.toLocaleLowerCase("tr")),
    };
    if (isOther) row.isOther = true;
    return row;
  });

  // Penetrasyon toplanabilir DEĞİL → dip toplam yerine referans "toplam aktif müşteri".
  out.push({
    marka: "Toplam",
    markaKod: "__total__",
    musteriSayi: aktifMusteriToplam,
    aktifMusteriToplam,
    penetrasyonPct: 100,
    rank: 0,
    isStratejik: false,
    isTotal: true,
  });

  return { rows: out, aktifMusteriToplam };
}

/**
 * Stratejik marka detayı — config'teki her marka için son 30g özet + Top 3
 * SKU. `strategicBrands` boşsa boş dizi döner (genel marka portföyü zaten
 * portfolio fetcher'ında).
 *
 * Strateji: tek round-trip — config'teki marka adlarını parametre olarak SQL'e
 * geçirip server-side filtreleme. CROSS APPLY ile her marka için Top 3 SKU
 * çekilir.
 */
type StrategicBrandDetailRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro: number;
  musteriSayi: number;
  faturaSayisi: number;
  urunKod: number | null;
  skuAd: string | null;
  skuCiro: number | null;
};

/**
 * Stratejik marka × dist × SKU ham satırları — scope-free. `OUTER APPLY TOP 3`
 * kaldırıldı (dist scope uygulanmadan Top 3 kesilirse dist kullanıcının kendi
 * SKU'ları listeden düşebilir); `f.LNGDISTKOD` GROUP BY'a eklendi. Top 3 SKU
 * seçimi + rank scope SONRASI JS'te yapılır (bkz. `aggregateStrategicBrandsDetail`).
 * `strategicBrands` tenant config'ten gelir (küçük, sabit liste — request'e
 * göre değişmez), bu yüzden cache key'e girmesi gerekmiyor artık; ama SQL
 * `IN` filtresi olarak korunuyor (marka×dist zaten küçük, filtre performans
 * için gerekli değil ama sorguyu odaklı tutuyor).
 */
async function fetchStrategicBrandsDetailRaw(
  strategicBrands: string[],
  cities?: string[] | null,
): Promise<StrategicBrandDetailRawRow[]> {
  if (strategicBrands.length === 0) return [];
  const { brandTable, joinCol } = getBrandTableMeta();

  // SQL parametresi — `IN` listesi (case-insensitive eşleşme, COLLATE'siz
  // çalışsın diye UPPER ile normalleştir).
  const inList = strategicBrands
    .map((b) => `'${b.replace(/'/g, "''").toUpperCase()}'`)
    .join(",");

  const sql = `
    WITH marka_ozet AS (
      SELECT
        b.TXTKOD AS marka_kod,
        b.TXTAD AS marka,
        f.LNGDISTKOD AS dist_id,
        SUM(d.DBLNETFIYAT) AS ciro,
        COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri_sayi,
        COUNT(DISTINCT CAST(f.LNGYIL AS VARCHAR) + '-' + CAST(f.LNGBELGEKOD AS VARCHAR) + '-' + CAST(f.LNGDISTKOD AS VARCHAR)) AS fatura_sayi
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        AND UPPER(b.TXTAD) IN (${inList})${cityFactClause(cities)}
      GROUP BY b.TXTKOD, b.TXTAD, f.LNGDISTKOD
    ),
    sku_ozet AS (
      SELECT
        u.${joinCol} AS marka_kod,
        f.LNGDISTKOD AS dist_id,
        u.LNGKOD AS urun_kod,
        u.TXTAD AS ad,
        SUM(d.DBLNETFIYAT) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND u.${joinCol} IN (SELECT DISTINCT marka_kod FROM marka_ozet)
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
      GROUP BY u.${joinCol}, f.LNGDISTKOD, u.LNGKOD, u.TXTAD
    )
    SELECT
      mo.marka_kod,
      mo.marka,
      mo.dist_id,
      mo.ciro,
      mo.musteri_sayi,
      mo.fatura_sayi,
      sku.urun_kod,
      sku.ad AS sku_ad,
      sku.ciro AS sku_ciro
    FROM marka_ozet mo
    LEFT JOIN sku_ozet sku ON sku.marka_kod = mo.marka_kod AND sku.dist_id = mo.dist_id
    ORDER BY mo.ciro DESC, mo.marka
  `;
  // Marka(<20 tipik) × dist(~31) × SKU per marka(değişken ama marka başına
  // sınırlı) — küçük, ucuz.
  const result = await runReadOnly(sql, { limit: 5000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    markaKod: String(r.marka_kod ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    ciro: Number(r.ciro ?? 0),
    musteriSayi: Number(r.musteri_sayi ?? 0),
    faturaSayisi: Number(r.fatura_sayi ?? 0),
    urunKod: r.urun_kod != null ? Number(r.urun_kod) : null,
    skuAd: r.sku_ad != null ? String(r.sku_ad) : null,
    skuCiro: r.sku_ciro != null ? Number(r.sku_ciro) : null,
  }));
}

/**
 * dist-scope uygulanmış ham satırları marka bazında re-aggregate eder + Top 3
 * SKU seçer. ÖNKOŞUL: `rows` çağıran tarafta ZATEN scope'a göre filtrelenmiş
 * olmalı (bkz. public API) — bu fonksiyon filtreleme yapmaz, yalnızca toplar.
 *
 * marka_ozet satırları (ciro/musteriSayi/faturaSayisi) dist × SKU LEFT JOIN'i
 * nedeniyle SKU sayısı kadar tekrar eder; bu yüzden dist_id bazında
 * tekilleştirip SONRA topluyoruz (aksi halde ciro N kat şişer).
 */
function aggregateStrategicBrandsDetail(
  rows: StrategicBrandDetailRawRow[],
  strategicBrands: string[],
): StrategicBrandDetail[] {
  type MarkaAgg = {
    marka: string;
    markaKod: string;
    distTotals: Map<number | null, { ciro: number; musteriSayi: number; faturaSayisi: number }>;
    skus: Map<number, { urunKod: number; ad: string; ciro: number }>;
  };
  const byMarka = new Map<string, MarkaAgg>();
  for (const row of rows) {
    if (!row.markaKod) continue;
    let agg = byMarka.get(row.markaKod);
    if (!agg) {
      agg = { marka: row.marka, markaKod: row.markaKod, distTotals: new Map(), skus: new Map() };
      byMarka.set(row.markaKod, agg);
    }
    if (!agg.distTotals.has(row.distId)) {
      agg.distTotals.set(row.distId, {
        ciro: row.ciro,
        musteriSayi: row.musteriSayi,
        faturaSayisi: row.faturaSayisi,
      });
    }
    if (row.urunKod != null) {
      const existing = agg.skus.get(row.urunKod);
      if (existing) {
        existing.ciro += row.skuCiro ?? 0;
      } else {
        agg.skus.set(row.urunKod, { urunKod: row.urunKod, ad: row.skuAd ?? "", ciro: row.skuCiro ?? 0 });
      }
    }
  }

  const found = new Map<string, StrategicBrandDetail>();
  for (const agg of byMarka.values()) {
    const totals = [...agg.distTotals.values()].reduce(
      (acc, d) => ({
        ciro: acc.ciro + d.ciro,
        musteriSayi: acc.musteriSayi + d.musteriSayi,
        faturaSayisi: acc.faturaSayisi + d.faturaSayisi,
      }),
      { ciro: 0, musteriSayi: 0, faturaSayisi: 0 },
    );
    const topSkus = [...agg.skus.values()]
      .sort((a, b) => b.ciro - a.ciro)
      .slice(0, 3)
      .map((s) => ({ urunKod: s.urunKod, ad: s.ad, ciro: s.ciro }));
    found.set(agg.marka.toLocaleLowerCase("tr"), {
      marka: agg.marka,
      markaKod: agg.markaKod,
      ciro: totals.ciro,
      musteriSayi: totals.musteriSayi,
      faturaSayisi: totals.faturaSayisi,
      topSkus,
      hasData: true,
    });
  }

  // Config sırasını koru + veri yoksa placeholder ekle
  return strategicBrands.map((name) => {
    const key = name.toLocaleLowerCase("tr");
    const hit = found.get(key);
    if (hit) return hit;
    return {
      marka: name,
      markaKod: "",
      ciro: 0,
      musteriSayi: 0,
      faturaSayisi: 0,
      topSkus: [],
      hasData: false,
    };
  });
}

/**
 * 30g vs 90g vs YTD karşılaştırma — top 10 marka için 3 pencere ciro.
 * "Son 30g'in 90g içindeki payı" = ivme metriği (>%33 ise hızlanıyor).
 */
type BrandWindowRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro30: number;
  ciro90: number;
  ciroYtd: number;
};

/**
 * Marka × dist × 3 pencere (30g/90g/YTD) ham satırları — scope-free.
 * `TOP 10` kaldırıldı, `f.LNGDISTKOD` GROUP BY'a eklendi (~1700 satır).
 * Top 10 + ivme% scope SONRASI public API'de hesaplanır.
 */
async function fetchBrand3MonthYtdRaw(cities?: string[] | null): Promise<BrandWindowRawRow[]> {
  const { brandTable, joinCol } = getBrandTableMeta();
  // YTD: yılın başından `sqlNow()`ya kadar. Tek pass'te 3 pencereyi SUM CASE
  // ile çekiyoruz — round-trip tek.
  const sql = `
    SELECT
      b.TXTKOD AS marka_kod,
      b.TXTAD AS marka,
      f.LNGDISTKOD AS dist_id,
      SUM(CASE
        WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
         AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        THEN d.DBLNETFIYAT ELSE 0 END) AS ciro_30,
      SUM(CASE
        WHEN f.TRHISLEMTARIHI >= DATEADD(day, -90, ${sqlNow()})
         AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        THEN d.DBLNETFIYAT ELSE 0 END) AS ciro_90,
      SUM(CASE
        WHEN f.TRHISLEMTARIHI >= DATEFROMPARTS(YEAR(${sqlNow()}), 1, 1)
         AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        THEN d.DBLNETFIYAT ELSE 0 END) AS ciro_ytd
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
    INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEFROMPARTS(YEAR(${sqlNow()}), 1, 1)
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    GROUP BY b.TXTKOD, b.TXTAD, f.LNGDISTKOD
  `;
  const result = await runReadOnly(sql, { limit: 3000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    markaKod: String(r.marka_kod ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    ciro30: Number(r.ciro_30 ?? 0),
    ciro90: Number(r.ciro_90 ?? 0),
    ciroYtd: Number(r.ciro_ytd ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları marka bazında re-aggregate eder + ivme%/rank hesaplar. */
function aggregateBrand3MonthYtd(
  rows: BrandWindowRawRow[],
  stratSet: Set<string>,
): BrandWindowComparisonRow[] {
  const byMarka = new Map<
    string,
    { marka: string; markaKod: string; ciro30: number; ciro90: number; ciroYtd: number }
  >();
  for (const row of rows) {
    const existing = byMarka.get(row.markaKod);
    if (existing) {
      existing.ciro30 += row.ciro30;
      existing.ciro90 += row.ciro90;
      existing.ciroYtd += row.ciroYtd;
    } else {
      byMarka.set(row.markaKod, {
        marka: row.marka,
        markaKod: row.markaKod,
        ciro30: row.ciro30,
        ciro90: row.ciro90,
        ciroYtd: row.ciroYtd,
      });
    }
  }
  return [...byMarka.values()]
    .sort((a, b) => b.ciro30 - a.ciro30)
    .slice(0, 10)
    .map((m, i) => ({
      marka: m.marka,
      markaKod: m.markaKod,
      ciro30: m.ciro30,
      ciro90: m.ciro90,
      ciroYtd: m.ciroYtd,
      son30Pay90Pct: m.ciro90 > 0 ? (m.ciro30 / m.ciro90) * 100 : 0,
      son30PayYtdPct: m.ciroYtd > 0 ? (m.ciro30 / m.ciroYtd) * 100 : 0,
      rank: i + 1,
      isStratejik: stratSet.has(m.marka.toLocaleLowerCase("tr")),
    }));
}

// ---------- Public API ------------------------------------------------------

/**
 * Dashboard #4 snapshot. 5 fetcher paralel — toplam latency max(her sorgu).
 *
 * Cache key: `v1-<stratHash>` — stratejik marka listesi değişirse otomatik
 * invalidate. `forceRefresh: true` saha aktif saatlerinde MSSQL'i zorlar,
 * dikkatli kullan.
 */
type RawMarkaBundle = {
  portfolio: MarkaPortfolioRawRow[];
  topSkus: TopSkuRawRow[];
  penetration: BrandPenetrationRawRow[];
  aktifToplam: AktifToplamRawRow[];
  strategic: StrategicBrandDetailRawRow[];
  windowComparison: BrandWindowRawRow[];
  generatedAt: string;
};

/**
 * Dashboard #4 snapshot. Cache stratejisi: full dataset (tüm dist'ler) TEK
 * cache anahtarı (`${CACHE_VERSION}-<stratKey>-all`) altında çekilir —
 * wietnauer-stok.ts'teki `scopedRows` deseniyle aynı. Dist filtresi/scope
 * runtime'da JS'te uygulanır; pay%/rank/Top-N hesaplamaları scope SONRASI
 * yapılır. `strategicBrands` hâlâ cache key'e giriyor çünkü
 * `fetchStrategicBrandsDetailRaw` SQL `IN` filtresi olarak kullanıyor
 * (tenant config'ten gelir, request'e göre değişmez — pratikte tek değer).
 */
export async function getWietnauerMarkaSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    allowedDistKods?: number[] | null;
    distId?: number | null;
    /** Kullanıcının izinli şehirleri (null → kısıt yok). SQL'e semi-join
     * predikatı olarak uygulanır; cache key şehir kümesine göre ayrışır. */
    allowedCities?: string[] | null;
  } = {},
): Promise<WietnauerMarkaSnapshot> {
  const strategicBrands = options.strategicBrands ?? [];
  const cities = options.allowedCities ?? null;
  const stratKey = strategicBrands
    .map((b) => b.toLocaleLowerCase("tr"))
    .sort()
    .join("|");

  const cacheKey = `${CACHE_VERSION}-${stratKey || "none"}-${cityCacheTag(cities)}`;
  const result = await withCache<RawMarkaBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      const [portfolio, topSkus, penetration, aktifToplam, strategic, windowComparison] =
        await Promise.all([
          fetchBrandPortfolioRaw(cities),
          fetchTopSkusRaw(cities),
          fetchBrandPenetrationRaw(cities),
          fetchAktifMusteriToplamRaw(cities),
          fetchStrategicBrandsDetailRaw(strategicBrands, cities),
          fetchBrand3MonthYtdRaw(cities),
        ]);
      return {
        portfolio,
        topSkus,
        penetration,
        aktifToplam,
        strategic,
        windowComparison,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const {
    portfolio: rawPortfolio,
    topSkus: rawTopSkus,
    penetration: rawPenetration,
    aktifToplam: rawAktifToplam,
    strategic: rawStrategic,
    windowComparison: rawWindowComparison,
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

  const stratSet = buildStratSet(strategicBrands);

  const scopedPortfolio = rawPortfolio.filter((r) => inScope(r.distId));
  const scopedTopSkus = rawTopSkus.filter((r) => inScope(r.distId));
  const scopedPenetration = rawPenetration.filter((r) => inScope(r.distId));
  const scopedAktifToplam = rawAktifToplam.filter((r) => inScope(r.distId));
  const scopedStrategic = rawStrategic.filter((r) => inScope(r.distId));
  const scopedWindowComparison = rawWindowComparison.filter((r) => inScope(r.distId));

  const { rows: portfolio, toplamCiro: toplamCiro30 } = aggregateBrandPortfolio(scopedPortfolio, stratSet);
  const topSkus = aggregateTopSkus(scopedTopSkus, stratSet, toplamCiro30, 10);
  const { rows: penetration, aktifMusteriToplam } = aggregateBrandPenetration(
    scopedPenetration,
    scopedAktifToplam,
    stratSet,
  );
  const strategic = aggregateStrategicBrandsDetail(scopedStrategic, strategicBrands);
  const windowComparison = aggregateBrand3MonthYtd(scopedWindowComparison, stratSet);

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    toplamCiro30,
    aktifMusteriToplam,
    portfolio,
    topSkus,
    penetration,
    strategic,
    windowComparison,
  };
}
