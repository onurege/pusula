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
const CACHE_VERSION = "v6";

// ---------- Tipler ----------------------------------------------------------

export type TopCustomer = {
  /** TBLMUSTERI.LNGKOD */
  id: number;
  unvan: string;
  sehir: string | null;
  bolge: string | null;
  /** Son 30g net ciro */
  ciro: number;
  /** Son 30g fatura sayısı */
  faturaSayisi: number;
  /** Toplam içindeki pay (%) — pasta dilimi için */
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
  topCustomers: TopCustomer[]; // Tüm 50, UI'da 10/20/50 toggle ile slicing
  brands: BrandContribution[];
  discount: DiscountKpi;
};

// ---------- Fetcher'lar -----------------------------------------------------

type TopCustomerRawRow = Omit<TopCustomer, "rank" | "payPct"> & { distId: number | null };

/**
 * Son 30 günde fatura kesen TÜM müşteriler (satır seviyesi, ciro DESC).
 * UI tarafı Top 50'yi alıp 10/20/50 toggle ile slice eder.
 *
 * Scope-free: `TOP 50` kaldırıldı — dist scope uygulanmadan Top 50 kesilirse
 * küçük bir dist'in kendi top müşterileri listeden düşebilir (merkez'in
 * devasa müşterileri listeyi doldurur). ~8-9K aktif müşteri (30g) —
 * wietnauer-stok.ts'teki cardinality (~6K) ile aynı mertebede, JS-filtreye
 * çevirmek güvenli. payPct scope SONRASI (o kapsamın kendi toplamına göre)
 * hesaplanır — public API'de.
 */
async function fetchTopCustomers(): Promise<TopCustomerRawRow[]> {
  const sql = `
    SELECT
      f.LNGMUSTERIKOD AS id,
      f.LNGDISTKOD AS dist_id,
      m.TXTUNVAN AS unvan,
      m.TXTSEHIR AS sehir,
      dg.TXTAD AS bolge,
      SUM(f.DBLNETTUTAR) AS ciro,
      COUNT(*) AS fatura
    FROM dbo.TBLMSDFATURA AS f
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
    LEFT JOIN dbo.TBLDIST d ON d.LNGKOD = m.LNGDISTKOD
    LEFT JOIN dbo.TBLDISTEKGRUP dg ON dg.TXTKOD = d.TXTEKGRUP
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
    GROUP BY f.LNGMUSTERIKOD, f.LNGDISTKOD, m.TXTUNVAN, m.TXTSEHIR, dg.TXTAD
    ORDER BY SUM(f.DBLNETTUTAR) DESC
  `;
  const result = await runReadOnly(sql, { limit: 20_000, timeoutMs: 60_000 });
  return result.rows.map((r) => ({
    id: Number(r.id),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    unvan: String(r.unvan ?? ""),
    sehir: r.sehir ? String(r.sehir) : null,
    bolge: r.bolge ? String(r.bolge) : null,
    ciro: Number(r.ciro ?? 0),
    faturaSayisi: Number(r.fatura ?? 0),
  }));
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
async function fetchBrands(): Promise<BrandRawRow[]> {
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
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
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
async function fetchDiscountKpi(): Promise<DiscountKpiRawRow[]> {
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
      AND TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
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
  topCustomers: TopCustomerRawRow[];
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
  } = {},
): Promise<WietnauerYonetimSnapshot> {
  const strategicBrands = options.strategicBrands ?? [];

  const cacheKey = `${CACHE_VERSION}-30g-all`;
  const result = await withCache<RawYonetimBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      // Üç sorgu paralel — toplam latency max(her sorgu).
      const [topCustomers, brands, discount] = await Promise.all([
        fetchTopCustomers(),
        fetchBrands(),
        fetchDiscountKpi(),
      ]);
      return {
        topCustomers,
        brands,
        discount,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const {
    topCustomers: rawTopCustomers,
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

  const scopedTopCustomers = rawTopCustomers.filter((r) => inScope(r.distId));
  const scopedBrandsRaw = rawBrands.filter((r) => inScope(r.distId));
  const scopedDiscount = rawDiscount.filter((r) => inScope(r.distId));

  const toplamCiro30 = scopedTopCustomers.reduce((a, r) => a + r.ciro, 0);
  const topCustomers = scopedTopCustomers
    .sort((a, b) => b.ciro - a.ciro)
    .slice(0, 50)
    .map((r, i) => ({
      id: r.id,
      unvan: r.unvan,
      sehir: r.sehir,
      bolge: r.bolge,
      ciro: r.ciro,
      faturaSayisi: r.faturaSayisi,
      payPct: toplamCiro30 > 0 ? Number(((r.ciro / toplamCiro30) * 100).toFixed(2)) : 0,
      rank: i + 1,
    }));

  const brands = aggregateBrands(scopedBrandsRaw, strategicBrands);
  const discount = aggregateDiscountKpi(scopedDiscount);

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    topCustomers,
    brands,
    discount,
  };
}
