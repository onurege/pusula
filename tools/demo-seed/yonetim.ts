/**
 * FMCG Demo seed — Yönetim Kurulu (Wietnauer Dashboard #1) pre-bake.
 *
 * `getWietnauerYonetimSnapshot` (packages/core/src/wietnauer-metrics.ts)
 * MSSQL'e bakmadan önce `withCache(CACHE_DOMAIN, cacheKey, ...)` ile
 * `cache_entries` tablosunu kontrol eder. Demo tenant'ta (fmcg-demo) MSSQL
 * yok — bu yüzden aynı domain/key altına sentetik bir `RawYonetimBundle`
 * doğrudan `cachedWrite` ile yazılır (bkz. tools/demo-seed/iskonto.ts'teki
 * aynı desen — bu dosya onun birebir eşleniği, farklı domain/key/şekil).
 *
 * Not: Yönetim Kurulu sayfası (apps/dashboard/app/v3/yonetim-kurulu/page.tsx)
 * İKİ endpoint çağırır:
 *   1) `getWietnauerYonetim` → `/api/wietnauer/yonetim` → bu dosyanın seed'lediği
 *      domain ("wietnauer", KESIN key "v7-30g-all").
 *   2) `getWietnauerIskonto` → `/api/wietnauer/iskonto` → AYRI domain
 *      ("wietnauer-iskonto", key "v5-30g-all") — bu ZATEN
 *      `tools/demo-seed/iskonto.ts` tarafından seed'leniyor (Ticari Yatırım
 *      dashboard'u ile paylaşılan aynı endpoint/cache-hit; page.tsx üstteki
 *      yorum bunu doğruluyor: "Endpoint aynı, ödediğin bedel cache hit.").
 *      Bu dosya o ikinci domain'e DOKUNMAZ.
 *
 * KESIN domain + key (packages/core/src/wietnauer-metrics.ts ile birebir):
 *   CACHE_DOMAIN  = "wietnauer"
 *   CACHE_VERSION = "v7"
 *   cacheKey (varsayılan görünüm — allowedCities=null/undefined, dateFrom/
 *     dateTo yok → resolveWindowBounds fallback `win.key = "30g"`) =
 *     `${CACHE_VERSION}-${win.key}-${cityCacheTag(cities)}`
 *     = "v7-30g-all"
 *   (cityCacheTag: `cities` null/undefined → "all" — auth.ts:404-406;
 *    resolveWindowBounds: dateFrom/dateTo yoksa `key = "${fallbackDays}g"`
 *    = "30g" — now.ts:145-163; demo tenant `resolveTenantScope` merkez
 *    kullanıcıyı HER ZAMAN `{ distKods: null, cities: null }` ile döner —
 *    auth.ts:305-307 DOĞRULANDI.)
 *
 * `RawYonetimBundle` scope-free (tüm dist) ham satırlardan oluşur; public API
 * (`getWietnauerYonetimSnapshot`) bu ham satırları JS'te dist-scope + payPct/
 * kapsamPct/rank hesaplayarak `WietnauerYonetimSnapshot`'a çevirir. Bu dosya
 * ham satırları (distId=null / merkez scope her satırı kapsar) üretir,
 * agregasyon mantığına dokunmaz.
 *
 *   TENANT=fmcg-demo npx tsx tools/demo-seed/yonetim.ts
 */
import { cachedWrite } from "@enroute/core";

// ---------- Cache sabitleri (wietnauer-metrics.ts ile birebir) -------------

const CACHE_DOMAIN = "wietnauer";
const CACHE_VERSION = "v7";
/** Varsayılan (şehir kısıtsız, aralık verilmemiş) görünümün cache key'i. */
const CACHE_KEY = `${CACHE_VERSION}-30g-all`;

// ---------- Yerel tip kopyaları (packages/core/src/wietnauer-metrics.ts) ---
// Not: bu dosya core paketini import etmez (yalnız `cachedWrite` dışa
// aktarılıyor) — cache'lenen tipin ŞEKLİ burada birebir kopyalanır ki
// `withCache<RawYonetimBundle>` deserialize ederken alan eksikliği/typo
// runtime'da sessizce yutulmasın (typecheck bunu derleme zamanında yakalar).

type TopDistributorRawRow = {
  id: number;
  ad: string;
  bolge: string | null;
  ciro: number;
  faturaSayisi: number;
  aktifMusteriSayi: number;
  fkms: number;
};

type BrandRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro: number;
  musteriSayi: number;
};

