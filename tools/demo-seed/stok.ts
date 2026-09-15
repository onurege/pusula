/**
 * FMCG Demo seed — Wietnauer "Stok Tükenme & Miktar Bazlı Devir" ekranı
 * (dashboard #8).
 *
 * Amaç: `fmcg-demo` tenant'ı (demoData:true, MSSQL'e bağlanmaz) için
 * `getWietnauerStockSnapshot` içindeki `withCache` katmanının okuyacağı
 * `{ allRows, emptySnapshotTables, generatedAt }` şeklinde bir bundle'ı
 * `cache_entries` tablosuna direkt yazar. Böylece demo'da endpoint canlı
 * DB'ye gitmeden, önceden pişirilmiş (pre-baked) veriyi cache'ten okur.
 *
 * KESIN cache anahtarı — `packages/core/src/wietnauer-stok.ts` okunarak
 * doğrulandı:
 *   - CACHE_DOMAIN = "wietnauer-stok"
 *   - CACHE_VERSION = "v5"
 *   - WINDOW_DAYS = 90
 *   - cacheKey (non-custom dal, demandWindow.custom === false) =
 *       `${CACHE_VERSION}-${WINDOW_DAYS}g-all` → **"v5-90g-all"**
 *     (custom dalı yalnızca `?from&to` verilince devreye girer; demo isteği
 *     bunları GEÇMEZ → her zaman non-custom dal, cache key sabit.)
 *   → Nihai anahtar: **"v5-90g-all"**
 *
 * Kullanım:
 *   TENANT=fmcg-demo npx tsx tools/demo-seed/stok.ts
 *
 * NOT: Bu dosya cache'e yazılan bundle tipini ({ allRows, emptySnapshotTables,
 * generatedAt }) YEREL olarak tanımlar çünkü kaynak dosyada bu tip `export`
 * edilmemiş — `withCache<{...}>(...)` çağrısına inline geçiriliyor
 * (wietnauer-stok.ts satır ~941). `WietnauerStockSkuRow` (satır satırdaki tüm
 * alanlar) ise export edilmiş, doğrudan `@enroute/core`'dan import edilir.
 */
import {
  cachedWrite,
  type WietnauerStockSkuRow,
  type StockRiskTier,
  type DemandPattern,
  type StockConfidence,
  type LeadTimeSource,
  type StockDataQuality,
} from "@enroute/core";

// ---------- Yerel tip kopyası (wietnauer-stok.ts `withCache<{...}>` ile birebir) ----

/** wietnauer-stok.ts: `withCache<{...}>` generic'inin inline (export edilmemiş) şekli. */
type WietnauerStockCacheBundle = {
  allRows: WietnauerStockSkuRow[];
  emptySnapshotTables: boolean;
  generatedAt: string;
};

// ---------- Deterministik PRNG (mulberry32) --------------------------------
// Math.random yerine — demo rakamları her seed çalıştırmasında AYNI kalır
// (ekran screenshot/regresyon karşılaştırmaları için stabil).
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260417);

function randInt(min: number, max: number): number {
  return Math.floor(min + rand() * (max - min + 1));
}

function randFloat(min: number, max: number): number {
  return min + rand() * (max - min);
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)] as T;
}

function pickWeighted<T>(arr: readonly { item: T; weight: number }[]): T {
  const total = arr.reduce((a, b) => a + b.weight, 0);
  let r = rand() * total;
  for (const { item, weight } of arr) {
    r -= weight;
    if (r <= 0) return item;
  }
  return arr[arr.length - 1]!.item;
}

