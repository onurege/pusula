/**
 * Demo seed — Marka & SKU (Dashboard #4, `wietnauer-marka.ts`).
 *
 * `fmcg-demo` (demoData:true) MSSQL'e bağlanmaz; v3 ekranları `withCache`
 * ile okunur. Bu dosya, ekranın DEFAULT açılışında `getWietnauerMarkaSnapshot()`
 * içindeki `withCache(CACHE_DOMAIN, cacheKey, ...)` çağrısının okuyacağı KESIN
 * cache satırını PRE-BAKE eder (SQLite `cache_entries` tablosu) — demo'da
 * gerçek SQL hiç çalışmaz, bu satır zaten mevcutsa fetch tetiklenmez.
 *
 * KESIN cache anahtarı türetimi (bkz. `packages/core/src/wietnauer-marka.ts`):
 *   - CACHE_DOMAIN = "wietnauer-marka"
 *   - CACHE_VERSION = "v3"
 *   - cacheKey = `${CACHE_VERSION}-${stratKey || "none"}-${cityCacheTag(cities)}-${win.key}`
 *
 * Default istek bileşenleri (apps/api/src/server.ts `makeV3Handler` +
 * `packages/core/src/auth.ts` `resolveTenantScope`):
 *   - `strategicBrands`: `tenant.strategicBrands ?? []` — `FMCG_DEMO_CONFIG`
 *     (packages/core/src/tenant/configs/fmcg-demo.ts) alanı TANIMSIZ →
 *     `strategicBrands = []` → `stratKey = [].map(...).sort().join("|") = ""`
 *     → `stratKey || "none"` → **"none"**.
 *   - `allowedCities`: `resolveTenantScope()` demo dalı (`getTenantConfig()
 *     .demoData === true`) HER ZAMAN `{ type: "merkez", distKods: null,
 *     cities: null }` döner (Panorama-scoping demo'da geçersiz) → `cities =
 *     null` → `cityCacheTag(null)` → **"all"**.
 *   - `dateFrom`/`dateTo`: ekran query param'sız açılır → `parseDateRange()`
 *     `null`/`null` döner → `resolveWindowBounds(null, null, 30)` fallback
 *     dalına düşer → `win.key = "${fallbackDays}g"` = **"30g"**.
 *
 * → KESIN key: **"v3-none-all-30g"**.
 *
 * READ-ONLY kural: bu dosya yalnızca `cachedWrite` ile SQLite cache tablosuna
 * yazar; hiçbir canlı MSSQL bağlantısı açmaz, `.env` okumaz/yazmaz.
 */
import { cachedWrite } from "@enroute/core";

// ---------- RawMarkaBundle şekli (packages/core/src/wietnauer-marka.ts'ten
// yerel kopya — dosya bu tipi export etmiyor) ---------------------------------

type MarkaPortfolioRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro: number;
  musteriSayi: number;
  faturaSayisi: number;
};

type TopSkuRawRow = {
  urunKod: number;
  ad: string;
  marka: string;
  distId: number | null;
  ciro: number;
  miktar: number;
  musteriSayi: number;
};

type BrandPenetrationRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  musteriSayi: number;
};

type AktifToplamRawRow = { distId: number | null; toplam: number };

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

type BrandWindowRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro30: number;
  ciro90: number;
  ciroYtd: number;
};

type RawMarkaBundle = {
  portfolio: MarkaPortfolioRawRow[];
  topSkus: TopSkuRawRow[];
  penetration: BrandPenetrationRawRow[];
  aktifToplam: AktifToplamRawRow[];
  strategic: StrategicBrandDetailRawRow[];
  windowComparison: BrandWindowRawRow[];
  generatedAt: string;
};

// ---------- Sentetik FMCG marka portföyü -------------------------------------
// 8 marka × 4 kategori (yalnızca yorum amaçlı — RawMarkaBundle satırlarında
// kategori alanı yok, tenant `brandTable` = TBLURUNEKGRUP tek seviyeli).
//   Çikolata & Şekerleme : ÇİKOMASTER, JELSTAR
//   Bisküvi & Gofret     : GOFRETKING, ÇIKIRBİS
//   Kahve                : KAHVELİDER, TAMMAVİ
//   Atıştırmalık         : MISIRKING, TEMİZ-YOL