type DiscountKpiRawRow = {
  distId: number | null;
  brut: number;
  iskonto: number;
  net: number;
  faturaCount: number;
  aktifMusteriCount: number;
};

type RawYonetimBundle = {
  topDistributors: TopDistributorRawRow[];
  brands: BrandRawRow[];
  discount: DiscountKpiRawRow[];
  generatedAt: string;
};

// ---------- Deterministik PRNG (tools/demo-seed/iskonto.ts ile aynı desen) --

function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000_000) / 1_000_000_000;
  };
}
const rng = makeRng(20260616);
const rand = (min: number, max: number) => min + rng() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

// ---------- Sentetik veri havuzları -----------------------------------------
// Distribütör isim/id havuzu — tools/seed-fmcg-demo.ts DISTRIBUTOR_NAMES ile
// birebir (id = 1000 + index) ki komuta/map cache'iyle aynı dist kimlikleri
// tutarlı olsun.

const DISTRIBUTOR_NAMES = [
  "AKSAN GIDA DAĞITIM", "TAÇ DAĞITIM", "MAVİ DAĞITIM", "EGE GIDA",
  "ANADOLU TİCARET", "PINAR DAĞITIM", "GÜNDOĞAN GIDA", "BEREKET GIDA",
  "ALTIN DAĞITIM", "MARMARA TİCARET", "YILDIZ GIDA", "DOĞU GIDA",
  "BATI DAĞITIM", "GÜNEŞ GIDA", "ÇINAR DAĞITIM", "GÜVEN TİCARET",
  "USTA GIDA", "DENIZ GIDA", "ASLAN TİCARET", "EMRE DAĞITIM",
  "BÜYÜK GIDA", "FATİH GIDA", "OSMAN TİCARET", "CESUR GIDA",
  "ANATOLİA FOODS", "TURKDAY DAĞITIM", "PIRAMIT GIDA", "ZAFER TİCARET",
  "AY YILDIZ GIDA", "GÜNEŞ DAĞITIM",
] as const;

// tools/seed-fmcg-demo.ts REGION_COLORS ile aynı 8 coğrafi bölge.
const REGIONS = [
  "Marmara", "Ege", "Akdeniz", "İç Anadolu",
  "Karadeniz", "Doğu Anadolu", "Güneydoğu Anadolu", "Kıbrıs",
] as const;

// tools/demo-seed/iskonto.ts BRANDS ile birebir — marka katkı paneli aynı
// portföyü göstersin diye kod/ad/ağırlık tutarlı tutuldu.
const BRANDS: readonly { kod: string; ad: string; weight: number }[] = [
  { kod: "CIKOMASTER", ad: "ÇİKOMASTER", weight: 18 },
  { kod: "GOFRETKING", ad: "GOFRETKING", weight: 14 },
  { kod: "KAHVELIDER", ad: "KAHVELİDER", weight: 8 },
  { kod: "CIKIRBIS", ad: "ÇIKIRBİS", weight: 11 },
  { kod: "MISIRKING", ad: "MISIRKING", weight: 9 },
  { kod: "TAMMAVI", ad: "TAMMAVİ", weight: 8 },
  { kod: "TEMIZYOL", ad: "TEMİZ-YOL", weight: 9 },
  { kod: "JELSTAR", ad: "JELSTAR", weight: 5 },
  { kod: "KONSERVEX", ad: "KONSERVEX", weight: 5 },
  { kod: "ATISTIRMALIK", ad: "ATIŞTIRMALIK PL", weight: 7 },
  { kod: "CAYEXPRESS", ad: "ÇAY EXPRESS", weight: 6 },
];

// Portföy hedefleri — tools/demo-seed/iskonto.ts buildOverall() ile aynı
// mertebede (~42.5M brüt, ~13% iskonto oranı) ki iki dashboard'un KPI'ları
// (Toplam Net Ciro vs Ticari Yatırım brüt/net) tutarlı bir portföy hikâyesi
// anlatsın.
const TOTAL_BRUT = 43_000_000 + rand(-1_200_000, 1_200_000);
const ISKONTO_ORANI_PCT = rand(11, 15);
const TOTAL_ISKONTO = TOTAL_BRUT * (ISKONTO_ORANI_PCT / 100);
const TOTAL_NET = TOTAL_BRUT - TOTAL_ISKONTO;

// ---------- Fetcher eşdeğeri üretim fonksiyonları ---------------------------
// Tümü tek "merkez" görünüm altında üretilir (distId=null veya demo dist id'leri
// — demo tenant `allowedDistKods=null` döndüğü için `inScope` her satırı zaten
// kapsıyor, bkz. wietnauer-metrics.ts:387-394); dist bazlı yetki kırılımı
// demo'da gerekmiyor (RBAC merkez-only — bkz. proje hafızası).

