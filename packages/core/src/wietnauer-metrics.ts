/**
 * Wietnauer dashboards için ek metrikler — Yönetim Kurulu (#1) seviyesi.
 *
 * Bu modül mevcut Komuta snapshot'ı genişletmek yerine bağımsız fetcher'lar
 * tutar. Komuta endpoint'i bunları opsiyonel olarak da çağırabilir; Wietnauer-
 * özel sayfalar (V2 dashboards) doğrudan kullanır.
 *
 * Cache stratejisi: her metrik kendi `cache_entries` satırı, `withCache`
 * üzerinden. Faz A için tek key: "v1-30g".
 */
import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";
import { withCache } from "./cache.js";
import { getTenantConfig } from "./tenant/index.js";
import { cityFactClause, cityColClause, cityCacheTag } from "./auth.js";

const CACHE_DOMAIN = "wietnauer";
// v3: 30g pencerede ÜST SINIR eksikti — Wietnauer DB'de DEMO_DATE'in ötesine
// kayıt olduğu için mayıs/haziran satışları sızıyordu. Düzeltildi:
// `BETWEEN DATEADD(-30) AND sqlNow()` ile sınırlandı.
// v6: cache-key scope fragmentation düzeltmesi (VYK-01) — dist filtresi
// SQL'den çıkarıldı. fetchTopCustomers artık `TOP 50` yerine TÜM aktif
// müşterileri (satır-seviyesi, ~8-9K, wietnauer-stok.ts'teki cardinality ile
// aynı mertebede) çeker; dist_id çıktıya eklendi. fetchBrands (marka-level
// GROUP BY, dist kırılımı satır patlaması riskli — bkz. fonksiyon notu) ve
// fetchDiscountKpi (tek satır aggregate) SCOPE'LU KALDI — bu ikisi hâlâ
// `distClause` ile MSSQL'e sorgu gönderiyor; nightRefresh yalnız merkez'i
// ısıttığı için bu iki fetcher'ın soğuk-cache maliyeti hâlâ mevcut (bkz. not).
// v7: md22/md23 — fetchTopCustomers → fetchTopDistributors (bundle shape
// değişti: topCustomers → topDistributors). Eski v6 cache'i geçersiz.
const CACHE_VERSION = "v7";

// ---------- Tipler ----------------------------------------------------------

export type TopDistributor = {
  /** TBLDIST.LNGKOD */
  id: number;
  /** TBLDIST.TXTAD — distribütör adı */
  ad: string;
  /** TBLDISTEKGRUP.TXTAD — bölge */
  bolge: string | null;
  /** Son 30g net ciro */
  ciro: number;
  /** Son 30g fatura sayısı */
  faturaSayisi: number;
  /** md23: dist'in portföyündeki aktif müşteri sayısı (TBLMUSTERI BYTDURUM=0) */
  aktifMusteriSayi: number;
  /** md23: FKMS — son 30g fatura kesilen distinct müşteri sayısı */
  fkms: number;
  /** md23: FKMS / aktif müşteri — 30g portföy kapsama oranı (%) */
  kapsamPct: number;
  /** Toplam ciro içindeki pay (%) */
  payPct: number;
  rank: number;
};

export type BrandContribution = {
  /** TBLURUNEKGRUP.TXTAD — "Chivas Regal", "Ballantine's" */
  marka: string;
  /** TBLURUNEKGRUP.TXTKOD — B-prefix */
  markaKod: string;
  /** Son 30g ciro (detay satır net) */
  ciro: number;
  /** Bu markayı alan distinct müşteri sayısı */
  musteriSayi: number;
  /** Toplam ciro içindeki pay (%) */
  payPct: number;
  rank: number;
  /** Stratejik marka mı? Tenant config'inden işaretlenir. */
  isStratejik: boolean;
};

export type DiscountKpi = {
  brut: number;
  iskonto: number;
  net: number;
  /** İskonto / brüt oranı (%) — en yaygın kullanılan metrik */
  iskontoOraniPct: number;
  /** Son 30g toplam fatura sayısı (gerçek portföy, top-N değil) */
  faturaCount: number;
  /** Son 30g distinct müşteri sayısı (gerçek aktif portföy) */
  aktifMusteriCount: number;
};