type BrandSeed = {
  kod: string;
  ad: string;
  kategori: string;
  ciro30: number;
  musteriSayi: number;
  faturaSayisi: number;
  skus: { kod: number; ad: string; ciroPay: number; miktar: number; musteriSayi: number }[];
};

const BRANDS: BrandSeed[] = [
  {
    kod: "CIKOMASTER",
    ad: "ÇİKOMASTER",
    kategori: "Çikolata & Şekerleme",
    ciro30: 1_840_000,
    musteriSayi: 612,
    faturaSayisi: 2140,
    skus: [
      { kod: 40101, ad: "ÇİKOMASTER Sütlü Tablet 80g", ciroPay: 0.34, miktar: 41800, musteriSayi: 480 },
      { kod: 40102, ad: "ÇİKOMASTER Bitter %70 100g", ciroPay: 0.22, miktar: 19600, musteriSayi: 305 },
      { kod: 40103, ad: "ÇİKOMASTER Fındıklı Bar 45g", ciroPay: 0.2, miktar: 52000, musteriSayi: 398 },
      { kod: 40104, ad: "ÇİKOMASTER Draje Karışık 150g", ciroPay: 0.14, miktar: 15200, musteriSayi: 210 },
      { kod: 40105, ad: "ÇİKOMASTER Mini Ekonomik 24'lü", ciroPay: 0.1, miktar: 9800, musteriSayi: 140 },
    ],
  },
  {
    kod: "JELSTAR",
    ad: "JELSTAR",
    kategori: "Çikolata & Şekerleme",
    ciro30: 742_000,
    musteriSayi: 355,
    faturaSayisi: 980,
    skus: [
      { kod: 40201, ad: "JELSTAR Meyveli Jöle 80g", ciroPay: 0.4, miktar: 61000, musteriSayi: 260 },
      { kod: 40202, ad: "JELSTAR Ekşi Şeker 60g", ciroPay: 0.28, miktar: 44500, musteriSayi: 190 },
      { kod: 40203, ad: "JELSTAR Marshmallow 100g", ciroPay: 0.19, miktar: 21300, musteriSayi: 120 },
      { kod: 40204, ad: "JELSTAR Mini Poşet 12'li", ciroPay: 0.13, miktar: 18700, musteriSayi: 95 },
    ],
  },
  {
    kod: "GOFRETKING",
    ad: "GOFRETKING",
    kategori: "Bisküvi & Gofret",
    ciro30: 2_215_000,
    musteriSayi: 748,
    faturaSayisi: 2610,
    skus: [
      { kod: 40301, ad: "GOFRETKING Fındıklı Gofret 36g", ciroPay: 0.31, miktar: 98000, musteriSayi: 590 },
      { kod: 40302, ad: "GOFRETKING Kakaolu Gofret 40g", ciroPay: 0.26, miktar: 81000, musteriSayi: 470 },
      { kod: 40303, ad: "GOFRETKING Karamelli Bar 32g", ciroPay: 0.18, miktar: 54000, musteriSayi: 310 },
      { kod: 40304, ad: "GOFRETKING Aile Boy 8'li Kutu", ciroPay: 0.16, miktar: 22400, musteriSayi: 240 },
      { kod: 40305, ad: "GOFRETKING Mini 24'lü Ekonomik", ciroPay: 0.09, miktar: 17600, musteriSayi: 150 },
    ],
  },
  {
    kod: "CIKIRBIS",
    ad: "ÇIKIRBİS",
    kategori: "Bisküvi & Gofret",
    ciro30: 1_356_000,
    musteriSayi: 501,
    faturaSayisi: 1690,
    skus: [
      { kod: 40401, ad: "ÇIKIRBİS Kakaolu Bisküvi 150g", ciroPay: 0.37, miktar: 46000, musteriSayi: 360 },
      { kod: 40402, ad: "ÇIKIRBİS Sandviç Bisküvi 200g", ciroPay: 0.29, miktar: 33500, musteriSayi: 280 },
      { kod: 40403, ad: "ÇIKIRBİS Tam Buğday 175g", ciroPay: 0.21, miktar: 24800, musteriSayi: 205 },
      { kod: 40404, ad: "ÇIKIRBİS Mini Paket 30'lu", ciroPay: 0.13, miktar: 15100, musteriSayi: 130 },
    ],
  },
  {
    kod: "KAHVELIDER",
    ad: "KAHVELİDER",
    kategori: "Kahve",
    ciro30: 2_680_000,
    musteriSayi: 890,
    faturaSayisi: 3120,
    skus: [
      { kod: 40501, ad: "KAHVELİDER Filtre Kahve 250g", ciroPay: 0.33, miktar: 38200, musteriSayi: 640 },
      { kod: 40502, ad: "KAHVELİDER 3'ü 1 Arada 24'lü", ciroPay: 0.27, miktar: 29800, musteriSayi: 520 },
      { kod: 40503, ad: "KAHVELİDER Türk Kahvesi 100g", ciroPay: 0.22, miktar: 26400, musteriSayi: 410 },
      { kod: 40504, ad: "KAHVELİDER Espresso Kapsül 10'lu", ciroPay: 0.11, miktar: 12100, musteriSayi: 180 },
      { kod: 40505, ad: "KAHVELİDER Ofis Boy 1kg", ciroPay: 0.07, miktar: 4600, musteriSayi: 95 },
    ],
  },
  {
    kod: "TAMMAVI",
    ad: "TAMMAVİ",
    kategori: "Kahve",
    ciro30: 1_064_000,
    musteriSayi: 430,
    faturaSayisi: 1310,
    skus: [
      { kod: 40601, ad: "TAMMAVİ Kahve Kreması 200g", ciroPay: 0.42, miktar: 31200, musteriSayi: 340 },
      { kod: 40602, ad: "TAMMAVİ Sütlü Granül 400g", ciroPay: 0.31, miktar: 18400, musteriSayi: 250 },
      { kod: 40603, ad: "TAMMAVİ Stick 50'li Kutu", ciroPay: 0.27, miktar: 22900, musteriSayi: 195 },
    ],
  },
  {
    kod: "MISIRKING",
    ad: "MISIRKING",
    kategori: "Atıştırmalık",
    ciro30: 1_598_000,
    musteriSayi: 622,
    faturaSayisi: 1980,
    skus: [
      { kod: 40701, ad: "MISIRKING Tuzlu Cips 90g", ciroPay: 0.3, miktar: 71000, musteriSayi: 480 },
      { kod: 40702, ad: "MISIRKING Karamelli Patlamış 80g", ciroPay: 0.25, miktar: 53000, musteriSayi: 360 },
      { kod: 40703, ad: "MISIRKING Baharatlı Çubuk 100g", ciroPay: 0.23, miktar: 41500, musteriSayi: 300 },
      { kod: 40704, ad: "MISIRKING Aile Boy 200g", ciroPay: 0.14, miktar: 19800, musteriSayi: 210 },
      { kod: 40705, ad: "MISIRKING Mini 20'li Ekonomik", ciroPay: 0.08, miktar: 14200, musteriSayi: 140 },
    ],
  },
  {
    kod: "TEMIZYOL",
    ad: "TEMİZ-YOL",
    kategori: "Atıştırmalık",
    ciro30: 918_000,
    musteriSayi: 388,
    faturaSayisi: 1120,
    skus: [
      { kod: 40801, ad: "TEMİZ-YOL Fırınlanmış Cips 100g", ciroPay: 0.38, miktar: 32600, musteriSayi: 290 },
      { kod: 40802, ad: "TEMİZ-YOL Kuruyemiş Karışık 150g", ciroPay: 0.34, miktar: 21400, musteriSayi: 240 },
      { kod: 40803, ad: "TEMİZ-YOL Meyve Cipsi 60g", ciroPay: 0.28, miktar: 27100, musteriSayi: 205 },
    ],
  },
];