/**
 * md22/md23 eşdeğeri — 30 distribütör, üstel azalan (Pareto benzeri) ciro
 * dağılımı; ilk ~10 distribütör toplam cironun makul bir kısmını taşır
 * (KpiTile "Top 10 Konsantrasyon" kartı için gerçekçi ama alarm vermeyen
 * bir bant hedeflenir, ~35-48%).
 */
function buildTopDistributors(): TopDistributorRawRow[] {
  const n = DISTRIBUTOR_NAMES.length;
  const rawWeights = DISTRIBUTOR_NAMES.map((_, i) => Math.pow(0.905, i) * rand(0.82, 1.18));
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);

  // faturaSayisi ve aktifMusteriCount portföy toplamları — discount KPI'daki
  // toplam fatura/aktif müşteri sayısıyla aynı mertebede paylaştırılır.
  const totalFatura = randInt(19_500, 21_500);
  const totalAktifMusteri = randInt(8_200, 9_000);
  let faturaAssigned = 0;
  let aktifAssigned = 0;

  return DISTRIBUTOR_NAMES.map((ad, i) => {
    const w = rawWeights[i]! / weightSum;
    const ciro = Math.round(TOTAL_NET * w);
    const isLast = i === n - 1;
    const faturaSayisi = isLast
      ? Math.max(50, totalFatura - faturaAssigned)
      : Math.max(50, Math.round(totalFatura * w * rand(0.85, 1.15)));
    faturaAssigned += faturaSayisi;
    const aktifMusteriSayi = isLast
      ? Math.max(30, totalAktifMusteri - aktifAssigned)
      : Math.max(30, Math.round(totalAktifMusteri * w * rand(0.85, 1.15)));
    aktifAssigned += aktifMusteriSayi;
    // FKMS (fatura kesilen distinct müşteri) — portföyün %55-85'i arası kapsam.
    const fkms = Math.min(aktifMusteriSayi, Math.round(aktifMusteriSayi * rand(0.55, 0.85)));
    return {
      id: 1000 + i,
      ad,
      bolge: REGIONS[i % REGIONS.length]!,
      ciro,
      faturaSayisi,
      aktifMusteriSayi,
      fkms,
    };
  });
}

/**
 * Marka × ciro katkısı — dist kırılımı olmadan (distId=null) tek satır/marka;
 * `aggregateBrands` runtime'da markaKod bazında zaten GROUP BY yapıyor, bu
 * yüzden tek satır yeterli (tools/demo-seed/iskonto.ts buildBrands() ile aynı
 * desen).
 */
function buildBrands(): BrandRawRow[] {
  return BRANDS.map((b) => {
    const ciro = Math.round(TOTAL_NET * (b.weight / 100) * rand(0.85, 1.15));
    const musteriSayi = randInt(320, 380) + Math.round(b.weight * 55 * rand(0.85, 1.15));
    return {
      markaKod: b.kod,
      marka: b.ad,
      distId: null,
      ciro,
      musteriSayi,
    };
  });
}

/** Son 30g brüt/iskonto/net portföy KPI — tek satır (distId=null, tüm portföy). */
function buildDiscount(): DiscountKpiRawRow[] {
  return [
    {
      distId: null,
      brut: Math.round(TOTAL_BRUT),
      iskonto: Math.round(TOTAL_ISKONTO),
      net: Math.round(TOTAL_NET),
      faturaCount: randInt(19_500, 21_500),
      aktifMusteriCount: randInt(8_200, 9_000),
    },
  ];
}

// ---------- Public API -------------------------------------------------------

/**
 * Yönetim Kurulu snapshot'ını üretip `cache_entries`'e pre-bake yazar.
 * `getWietnauerYonetimSnapshot` (packages/core/src/wietnauer-metrics.ts)
 * varsayılan çağrıda (options boş → `allowedCities=null`, `distId=null`,
 * aralık yok) tam bu domain+key altına bakar; MSSQL'e hiç gitmeden bu
 * bundle'ı okur.
 */
export function seedYonetim(): void {
  const bundle: RawYonetimBundle = {
    topDistributors: buildTopDistributors(),
    brands: buildBrands(),
    discount: buildDiscount(),
    generatedAt: new Date().toISOString(),
  };
  cachedWrite(CACHE_DOMAIN, CACHE_KEY, bundle, 850);
}