export type WietnauerYonetimSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  topDistributors: TopDistributor[]; // md22: ~31 dist, ciro DESC
  brands: BrandContribution[];
  discount: DiscountKpi;
};

// ---------- Fetcher'lar -----------------------------------------------------

type TopDistributorRawRow = Omit<TopDistributor, "rank" | "payPct" | "kapsamPct">;

/**
 * md22/md23 — Top Distribütör analizi (Top Müşteri analizinin yerini aldı).
 *
 * İki sorgu paralel, JS'te birleştirilir:
 *   1) Fatura agregasyonu (dist bazında son 30g ciro, fatura, FKMS)
 *      — FKMS = COUNT(DISTINCT müşteri) fatura kesen (md23).
 *   2) Portföy aktif müşteri sayısı (dist bazında, TBLMUSTERI BYTDURUM=0)
 *      — kapsam paydası (md23); fatura tabanından bağımsız grain, ayrı sorgu.
 *
 * Scope-free: tüm dist'ler döner (~31 satır), dist scope + payPct runtime'da
 * JS'te uygulanır (fetchTopCustomers deseniyle aynı). kapsamPct = FKMS/aktif.
 */
async function fetchTopDistributors(
  cities?: string[] | null,
): Promise<TopDistributorRawRow[]> {
  const salesSql = `
    SELECT
      f.LNGDISTKOD AS id,
      dst.TXTAD AS ad,
      dg.TXTAD AS bolge,
      SUM(f.DBLNETTUTAR) AS ciro,
      COUNT(*) AS fatura,
      COUNT(DISTINCT f.LNGMUSTERIKOD) AS fkms
    FROM dbo.TBLMSDFATURA AS f
    LEFT JOIN dbo.TBLDIST dst ON dst.LNGKOD = f.LNGDISTKOD
    LEFT JOIN dbo.TBLDISTEKGRUP dg ON dg.TXTKOD = dst.TXTEKGRUP
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    GROUP BY f.LNGDISTKOD, dst.TXTAD, dg.TXTAD
    ORDER BY SUM(f.DBLNETTUTAR) DESC
  `;
  // md23: portföy kapsamı — dist altındaki aktif (BYTDURUM=0) müşteri sayısı.
  // Şehir kısıtı varsa portföy de yalnızca izinli şehir müşterileriyle sınırlanır.
  const custSql = `
    SELECT LNGDISTKOD AS id, COUNT(*) AS aktif
    FROM dbo.TBLMUSTERI
    WHERE BYTDURUM = 0 AND LNGDISTKOD IS NOT NULL${cityColClause(cities, "TXTSEHIR")}
    GROUP BY LNGDISTKOD
  `;
  const [salesRes, custRes] = await Promise.all([
    runReadOnly(salesSql, { limit: 5_000, timeoutMs: 60_000 }),
    runReadOnly(custSql, { limit: 5_000, timeoutMs: 60_000 }),
  ]);
  const aktifByDist = new Map<number, number>();
  for (const r of custRes.rows) {
    if (r.id != null) aktifByDist.set(Number(r.id), Number(r.aktif ?? 0));
  }
  return salesRes.rows.map((r) => {
    const id = Number(r.id);
    return {
      id,
      ad: r.ad ? String(r.ad) : `Dist ${id}`,
      bolge: r.bolge ? String(r.bolge) : null,
      ciro: Number(r.ciro ?? 0),
      faturaSayisi: Number(r.fatura ?? 0),
      aktifMusteriSayi: aktifByDist.get(id) ?? 0,
      fkms: Number(r.fkms ?? 0),
    };
  });
}

type BrandRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro: number;
  musteriSayi: number;
};