const now = new Date();
/** DEMO_DATE ile hizalı sabit sentetik "üretilme" anı — sızıntı riski yok (bu
 * dosya salt seed amaçlı, gerçek `sqlNow()`/DEMO_DATE zincirine bağlı değil). */
const GENERATED_AT = now.toISOString();

// dist bazında değil — demo'da `resolveTenantScope()` her zaman
// `distKods: null` (Panorama-scoping demo'da geçersiz) döndürdüğü için
// `inScope()` distId'den bağımsız her zaman true'dur; tüm satırlar `distId:
// null` (tek "merkez" bloğu) ile yazılabilir — gerçek çok-dist parçalanmasını
// taklit etmeye gerek yok.
const DIST_ID: number | null = null;

function buildBundle(): RawMarkaBundle {
  const portfolio: MarkaPortfolioRawRow[] = BRANDS.map((b) => ({
    markaKod: b.kod,
    marka: b.ad,
    distId: DIST_ID,
    ciro: b.ciro30,
    musteriSayi: b.musteriSayi,
    faturaSayisi: b.faturaSayisi,
  }));

  const topSkus: TopSkuRawRow[] = BRANDS.flatMap((b) =>
    b.skus.map((s) => ({
      urunKod: s.kod,
      ad: s.ad,
      marka: b.ad,
      distId: DIST_ID,
      ciro: Math.round(b.ciro30 * s.ciroPay),
      miktar: s.miktar,
      musteriSayi: s.musteriSayi,
    })),
  );

  const penetration: BrandPenetrationRawRow[] = BRANDS.map((b) => ({
    markaKod: b.kod,
    marka: b.ad,
    distId: DIST_ID,
    musteriSayi: b.musteriSayi,
  }));

  // Toplam aktif müşteri (son 30g fatura kesilen distinct) — markalar arası
  // örtüşme olduğundan basit toplamdan büyük olmalı (penetrasyon %'leri
  // makul aralıkta kalsın diye).
  const aktifToplam: AktifToplamRawRow[] = [{ distId: DIST_ID, toplam: 2860 }];

  // `strategicBrands` FMCG_DEMO_CONFIG'de tanımsız → runtime'da `stratKey =
  // "none"` ve `aggregateStrategicBrandsDetail` config listesi üzerinden
  // map'lediği için bu raw satırlar ekranda GÖRÜNMEZ (boş `strategic: []`
  // döner) — yine de RawMarkaBundle şeklini tam doldurmak için birkaç örnek
  // marka (en büyük 3 marka) dolduruluyor; ileride tenant'a strategicBrands
  // eklenirse veri hazır olur.
  const strategic: StrategicBrandDetailRawRow[] = BRANDS.slice(0, 3).flatMap((b) =>
    b.skus.slice(0, 3).map((s) => ({
      markaKod: b.kod,
      marka: b.ad,
      distId: DIST_ID,
      ciro: b.ciro30,
      musteriSayi: b.musteriSayi,
      faturaSayisi: b.faturaSayisi,
      urunKod: s.kod,
      skuAd: s.ad,
      skuCiro: Math.round(b.ciro30 * s.ciroPay),
    })),
  );

  // 30g / 90g / YTD pencere karşılaştırması — 90g ≈ 30g*2.7 (mevsimsellik +
  // büyüme), YTD ≈ 30g*8.4 (yıl başından bugüne, ~8.5 ay birikimli).
  const windowComparison: BrandWindowRawRow[] = BRANDS.map((b) => ({
    markaKod: b.kod,
    marka: b.ad,
    distId: DIST_ID,
    ciro30: b.ciro30,
    ciro90: Math.round(b.ciro30 * 2.7),
    ciroYtd: Math.round(b.ciro30 * 8.4),
  }));

  return {
    portfolio,
    topSkus,
    penetration,
    aktifToplam,
    strategic,
    windowComparison,
    generatedAt: GENERATED_AT,
  };
}

/**
 * `fmcg-demo` için Marka & SKU (Dashboard #4) cache satırını pre-bake eder.
 *
 * KESIN hedef: domain `"wietnauer-marka"`, key `"v3-none-all-30g"` — ekranın
 * DEFAULT açılışında `getWietnauerMarkaSnapshot()` içindeki `withCache()`
 * çağrısının okuduğu anahtarla birebir (bkz. dosya-üstü not).
 */
export function seedMarka(): void {
  const bundle = buildBundle();
  cachedWrite("wietnauer-marka", "v3-none-all-30g", bundle, 1180);
}