function round(n: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// ---------- "Bugün" sabiti ---------------------------------------------------
// Diğer FMCG demo snapshot'larıyla (komuta v10 "2026-04-17") hizalı sabit
// tarih — script çalışma anındaki gerçek saatten bağımsız, deterministik
// tarih hesapları (estimatedStockoutDate, lastInboundDays vb.) için anchor.
const ANCHOR_DATE = "2026-04-17";

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00Z`).getTime();
  const to = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

// ---------- FMCG sentetik referans verisi -----------------------------------

// wietnauer-stok.ts satır ~57 dokümantasyonu: "5 bölge
// (MARMARA/EGE/ANADOLU/AKDENİZ/GÜNEYDOĞU)" — TBLDISTEKGRUP.TXTAD birebir.
const REGIONS = ["MARMARA", "EGE", "ANADOLU", "AKDENİZ", "GÜNEYDOĞU"] as const;

type DistDef = { id: number; ad: string; region: (typeof REGIONS)[number] };

const DISTRIBUTORS: DistDef[] = [
  { id: 4101, ad: "Marmara Gıda Dağıtım A.Ş.", region: "MARMARA" },
  { id: 4102, ad: "Trakya Perakende Toptan", region: "MARMARA" },
  { id: 4103, ad: "Ege Toptan Gıda Ltd.", region: "EGE" },
  { id: 4104, ad: "Ege Sahil Dağıtım", region: "EGE" },
  { id: 4105, ad: "Anadolu Ticaret Dağıtım", region: "ANADOLU" },
  { id: 4106, ad: "Orta Anadolu Toptan A.Ş.", region: "ANADOLU" },
  { id: 4107, ad: "Akdeniz FMCG Lojistik", region: "AKDENİZ" },
  { id: 4108, ad: "Çukurova Gıda Dağıtım", region: "AKDENİZ" },
  { id: 4109, ad: "Güneydoğu Ticaret ve Dağıtım", region: "GÜNEYDOĞU" },
  { id: 4110, ad: "Fırat Gıda Toptan", region: "GÜNEYDOĞU" },
];

type ProductDef = {
  skuId: number;
  skuCode: string;
  skuName: string;
  brand: string | null;
  category: string;
  /** Ortalama günlük satış hacmi ölçeği — marka/kategoriye göre kaba büyüklük. */
  dailyScale: number;
};

// Karma branding — üst marka (uydurma) + generic kategori (private-label),
// seed-fmcg-demo.ts PRODUCT_FAMILIES ile aynı marka evreni, stok ekranına
// özgü paket-boyutu varyantlarıyla.
const PRODUCTS: ProductDef[] = [
  { skuId: 610001, skuCode: "CIKO-80G", skuName: "ÇİKOMASTER 80g", brand: "ÇİKOMASTER", category: "Çikolata & Şekerleme", dailyScale: 60 },
  { skuId: 610002, skuCode: "CIKO-32G-MINI", skuName: "ÇİKOMASTER 32g Mini", brand: "ÇİKOMASTER", category: "Çikolata & Şekerleme", dailyScale: 140 },
  { skuId: 610003, skuCode: "GOF-5LI", skuName: "GOFRETKING 5'li Paket", brand: "GOFRETKING", category: "Bisküvi & Gofret", dailyScale: 90 },
  { skuId: 610004, skuCode: "GOF-40G-TEK", skuName: "GOFRETKING Tekli 40g", brand: "GOFRETKING", category: "Bisküvi & Gofret", dailyScale: 180 },
  { skuId: 610005, skuCode: "KAHL-200G", skuName: "KAHVELİDER 200g", brand: "KAHVELİDER", category: "Kahve & İçecek Toz", dailyScale: 35 },
  { skuId: 610006, skuCode: "KAHL-100G-STK", skuName: "KAHVELİDER 100g Stick", brand: "KAHVELİDER", category: "Kahve & İçecek Toz", dailyScale: 70 },
  { skuId: 610007, skuCode: "CIKB-150G", skuName: "ÇIKIRBİS 150g", brand: "ÇIKIRBİS", category: "Bisküvi & Gofret", dailyScale: 120 },
  { skuId: 610008, skuCode: "MISK-90G", skuName: "MISIRKING 90g", brand: "MISIRKING", category: "Atıştırmalık", dailyScale: 100 },
  { skuId: 610009, skuCode: "TAMM-1L", skuName: "TAMMAVİ 1L", brand: "TAMMAVİ", category: "Süt Mamulleri (UHT)", dailyScale: 150 },
  { skuId: 610010, skuCode: "TMYL-750ML", skuName: "TEMİZ-YOL 750ml", brand: "TEMİZ-YOL", category: "Temizlik & Bakım", dailyScale: 55 },
  { skuId: 610011, skuCode: "JELS-80G", skuName: "JELSTAR 80g", brand: "JELSTAR", category: "Jöle & Şekerleme", dailyScale: 200 },
  { skuId: 610012, skuCode: "KONS-FAS-400G", skuName: "Konserve Fasulye 400g", brand: null, category: "Konserve & Bakliyat", dailyScale: 90 },
  { skuId: 610013, skuCode: "ATIS-MIX-100G", skuName: "Atıştırmalık Mix 100g", brand: null, category: "Atıştırmalık (private label)", dailyScale: 130 },
  { skuId: 610014, skuCode: "CAY-SIYAH-500G", skuName: "Siyah Çay 500g", brand: null, category: "Çay & Hot Drink", dailyScale: 45 },
];

type Archetype = "critical" | "risk" | "watch" | "healthy" | "unknown";

/**
 * SKU × distribütör satırı üretir. `riskTierFor` (wietnauer-stok.ts satır
 * ~337) eşikleriyle birebir tutarlı `daysLeft` aralıkları seçilir ki
 * `riskTier` alanı gerçek sistemle aynı mantıkla türemiş olsun:
 *   critical ≤7g · risk ≤14g · watch ≤30g · healthy >30g · unknown = sinyal yok.
 */
function buildRow(product: ProductDef, dist: DistDef): WietnauerStockSkuRow {
  const archetype = pickWeighted<Archetype>([
    { item: "critical", weight: 15 },
    { item: "risk", weight: 20 },
    { item: "watch", weight: 25 },
    { item: "healthy", weight: 35 },
    { item: "unknown", weight: 5 },
  ]);

  const demandPattern: DemandPattern =
    archetype === "unknown"
      ? "unknown"
      : pickWeighted<DemandPattern>([
          { item: "smooth", weight: 40 },
          { item: "intermittent", weight: 30 },
          { item: "erratic", weight: 20 },
          { item: "lumpy", weight: 10 },
        ]);

  // md42 talep penceresi 180g (DEMAND_WINDOW_DAYS) — demandDays180/avgDemandInterval
  // demandPattern ile tutarlı (adi<1.32 ⇔ demandDays180>136.4, cv2 eşiği 0.49).
  const isLowInterval = demandPattern === "intermittent" || demandPattern === "lumpy";
  const isHighCv2 = demandPattern === "erratic" || demandPattern === "lumpy";
  const demandDays180 = archetype === "unknown" ? 0 : isLowInterval ? randInt(30, 130) : randInt(140, 178);
  const avgDemandInterval = demandDays180 > 0 ? round(180 / demandDays180, 2) : null;
  const demandCv2 =
    archetype === "unknown" ? null : round(isHighCv2 ? randFloat(0.5, 1.2) : randFloat(0.05, 0.48), 3);

  if (archetype === "unknown") {
    // Depo/fatura/hareket sinyali yok — riskTierFor onHandQty<=0 dalına düşer.
    const lastInboundDate = rand() < 0.5 ? addDaysIso(ANCHOR_DATE, -randInt(90, 260)) : null;
    const lastInboundDays = lastInboundDate ? daysBetweenIso(lastInboundDate, ANCHOR_DATE) : null;
    const leadTimeDays = 14;
    const dataQuality: StockDataQuality = "no-stock-signal";
    let score = 100 - 35; // dataQuality no-stock-signal
    score -= 15; // demandPattern "unknown"
    score -= lastInboundDays == null ? 15 : lastInboundDays > 180 ? 20 : lastInboundDays > 90 ? 10 : 0;
    score = round(Math.min(100, Math.max(0, score)));
    const stockConfidence: StockConfidence = score >= 75 ? "high" : score >= 50 ? "medium" : "low";

    return {
      skuId: product.skuId,
      skuCode: product.skuCode,
      skuName: product.skuName,
      brand: product.brand,
      category: product.category,
      distId: dist.id,
      distName: dist.ad,
      region: dist.region,
      onHandQty: 0,
      soldQty90d: 0,
      avgDailyQty: 0,
      soldQty180d: 0,
      demandDays180: 0,
      avgDemandInterval: null,
      demandCv2: null,
      demandPattern: "unknown",
      crostonDailyQty: 0,
      trendFactor: 1,
      seasonalityFactor: 1,
      seasonalityReason: null,
      forecastDailyQty: 0,
      daysLeft: null,
      estimatedStockoutDate: null,
      turnover90d: null,
      stockStartQty: 0,
      stockEndQty: 0,
      avgStockQty: 0,
      openOrderQty: 0,
      inventoryPositionQty: 0,
      projectedDaysLeft: null,
      projectedStockoutDate: null,
      lastInboundDate,
      lastInboundDays,
      leadTimeDays,
      leadTimeSource: "default",
      safetyStockQty: 0,
      reorderPointQty: 0,
      reorderGapQty: 0,
      stockConfidence,
      stockConfidenceScore: score,
      netSignalPct: null,
      lowConfidence: false,
      riskTier: "unknown",
      dataQuality,
    };
  }

  const daysLeftTarget =
    archetype === "critical"
      ? randFloat(1, 7)
      : archetype === "risk"
        ? randFloat(7.5, 14)
        : archetype === "watch"
          ? randFloat(14.5, 30)
          : randFloat(31, 120);

  // Marka/kategori ölçeğine + bölgesel dalgalanmaya göre günlük talep, sonra
  // stok = talep × hedef kalan gün (riskTier eşikleriyle tutarlı daysLeft).
  const forecastDailyQty = round(product.dailyScale * randFloat(0.5, 1.8), 3);
  const onHandQty = round(forecastDailyQty * daysLeftTarget);
  const daysLeft = round(onHandQty / forecastDailyQty, 1);

  const trendFactor = round(Math.min(2, Math.max(0.5, randFloat(0.6, 1.7))), 2);
  const seasonalityFactor = 1; // ANCHOR_DATE (17 Nis) Ramazan/yaz/Aralık pencerelerinin dışında.
  const seasonalityReason: string | null = null;
  // forecastDailyQty = crostonDailyQty × trendFactor × seasonalityFactor
  const crostonDailyQty = round(forecastDailyQty / trendFactor / seasonalityFactor, 3);
  const soldQty180d = round(crostonDailyQty * 180);
  const soldQty90d = round(soldQty180d * randFloat(0.42, 0.58));
  const avgDailyQty = round(soldQty90d / 90, 3);

  const stockStartQty = round(onHandQty + soldQty90d * randFloat(0.85, 1.2));
  const stockEndQty = onHandQty;
  const avgStockQty = round((stockStartQty + stockEndQty) / 2);
  const turnover90d = avgStockQty > 0 ? round(soldQty90d / avgStockQty, 3) : null;

  const hasOpenOrder = rand() < 0.35;
  const openOrderQty = hasOpenOrder ? round(forecastDailyQty * randFloat(5, 20)) : 0;
  const inventoryPositionQty = onHandQty + openOrderQty;
  const projectedDaysLeft = round(inventoryPositionQty / forecastDailyQty, 1);
  const projectedStockoutDate = addDaysIso(ANCHOR_DATE, Math.ceil(projectedDaysLeft));
  const estimatedStockoutDate = addDaysIso(ANCHOR_DATE, Math.ceil(daysLeft));

  const distTable = rand() < 0.7;
  const leadTimeDays = distTable ? randInt(7, 30) : 14;
  const leadTimeSource: LeadTimeSource = distTable ? "dist-table" : "default";
  const dailyDemandStd = avgDailyQty * randFloat(0.15, 0.45);
  const safetyStockQty = round(1.65 * dailyDemandStd * Math.sqrt(leadTimeDays));
  const reorderPointQty = round(forecastDailyQty * leadTimeDays + safetyStockQty);
  const reorderGapQty = round(Math.max(0, reorderPointQty - inventoryPositionQty));

  const hasInbound = rand() < 0.9;
  const lastInboundDate = hasInbound ? addDaysIso(ANCHOR_DATE, -randInt(1, 200)) : null;
  const lastInboundDays = lastInboundDate ? daysBetweenIso(lastInboundDate, ANCHOR_DATE) : null;

  // %12 ihtimalle (yalnız critical/risk) kırılgan net-sinyal örneği (md — LOW_CONFIDENCE_RATIO %2).
  const isFragileCandidate = (archetype === "critical" || archetype === "risk") && rand() < 0.12;
  const netSignalPct = isFragileCandidate ? round(randFloat(0.1, 1.9), 2) : round(randFloat(5, 80), 2);
  const lowConfidence = isFragileCandidate;

  const dataQuality: StockDataQuality = "ok";
  let score = 100;
  if (lowConfidence) score -= 30;
  if (demandPattern === "lumpy") score -= 25;
  else if (demandPattern === "erratic") score -= 18;
  else if (demandPattern === "intermittent") score -= 10;
  if (lastInboundDays == null) score -= 15;
  else if (lastInboundDays > 180) score -= 20;
  else if (lastInboundDays > 90) score -= 10;
  if (netSignalPct / 100 >= 0.08) score += 5;
  score = round(Math.min(100, Math.max(0, score)));
  const stockConfidence: StockConfidence = score >= 75 ? "high" : score >= 50 ? "medium" : "low";

  const riskTier: StockRiskTier = archetype;

  return {
    skuId: product.skuId,
    skuCode: product.skuCode,
    skuName: product.skuName,
    brand: product.brand,
    category: product.category,
    distId: dist.id,
    distName: dist.ad,
    region: dist.region,
    onHandQty,
    soldQty90d,
    avgDailyQty,
    soldQty180d,
    demandDays180,
    avgDemandInterval,
    demandCv2,
    demandPattern,
    crostonDailyQty,
    trendFactor,
    seasonalityFactor,
    seasonalityReason,
    forecastDailyQty,
    daysLeft,
    estimatedStockoutDate,
    turnover90d,
    stockStartQty,
    stockEndQty,
    avgStockQty,
    openOrderQty,
    inventoryPositionQty,
    projectedDaysLeft,
    projectedStockoutDate,
    lastInboundDate,
    lastInboundDays,
    leadTimeDays,
    leadTimeSource,
    safetyStockQty,
    reorderPointQty,
    reorderGapQty,
    stockConfidence,
    stockConfidenceScore: score,
    netSignalPct,
    lowConfidence,
    riskTier,
    dataQuality,
  };
}

const allRows: WietnauerStockSkuRow[] = PRODUCTS.flatMap((product) =>
  DISTRIBUTORS.map((dist) => buildRow(product, dist)),
);

// ---------- Bundle & seed fonksiyonu ----------------------------------------

/**
 * `wietnauer-stok` cache domaininde, demo isteğinin (dateFrom/dateTo=null →
 * demandWindow.custom=false) okuyacağı KESIN anahtar altında
 * `WietnauerStockCacheBundle` şeklinde bir snapshot yazar.
 *
 * Cache anahtarı: "v5-90g-all" = `${CACHE_VERSION}-${WINDOW_DAYS}g-all`
 *   (bkz. dosya üstü yorum + kaynak doğrulaması — wietnauer-stok.ts satır ~938-940).
 */
export function seedStok(): void {
  const bundle: WietnauerStockCacheBundle = {
    allRows,
    emptySnapshotTables: false,
    generatedAt: new Date().toISOString(),
  };
  cachedWrite("wietnauer-stok", "v5-90g-all", bundle, 900);
}

// Doğrudan `npx tsx tools/demo-seed/stok.ts` ile çalıştırılırsa seed'i uygula.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedStok();
  // eslint-disable-next-line no-console
  console.log("[seed-stok] wietnauer-stok / v5-90g-all yazıldı.");
}