/**
 * Marka × dist × ciro katkısı son 30g — TBLURUNGRUP/TBLURUNEKGRUP üzerinden.
 *
 * Scope-free: `TOP 50` kaldırıldı, `f.LNGDISTKOD` GROUP BY'a eklendi
 * (55 marka × 31 dist ≈ 1700 satır max — ucuz). `musteri_sayi` dist bazında
 * COUNT DISTINCT olduğu için scope filtresi sonrası dist'ler arası SUM ile
 * doğru toplanır (bir müşteri faturası tek dist'e bağlı). payPct scope
 * SONRASI o kapsamın kendi toplamına göre hesaplanır (public API'de).
 */
async function fetchBrands(cities?: string[] | null): Promise<BrandRawRow[]> {
  // Marka tablosu tenant'a göre değişir (Pernod: TBLURUNEKGRUP, Wietnauer:
  // TBLURUNGRUP). Univera standart hiyerarşi tutmaz; her dağıtıcı kendi
  // kurgusunu yapar — config'den okuyup interpolasyon ile SQL'e yaz.
  const tenant = getTenantConfig();
  const brandTable = tenant.brandTable;
  const joinCol = tenant.brandJoinColumn;

  // Hardcoded enum — SQL injection emniyeti (config TypeScript union'dan gelir).
  if (!["TBLURUNEKGRUP", "TBLURUNGRUP"].includes(brandTable))
    throw new Error(`Geçersiz brandTable: ${brandTable}`);
  if (!["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"].includes(joinCol))
    throw new Error(`Geçersiz brandJoinColumn: ${joinCol}`);

  const sql = `
    SELECT
      b.TXTKOD AS marka_kod,
      b.TXTAD AS marka,
      f.LNGDISTKOD AS dist_id,
      SUM(d.DBLNETFIYAT) AS ciro,
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
    ORDER BY SUM(d.DBLNETFIYAT) DESC
  `;
  const result = await runReadOnly(sql, { limit: 3000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    markaKod: String(r.marka_kod ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    ciro: Number(r.ciro ?? 0),
    musteriSayi: Number(r.musteri_sayi ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları marka bazında re-aggregate eder + payPct/rank hesaplar. */
function aggregateBrands(rows: BrandRawRow[], strategicBrands: string[]): BrandContribution[] {
  const byMarka = new Map<string, { marka: string; markaKod: string; ciro: number; musteriSayi: number }>();
  for (const row of rows) {
    const existing = byMarka.get(row.markaKod);
    if (existing) {
      existing.ciro += row.ciro;
      existing.musteriSayi += row.musteriSayi;
    } else {
      byMarka.set(row.markaKod, {
        marka: row.marka,
        markaKod: row.markaKod,
        ciro: row.ciro,
        musteriSayi: row.musteriSayi,
      });
    }
  }
  const toplamCiro = [...byMarka.values()].reduce((a, b) => a + b.ciro, 0);
  const stratSet = new Set(strategicBrands.map((b) => b.toLocaleLowerCase("tr")));
  return [...byMarka.values()]
    .sort((a, b) => b.ciro - a.ciro)
    .slice(0, 50)
    .map((m, i) => ({
      marka: m.marka,
      markaKod: m.markaKod,
      ciro: m.ciro,
      musteriSayi: m.musteriSayi,
      payPct: toplamCiro > 0 ? Number(((m.ciro / toplamCiro) * 100).toFixed(2)) : 0,
      rank: i + 1,
      isStratejik: stratSet.has(m.marka.toLocaleLowerCase("tr")),
    }));
}

type DiscountKpiRawRow = {
  distId: number | null;
  brut: number;
  iskonto: number;
  net: number;
  faturaCount: number;
  aktifMusteriCount: number;
};

/**
 * Son 30g iskonto/ciro KPI ham satırları — dist bazında (fatura header
 * seviyesinde, TBLMSDFATURA.DBLISKONTOTUTARI). Scope-free: `LNGDISTKOD`
 * GROUP BY'a eklendi (~31 satır, ucuz). Marka/SKU kırılımı için ileride
 * detay üzerinden ayrı bir fetcher gerekir.
 */
async function fetchDiscountKpi(
  cities?: string[] | null,
): Promise<DiscountKpiRawRow[]> {
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
      AND TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities, "LNGMUSTERIKOD")}
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

/**
 * dist-scope uygulanmış satırları toplayıp KPI'ya çevirir. `aktifMusteriCount`
 * dist bazında COUNT DISTINCT olduğundan SUM ile doğru toplanır (bir müşteri
 * faturası tek dist'e bağlı).
 */
function aggregateDiscountKpi(rows: DiscountKpiRawRow[]): DiscountKpi {
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

// ---------- Public API ------------------------------------------------------

type RawYonetimBundle = {
  topDistributors: TopDistributorRawRow[];
  brands: BrandRawRow[];
  discount: DiscountKpiRawRow[];
  generatedAt: string;
};

/**
 * Yönetim Kurulu Dashboard #1 için 3 metrik snapshot'ı.
 *
 * Cache stratejisi: full dataset (tüm dist'ler) TEK cache anahtarı
 * (`${CACHE_VERSION}-30g-all`) altında çekilir — wietnauer-stok.ts'teki
 * `scopedRows` deseniyle aynı. Dist filtresi/scope + stratejik marka
 * vurgusu (`isStratejik`) runtime'da JS'te uygulanır; bu yüzden
 * `strategicBrands` artık cache key'e girmiyor (yalnızca post-processing).
 *
 * `refresh=true` MSSQL'i zorlar — saha aktif saatlerinde kullanmayın.
 */
export async function getWietnauerYonetimSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    /** null/undefined → tüm distribütörler (merkez). Dizi → yalnızca bu
     * dist'ler görünür (dist kullanıcı). */
    allowedDistKods?: number[] | null;
    /** Merkez drill-down veya dist tek-dist seçimi. */
    distId?: number | null;
    /** Kullanıcının izinli şehirleri (null → kısıt yok). SQL'e semi-join
     * predikatı olarak uygulanır; cache key şehir kümesine göre ayrışır. */
    allowedCities?: string[] | null;
  } = {},
): Promise<WietnauerYonetimSnapshot> {
  const strategicBrands = options.strategicBrands ?? [];
  const cities = options.allowedCities ?? null;

  const cacheKey = `${CACHE_VERSION}-30g-${cityCacheTag(cities)}`;
  const result = await withCache<RawYonetimBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      // Üç sorgu paralel — toplam latency max(her sorgu).
      const [topDistributors, brands, discount] = await Promise.all([
        fetchTopDistributors(cities),
        fetchBrands(cities),
        fetchDiscountKpi(cities),
      ]);
      return {
        topDistributors,
        brands,
        discount,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const {
    topDistributors: rawTopDistributors,
    brands: rawBrands,
    discount: rawDiscount,
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

  const scopedTopDistributors = rawTopDistributors.filter((r) => inScope(r.id));
  const scopedBrandsRaw = rawBrands.filter((r) => inScope(r.distId));
  const scopedDiscount = rawDiscount.filter((r) => inScope(r.distId));

  const toplamCiro30 = scopedTopDistributors.reduce((a, r) => a + r.ciro, 0);
  const topDistributors = scopedTopDistributors
    .sort((a, b) => b.ciro - a.ciro)
    .map((r, i) => ({
      id: r.id,
      ad: r.ad,
      bolge: r.bolge,
      ciro: r.ciro,
      faturaSayisi: r.faturaSayisi,
      aktifMusteriSayi: r.aktifMusteriSayi,
      fkms: r.fkms,
      kapsamPct:
        r.aktifMusteriSayi > 0
          ? Number(((r.fkms / r.aktifMusteriSayi) * 100).toFixed(1))
          : 0,
      payPct: toplamCiro30 > 0 ? Number(((r.ciro / toplamCiro30) * 100).toFixed(2)) : 0,
      rank: i + 1,
    }));

  const brands = aggregateBrands(scopedBrandsRaw, strategicBrands);
  const discount = aggregateDiscountKpi(scopedDiscount);

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    topDistributors,
    brands,
    discount,
  };
}
