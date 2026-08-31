/**
 * FMCG Demo seed — karma FMCG dummy data oluşturur.
 *
 *   TENANT=fmcg-demo npx tsx tools/seed-fmcg-demo.ts
 *
 * Üretilenler:
 *   - 2000 fake bakkal/market/horeca customer (81 il, nüfus-ağırlıklı dağılım)
 *   - Gerçekçi ciro/risk dağılımı (~%18 kritik / %28 risk / %39 watch / %15 sağlıklı)
 *   - 50 fake distribütör
 *   - Bölge bazlı satış sayıları
 *   - Komuta snapshot (KPIs, region, channel mix, monthly trend, matrix,
 *     heatmap, reps, portfolio, brief) — `cache_entries`'e direkt yazılır
 *   - sync_state timestamp (UI "az önce senkronlandı" gösterir)
 *
 * Schema = Pernod canlı sync ile birebir aynı (`map_customers` kolonları).
 * UI hiçbir tenant-koşul bilmiyor; sadece data farklı.
 *
 * Tek dosya zorunluluğu: TENANT=fmcg-demo olmadan çalışırsa Pernod DB'sini
 * silebilirdi. Bu yüzden script başında env check var.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getLocalDb,
  getTenantConfig,
  cachedWrite,
  computeCustomerRiskScore,
  type KomutaSnapshot,
  type KomutaKpiCard,
  type KomutaRegionRow,
  type KomutaChannelSlice,
  type KomutaChannelMonthlyRow,
  type KomutaMonthlyBar,
  type KomutaMatrixRow,
  type KomutaHeatmapRow,
  type KomutaHeatmapCell,
  type KomutaRep,
  type KomutaTopDist,
  type KomutaPortfolioRow,
  type ProductTier,
  type RiskTier,
} from "@enroute/core";

// ---------- Sabitler & yardımcılar ------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

// Deterministik PRNG — her seed çalıştırması aynı sonuç (xorshift32).
// `Math.random` yerine bu kullanılır → demo'da rakamlar stabil, ekran
// screenshotları arasında değişmez.
function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000_000) / 1_000_000_000;
  };
}
const rng = makeRng(20260601);
const rand = (min: number, max: number) => min + rng() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
/**
 * TR-il adını geojson normalize formuna çevir — UPPER + diacritic strip.
 * "İstanbul" → "ISTANBUL", "Şanlıurfa" → "SANLIURFA". Komuta city breakdown
 * sehirNorm bu format olmalı ki TurkeyMapPolygon il polygon'larıyla eşleşsin.
 */
function normalizeSehir(s: string): string {
  return s
    .replace(/İ/g, "I").replace(/ı/g, "I")
    .replace(/Ş/g, "S").replace(/ş/g, "S")
    .replace(/Ğ/g, "G").replace(/ğ/g, "G")
    .replace(/Ü/g, "U").replace(/ü/g, "U")
    .replace(/Ö/g, "O").replace(/ö/g, "O")
    .replace(/Ç/g, "C").replace(/ç/g, "C")
    .toUpperCase().trim();
}

function pickWeighted<T>(arr: readonly { item: T; weight: number }[]): T {
  const total = arr.reduce((a, b) => a + b.weight, 0);
  let r = rng() * total;
  for (const { item, weight } of arr) {
    r -= weight;
    if (r <= 0) return item;
  }
  return arr[arr.length - 1]!.item;
}

// ---------- 81 il + nüfus ağırlıkları + bölge -------------------------------

type CityRow = {
  sehir: string; // upper, diacritic-strip
  display: string; // canonical (UI'da görünen)
  region: string;
  weight: number; // TÜİK 2023 nüfusa yakın oran
  lat: number;
  lng: number;
};

// Nüfus-ağırlıklı 81 il listesi. Weight'lar TÜİK 2023'e gevşek dayalı
// (kısaltılmış — demo için %1 hata payı yeter). lat/lng il merkezi.
const CITIES: readonly CityRow[] = [
  { sehir: "ISTANBUL", display: "İstanbul", region: "Marmara", weight: 18.5, lat: 41.0, lng: 28.95 },
  { sehir: "ANKARA", display: "Ankara", region: "İç Anadolu", weight: 6.8, lat: 39.93, lng: 32.86 },
  { sehir: "IZMIR", display: "İzmir", region: "Ege", weight: 5.4, lat: 38.42, lng: 27.14 },
  { sehir: "BURSA", display: "Bursa", region: "Marmara", weight: 3.6, lat: 40.18, lng: 29.06 },
  { sehir: "ANTALYA", display: "Antalya", region: "Akdeniz", weight: 3.2, lat: 36.9, lng: 30.7 },
  { sehir: "ADANA", display: "Adana", region: "Akdeniz", weight: 2.7, lat: 37.0, lng: 35.32 },
  { sehir: "KONYA", display: "Konya", region: "İç Anadolu", weight: 2.6, lat: 37.87, lng: 32.49 },
  { sehir: "GAZIANTEP", display: "Gaziantep", region: "Güneydoğu Anadolu", weight: 2.5, lat: 37.07, lng: 37.38 },
  { sehir: "SANLIURFA", display: "Şanlıurfa", region: "Güneydoğu Anadolu", weight: 2.4, lat: 37.17, lng: 38.79 },
  { sehir: "KOCAELI", display: "Kocaeli", region: "Marmara", weight: 2.3, lat: 40.85, lng: 29.88 },
  { sehir: "MERSIN", display: "Mersin", region: "Akdeniz", weight: 2.1, lat: 36.8, lng: 34.63 },
  { sehir: "DIYARBAKIR", display: "Diyarbakır", region: "Güneydoğu Anadolu", weight: 2.0, lat: 37.91, lng: 40.23 },
  { sehir: "HATAY", display: "Hatay", region: "Akdeniz", weight: 1.8, lat: 36.4, lng: 36.13 },
  { sehir: "MANISA", display: "Manisa", region: "Ege", weight: 1.7, lat: 38.61, lng: 27.43 },
  { sehir: "KAYSERI", display: "Kayseri", region: "İç Anadolu", weight: 1.7, lat: 38.73, lng: 35.48 },
  { sehir: "SAMSUN", display: "Samsun", region: "Karadeniz", weight: 1.6, lat: 41.28, lng: 36.33 },
  { sehir: "BALIKESIR", display: "Balıkesir", region: "Marmara", weight: 1.5, lat: 39.65, lng: 27.88 },
  { sehir: "KAHRAMANMARAS", display: "Kahramanmaraş", region: "Akdeniz", weight: 1.4, lat: 37.58, lng: 36.93 },
  { sehir: "VAN", display: "Van", region: "Doğu Anadolu", weight: 1.4, lat: 38.5, lng: 43.4 },
  { sehir: "AYDIN", display: "Aydın", region: "Ege", weight: 1.4, lat: 37.85, lng: 27.85 },
  { sehir: "DENIZLI", display: "Denizli", region: "Ege", weight: 1.3, lat: 37.78, lng: 29.09 },
  { sehir: "SAKARYA", display: "Sakarya", region: "Marmara", weight: 1.3, lat: 40.78, lng: 30.4 },
  { sehir: "MUGLA", display: "Muğla", region: "Ege", weight: 1.2, lat: 37.22, lng: 28.36 },
  { sehir: "TEKIRDAG", display: "Tekirdağ", region: "Marmara", weight: 1.2, lat: 40.98, lng: 27.51 },
  { sehir: "ESKISEHIR", display: "Eskişehir", region: "İç Anadolu", weight: 1.2, lat: 39.78, lng: 30.52 },
  { sehir: "MARDIN", display: "Mardin", region: "Güneydoğu Anadolu", weight: 1.0, lat: 37.31, lng: 40.74 },
  { sehir: "TRABZON", display: "Trabzon", region: "Karadeniz", weight: 1.0, lat: 41.0, lng: 39.72 },
  { sehir: "MALATYA", display: "Malatya", region: "Doğu Anadolu", weight: 0.95, lat: 38.35, lng: 38.32 },
  { sehir: "ERZURUM", display: "Erzurum", region: "Doğu Anadolu", weight: 0.93, lat: 39.9, lng: 41.27 },
  { sehir: "ORDU", display: "Ordu", region: "Karadeniz", weight: 0.92, lat: 40.98, lng: 37.88 },
  { sehir: "AFYONKARAHISAR", display: "Afyonkarahisar", region: "Ege", weight: 0.87, lat: 38.76, lng: 30.54 },
  { sehir: "ADIYAMAN", display: "Adıyaman", region: "Güneydoğu Anadolu", weight: 0.78, lat: 37.76, lng: 38.28 },
  { sehir: "SIVAS", display: "Sivas", region: "İç Anadolu", weight: 0.74, lat: 39.75, lng: 37.02 },
  { sehir: "AGRI", display: "Ağrı", region: "Doğu Anadolu", weight: 0.65, lat: 39.72, lng: 43.06 },
  { sehir: "TOKAT", display: "Tokat", region: "Karadeniz", weight: 0.71, lat: 40.31, lng: 36.55 },
  { sehir: "ZONGULDAK", display: "Zonguldak", region: "Karadeniz", weight: 0.7, lat: 41.45, lng: 31.79 },
  { sehir: "KUTAHYA", display: "Kütahya", region: "Ege", weight: 0.69, lat: 39.42, lng: 29.99 },
  { sehir: "ELAZIG", display: "Elazığ", region: "Doğu Anadolu", weight: 0.69, lat: 38.68, lng: 39.23 },
  { sehir: "BATMAN", display: "Batman", region: "Güneydoğu Anadolu", weight: 0.69, lat: 37.88, lng: 41.13 },
  { sehir: "KONYAALTI", display: "Konya", region: "İç Anadolu", weight: 0.0, lat: 0, lng: 0 }, // placeholder
  { sehir: "OSMANIYE", display: "Osmaniye", region: "Akdeniz", weight: 0.62, lat: 37.07, lng: 36.25 },
  { sehir: "GIRESUN", display: "Giresun", region: "Karadeniz", weight: 0.51, lat: 40.92, lng: 38.39 },
  { sehir: "CORUM", display: "Çorum", region: "Karadeniz", weight: 0.62, lat: 40.55, lng: 34.95 },
  { sehir: "MUS", display: "Muş", region: "Doğu Anadolu", weight: 0.48, lat: 38.74, lng: 41.5 },
  { sehir: "ISPARTA", display: "Isparta", region: "Akdeniz", weight: 0.51, lat: 37.76, lng: 30.55 },
  { sehir: "DUZCE", display: "Düzce", region: "Karadeniz", weight: 0.47, lat: 40.84, lng: 31.16 },
  { sehir: "USAK", display: "Uşak", region: "Ege", weight: 0.45, lat: 38.68, lng: 29.41 },
  { sehir: "BITLIS", display: "Bitlis", region: "Doğu Anadolu", weight: 0.41, lat: 38.4, lng: 42.11 },
  { sehir: "EDIRNE", display: "Edirne", region: "Marmara", weight: 0.5, lat: 41.68, lng: 26.56 },
  { sehir: "BOLU", display: "Bolu", region: "Karadeniz", weight: 0.39, lat: 40.74, lng: 31.61 },
  { sehir: "AKSARAY", display: "Aksaray", region: "İç Anadolu", weight: 0.5, lat: 38.37, lng: 34.03 },
  { sehir: "RIZE", display: "Rize", region: "Karadeniz", weight: 0.39, lat: 41.03, lng: 40.51 },
  { sehir: "SIIRT", display: "Siirt", region: "Güneydoğu Anadolu", weight: 0.38, lat: 37.93, lng: 41.94 },
  { sehir: "AMASYA", display: "Amasya", region: "Karadeniz", weight: 0.39, lat: 40.65, lng: 35.83 },
  { sehir: "ERZINCAN", display: "Erzincan", region: "Doğu Anadolu", weight: 0.28, lat: 39.74, lng: 39.49 },
  { sehir: "CANAKKALE", display: "Çanakkale", region: "Marmara", weight: 0.6, lat: 40.15, lng: 26.41 },
  { sehir: "KASTAMONU", display: "Kastamonu", region: "Karadeniz", weight: 0.45, lat: 41.39, lng: 33.78 },
  { sehir: "NIGDE", display: "Niğde", region: "İç Anadolu", weight: 0.43, lat: 37.97, lng: 34.68 },
  { sehir: "BURDUR", display: "Burdur", region: "Akdeniz", weight: 0.32, lat: 37.72, lng: 30.29 },
  { sehir: "HAKKARI", display: "Hakkari", region: "Doğu Anadolu", weight: 0.32, lat: 37.57, lng: 43.74 },
  { sehir: "SIRNAK", display: "Şırnak", region: "Güneydoğu Anadolu", weight: 0.6, lat: 37.51, lng: 42.46 },
  { sehir: "KARS", display: "Kars", region: "Doğu Anadolu", weight: 0.28, lat: 40.6, lng: 43.1 },
  { sehir: "YOZGAT", display: "Yozgat", region: "İç Anadolu", weight: 0.49, lat: 39.82, lng: 34.81 },
  { sehir: "NEVSEHIR", display: "Nevşehir", region: "İç Anadolu", weight: 0.36, lat: 38.62, lng: 34.71 },
  { sehir: "KIRKLARELI", display: "Kırklareli", region: "Marmara", weight: 0.41, lat: 41.74, lng: 27.22 },
  { sehir: "YALOVA", display: "Yalova", region: "Marmara", weight: 0.32, lat: 40.65, lng: 29.27 },
  { sehir: "BILECIK", display: "Bilecik", region: "Marmara", weight: 0.27, lat: 40.06, lng: 30.07 },
  { sehir: "SINOP", display: "Sinop", region: "Karadeniz", weight: 0.25, lat: 42.02, lng: 35.15 },
  { sehir: "BARTIN", display: "Bartın", region: "Karadeniz", weight: 0.24, lat: 41.64, lng: 32.34 },
  { sehir: "BINGOL", display: "Bingöl", region: "Doğu Anadolu", weight: 0.32, lat: 39.06, lng: 40.5 },
  { sehir: "KILIS", display: "Kilis", region: "Güneydoğu Anadolu", weight: 0.18, lat: 36.72, lng: 37.12 },
  { sehir: "KARAMAN", display: "Karaman", region: "İç Anadolu", weight: 0.31, lat: 37.18, lng: 33.21 },
  { sehir: "CANKIRI", display: "Çankırı", region: "İç Anadolu", weight: 0.23, lat: 40.6, lng: 33.62 },
  { sehir: "GUMUSHANE", display: "Gümüşhane", region: "Karadeniz", weight: 0.17, lat: 40.45, lng: 39.48 },
  { sehir: "ARTVIN", display: "Artvin", region: "Karadeniz", weight: 0.19, lat: 41.18, lng: 41.82 },
  { sehir: "KIRIKKALE", display: "Kırıkkale", region: "İç Anadolu", weight: 0.32, lat: 39.84, lng: 33.51 },
  { sehir: "KIRSEHIR", display: "Kırşehir", region: "İç Anadolu", weight: 0.27, lat: 39.15, lng: 34.16 },
  { sehir: "IGDIR", display: "Iğdır", region: "Doğu Anadolu", weight: 0.24, lat: 39.92, lng: 44.04 },
  { sehir: "ARDAHAN", display: "Ardahan", region: "Doğu Anadolu", weight: 0.11, lat: 41.11, lng: 42.7 },
  { sehir: "BAYBURT", display: "Bayburt", region: "Karadeniz", weight: 0.1, lat: 40.26, lng: 40.22 },
  { sehir: "TUNCELI", display: "Tunceli", region: "Doğu Anadolu", weight: 0.1, lat: 39.11, lng: 39.55 },
  { sehir: "KARABUK", display: "Karabük", region: "Karadeniz", weight: 0.27, lat: 41.2, lng: 32.62 },
];

// ---------- Müşteri & marka isim havuzları ---------------------------------

const COMPANY_NAME_HEADS = [
  "ASLAN", "GÜVEN", "ALTIN", "ZAFER", "MAVİ", "ANADOLU", "EGE", "BAKLAVA",
  "GÜNEŞ", "AY", "YILDIZ", "DENIZ", "EMRE", "BÜYÜK", "SARP", "DOĞU",
  "BATU", "KARTAL", "BEREKET", "ÖZ", "BEKİR", "AKDENİZ", "MARMARA",
  "CANER", "FATİH", "MERT", "OSMAN", "VEYSEL", "ÇINAR", "DEMİR", "PINAR",
  "TURGUT", "YEŞİL", "MOR", "CESUR", "USTA", "TARIM", "GIDA", "TİCARET",
];

const COMPANY_NAME_TAILS = [
  { tail: "MARKET", weight: 5 },
  { tail: "BAKKAL", weight: 4 },
  { tail: "MİNİ MARKET", weight: 4 },
  { tail: "GIDA", weight: 3 },
  { tail: "ŞARKÜTERİ", weight: 2 },
  { tail: "MARKETÇİLİK", weight: 2 },
  { tail: "TİCARET", weight: 2 },
  { tail: "SHOP", weight: 1 },
  { tail: "EXPRESS", weight: 1 },
  { tail: "PETROL & MARKET", weight: 1 },
  { tail: "BÜFE", weight: 2 },
  { tail: "KAFE & RESTORAN", weight: 1 },
  { tail: "OTEL & RESTORAN", weight: 1 },
  { tail: "OKUL KANTİNİ", weight: 1 },
  { tail: "PASTANE", weight: 1 },
];

const DISTRIBUTOR_NAMES = [
  "AKSAN GIDA DAĞITIM", "TAÇ DAĞITIM", "MAVİ DAĞITIM", "EGE GIDA",
  "ANADOLU TİCARET", "PINAR DAĞITIM", "GÜNDOĞAN GIDA", "BEREKET GIDA",
  "ALTIN DAĞITIM", "MARMARA TİCARET", "YILDIZ GIDA", "DOĞU GIDA",
  "BATI DAĞITIM", "GÜNEŞ GIDA", "ÇINAR DAĞITIM", "GÜVEN TİCARET",
  "USTA GIDA", "DENIZ GIDA", "ASLAN TİCARET", "EMRE DAĞITIM",
  "BÜYÜK GIDA", "FATİH GIDA", "OSMAN TİCARET", "CESUR GIDA",
  "ANATOLİA FOODS", "TURKDAY DAĞITIM", "PIRAMIT GIDA", "ZAFER TİCARET",
  "AY YILDIZ GIDA", "GÜNEŞ DAĞITIM",
];

// Karma branding — top-tier SKU'lar uydurma marka, alt-tier'lar generic
// kategori adı (kullanıcı tercihi: "ortaya karışık").
type ProductFamily = {
  brand: string | null;
  category: string;
  tier: ProductTier;
  /** Bu kategorinin sektör payı (matrix/portfolio ağırlığı için) */
  weight: number;
};

const PRODUCT_FAMILIES: readonly ProductFamily[] = [
  // Top brands (uydurma marka isimleri) — tier premium/luxury
  { brand: "ÇİKOMASTER", category: "Çikolata & Şekerleme", tier: "premium", weight: 18 },
  { brand: "GOFRETKING", category: "Bisküvi & Gofret", tier: "premium", weight: 14 },
  { brand: "KAHVELİDER", category: "Kahve & İçecek Toz", tier: "luxury", weight: 8 },
  { brand: "ÇIKIRBİS", category: "Bisküvi & Gofret", tier: "core", weight: 11 },
  { brand: "MISIRKING", category: "Atıştırmalık", tier: "premium", weight: 9 },
  { brand: "TAMMAVİ", category: "Süt Mamulleri (UHT)", tier: "core", weight: 8 },
  // Mid-tier — kısmen markalı
  { brand: "TEMİZ-YOL", category: "Temizlik & Bakım", tier: "core", weight: 9 },
  { brand: "JELSTAR", category: "Jöle & Şekerleme", tier: "value", weight: 5 },
  // Generic kategori (uydurma marka yok) — value tier
  { brand: null, category: "Konserve & Bakliyat", tier: "value", weight: 5 },
  { brand: null, category: "Atıştırmalık (private label)", tier: "value", weight: 7 },
  { brand: null, category: "Çay & Hot Drink", tier: "core", weight: 6 },
];

const CHANNEL_TYPES = [
  { name: "Zincir Market", color: "#6366f1", share: 0.32 },
  { name: "Bakkal", color: "#16a34a", share: 0.25 },
  { name: "Mini Market", color: "#0891b2", share: 0.18 },
  { name: "Horeca", color: "#d97706", share: 0.10 },
  { name: "Okul Kantini", color: "#9333ea", share: 0.07 },
  { name: "Hipermarket", color: "#84cc16", share: 0.05 },
  { name: "Diğer", color: "#78716c", share: 0.03 },
];

// ---------- Müşteri üretimi -------------------------------------------------

type Customer = {
  id: number;
  distKod: number;
  unvan: string;
  kisaAd: string;
  adres: string;
  sehir: string;
  ilce: string;
  distributor: string;
  bolge: string;
  lat: number;
  lng: number;
  hasSales: boolean;
  daysSinceLastSale: number | null;
  daysSinceLastVisit: number | null;
  ciro30d: number;
  ciroPrev30d: number;
  ciroT90: number;
  ciroYoy30d: number;
  fatura30d: number;
  faturaPrev30d: number;
  faturaT90: number;
  urunGrup30d: number;
  urunGrupPrev30d: number;
  ziyaret90d: number;
};

function generateCompanyName(): string {
  const head = pick(COMPANY_NAME_HEADS);
  const tail = pickWeighted(COMPANY_NAME_TAILS.map((t) => ({ item: t.tail, weight: t.weight })));
  // %20 olasılıkla 2-kelime head ("AY YILDIZ" gibi)
  if (rng() < 0.2) {
    const head2 = pick(COMPANY_NAME_HEADS);
    return `${head} ${head2} ${tail}`;
  }
  return `${head} ${tail}`;
}

function generateCustomers(count: number): Customer[] {
  const customers: Customer[] = [];
  for (let i = 0; i < count; i++) {
    const city = pickWeighted(
      CITIES.filter((c) => c.weight > 0).map((c) => ({ item: c, weight: c.weight })),
    );
    // İl merkezi etrafında küçük random offset (~5-15 km radius)
    const lat = city.lat + (rng() - 0.5) * 0.25;
    const lng = city.lng + (rng() - 0.5) * 0.3;
    const distIdx = randInt(0, DISTRIBUTOR_NAMES.length - 1);
    const distributor = DISTRIBUTOR_NAMES[distIdx]!;
    const distKod = 1000 + distIdx;

    // Müşteri arketipi — hedef risk tier dağılımı: ~%15 critical, %25 risk,
    // %35 watch, %22 healthy, %3 unknown. Her arketip; momentum (ciroT90 vs
    // ciro30 ratio), engagement (ziyaret cadence) ve aktivite (satış varlığı)
    // sinyallerini farklı şekilde çakıştırır.
    type Archetype = "growing" | "stable" | "shrinking" | "fading" | "dormant";
    const archetype: Archetype = pickWeighted([
      { item: "growing" as const, weight: 22 },   // → healthy: T90 baseline < current
      { item: "stable" as const, weight: 30 },    // → healthy/watch: ~yatay
      { item: "shrinking" as const, weight: 28 }, // → watch/risk: T90 baseline > current (orta düşüş)
      { item: "fading" as const, weight: 12 },    // → risk/critical: hızlı düşüş + uzun ziyaret yok
      { item: "dormant" as const, weight: 8 },    // → critical: hiç satış yok 60+ gün
    ]);

    const hasSales = archetype !== "dormant";
    let ciro30d = 0;
    let ciroPrev30d = 0;
    let ciroT90 = 0;
    let ciroYoy30d = 0;
    let fatura30d = 0;
    let faturaPrev30d = 0;
    let faturaT90 = 0;
    let urunGrup30d = 0;
    let urunGrupPrev30d = 0;
    let daysSinceLastSale: number | null = null;

    // Pareto-ish ciro baseline — birkaç büyük müşteri çok, çoğu küçük
    const base = 5000 + Math.pow(rng(), 3) * 250000;

    switch (archetype) {
      case "growing": {
        // Aylık baseline = baseline × 0.7..0.9 → büyüme momentum'u
        ciro30d = Math.round(base);
        ciroT90 = Math.round(base * rand(2.0, 2.6)); // 3-ay/3 = 0.67-0.87 × current
        ciroPrev30d = Math.round(base / rand(1.05, 1.3));
        ciroYoy30d = Math.round(base / rand(1.1, 1.4));
        fatura30d = Math.max(2, Math.round(base / rand(800, 3000)));
        faturaPrev30d = Math.max(1, Math.round(ciroPrev30d / rand(800, 3000)));
        faturaT90 = fatura30d * randInt(2, 3);
        urunGrup30d = randInt(4, 8);
        urunGrupPrev30d = Math.max(2, urunGrup30d - randInt(0, 2));
        daysSinceLastSale = randInt(0, 14);
        break;
      }
      case "stable": {
        ciro30d = Math.round(base);
        ciroT90 = Math.round(base * rand(2.85, 3.15)); // yatay
        ciroPrev30d = Math.round(base * rand(0.92, 1.08));
        ciroYoy30d = Math.round(base * rand(0.9, 1.1));
        fatura30d = Math.max(1, Math.round(base / rand(1000, 4000)));
        faturaPrev30d = Math.max(1, Math.round(ciroPrev30d / rand(1000, 4000)));
        faturaT90 = fatura30d * 3;
        urunGrup30d = randInt(3, 6);
        urunGrupPrev30d = urunGrup30d + randInt(-1, 1);
        daysSinceLastSale = randInt(0, 21);
        break;
      }
      case "shrinking": {
        // Aylık baseline >> current → momentum belirgin negatif.
        // 3 sinyali birlikte tetikle (momentum + behavioral freq + basket):
        ciro30d = Math.round(base);
        ciroT90 = Math.round(base * rand(6, 9)); // t90Monthly = 2-3× current → drop %50-67
        ciroPrev30d = Math.round(base * rand(1.8, 2.6)); // YoY drop %44-62
        ciroYoy30d = Math.round(base * rand(1.5, 2.2));
        // Fatura sayısı yarıya düşmüş — behavioral.freqDrop %50
        faturaPrev30d = randInt(4, 8);
        fatura30d = Math.max(1, Math.floor(faturaPrev30d * rand(0.4, 0.7)));
        faturaT90 = faturaPrev30d * 2 + fatura30d;
        // Sepet daralması — behavioral.basketShrink %30+
        urunGrupPrev30d = randInt(4, 7);
        urunGrup30d = Math.max(1, urunGrupPrev30d - randInt(2, 3));
        daysSinceLastSale = randInt(14, 35);
        break;
      }
      case "fading": {
        // Hızlı düşüş — son satış var ama eski; tüm bileşenler yüksek.
        ciro30d = Math.round(base * rand(0.1, 0.3));
        ciroT90 = Math.round(base * rand(8, 12));
        ciroPrev30d = Math.round(base * rand(1.0, 1.6));
        ciroYoy30d = Math.round(base * rand(1.5, 2.5));
        faturaPrev30d = randInt(3, 6);
        fatura30d = randInt(0, 1);
        faturaT90 = faturaPrev30d + randInt(2, 4);
        urunGrupPrev30d = randInt(3, 6);
        urunGrup30d = randInt(0, 1);
        daysSinceLastSale = randInt(35, 75);
        break;
      }
      case "dormant": {
        daysSinceLastSale = randInt(60, 360);
        const oldBase = 2000 + Math.pow(rng(), 2) * 80000;
        ciroPrev30d = rng() < 0.3 ? Math.round(oldBase * 0.4) : 0;
        ciroYoy30d = Math.round(oldBase * rand(0.8, 1.2));
        ciroT90 = Math.round(oldBase * rand(0, 1.5));
        faturaPrev30d = ciroPrev30d > 0 ? randInt(1, 2) : 0;
        faturaT90 = randInt(0, 3);
        urunGrup30d = 0;
        urunGrupPrev30d = randInt(0, 3);
        break;
      }
    }

    // Ziyaret cadence — sahanın aktivitesi. Fading/dormant'ta seyrek;
    // diğerlerinde daha düzenli.
    let ziyaret90d: number;
    let daysSinceLastVisit: number | null;
    if (archetype === "dormant") {
      ziyaret90d = rng() < 0.7 ? 0 : 1;
      daysSinceLastVisit = rng() < 0.3 ? null : randInt(60, 200);
    } else if (archetype === "fading") {
      ziyaret90d = randInt(0, 2);
      daysSinceLastVisit = randInt(30, 90);
    } else {
      ziyaret90d = randInt(3, 8);
      daysSinceLastVisit = randInt(0, 30);
    }

    const unvan = generateCompanyName();
    const kisaAd = unvan.split(" ").slice(0, 2).join(" ");
    const adres = `${pick(COMPANY_NAME_HEADS)} Cad. No: ${randInt(1, 250)}`;
    const ilceCandidates = [
      `${city.display} Merkez`,
      `${pick(COMPANY_NAME_HEADS)} Mahallesi`,
    ];
    const ilce = pick(ilceCandidates);

    customers.push({
      id: 1_000_000 + i,
      distKod,
      unvan,
      kisaAd,
      adres,
      // Canonical mixed-case + diacritic'li il adı — geojson feature `name`
      // değeri ile birebir aynı format ("İstanbul", "Adana", "Şanlıurfa").
      // Map click handler `?sehir=<provName>` yazar → strict eşleşme için
      // DB'deki sehir de aynı formatta olmalı.
      sehir: city.display,
      ilce,
      distributor,
      bolge: city.region,
      lat,
      lng,
      hasSales,
      daysSinceLastSale,
      daysSinceLastVisit,
      ciro30d,
      ciroPrev30d,
      ciroT90,
      ciroYoy30d,
      fatura30d,
      faturaPrev30d,
      faturaT90,
      urunGrup30d,
      urunGrupPrev30d,
      ziyaret90d,
    });
  }
  return customers;
}

// ---------- Komuta snapshot üretimi ----------------------------------------

function generateKomutaSnapshot(customers: Customer[]): KomutaSnapshot {
  const totalCiro = customers.reduce((a, c) => a + c.ciro30d, 0);
  const totalCiroPrev = customers.reduce((a, c) => a + c.ciroPrev30d, 0);
  const totalFatura = customers.reduce((a, c) => a + c.fatura30d, 0);
  const aktifMusteri = customers.filter((c) => c.hasSales).length;
  const ortSepet = totalFatura > 0 ? totalCiro / totalFatura : 0;
  const yoyPct =
    totalCiroPrev > 0 ? ((totalCiro - totalCiroPrev) / totalCiroPrev) * 100 : null;

  const kpis: KomutaKpiCard[] = [
    {
      id: "ciro30",
      label: "Son 30g Ciro",
      value: totalCiro,
      format: "currency",
      delta: yoyPct ?? undefined,
      deltaSub: "vs önceki 30g",
    },
    {
      id: "fatura30",
      label: "Fatura Sayısı",
      value: totalFatura,
      format: "count",
      delta: rand(-8, 12),
      deltaSub: "vs önceki 30g",
    },
    {
      id: "aktif",
      label: "Aktif Müşteri",
      value: aktifMusteri,
      format: "count",
      delta: rand(-3, 5),
      deltaSub: `toplam ${customers.length}`,
    },
    {
      id: "ortsepet",
      label: "Ortalama Sepet",
      value: Math.round(ortSepet),
      format: "currency",
      delta: rand(-5, 8),
      deltaSub: "vs önceki 30g",
    },
  ];

  // Region aggregation
  const REGION_COLORS: Record<string, string> = {
    Marmara: "#6366f1",
    Ege: "#16a34a",
    Akdeniz: "#d97706",
    "İç Anadolu": "#9333ea",
    Karadeniz: "#0891b2",
    "Doğu Anadolu": "#dc2626",
    "Güneydoğu Anadolu": "#b45309",
    Kıbrıs: "#84cc16",
  };

  // Demo: bölge YoY'unu renk buketlerine YAY — gerçek data-birth artefaktında
  // hepsi negatif çıkıp harita tek renk (kırmızı) oluyordu. Sunum için canlı,
  // karışık bir tablo daha çarpıcı. deltaColor buketleri:
  //   +15+ yeşil · +5..15 açık yeşil · ±5 gri · -5..-15 turuncu · -15- kırmızı
  const REGION_YOY: Record<string, number> = {
    Marmara: 23.4,
    Akdeniz: 16.8,
    Kıbrıs: 12.0,
    Ege: 9.1,
    Karadeniz: 6.3,
    "İç Anadolu": -2.7,
    "Güneydoğu Anadolu": -11.5,
    "Doğu Anadolu": -19.2,
  };

  const byRegion = new Map<string, Customer[]>();
  for (const c of customers) {
    const arr = byRegion.get(c.bolge) ?? [];
    arr.push(c);
    byRegion.set(c.bolge, arr);
  }

  const regions: KomutaRegionRow[] = Array.from(byRegion.entries()).map(
    ([bolge, list]) => {
      const ciro = list.reduce((a, c) => a + c.ciro30d, 0);
      const ciroPrev = list.reduce((a, c) => a + c.ciroPrev30d, 0);
      const delta = ciroPrev > 0 ? ((ciro - ciroPrev) / ciroPrev) * 100 : null;
      // City breakdown
      const byCity = new Map<string, Customer[]>();
      for (const c of list) {
        const arr = byCity.get(c.sehir) ?? [];
        arr.push(c);
        byCity.set(c.sehir, arr);
      }
      const cities = Array.from(byCity.entries()).map(([sehir, cl]) => {
        const cityCiro = cl.reduce((a, c) => a + c.ciro30d, 0);
        const cityPrev = cl.reduce((a, c) => a + c.ciroPrev30d, 0);
        return {
          sehir, // canonical mixed-case ("İstanbul")
          // Geojson features.name normalize formuna karşılık gelmeli
          // (UPPER + diacritic-stripped) — TurkeyMapPolygon polygon eşleştirme
          // bu alanı kullanır.
          sehirNorm: normalizeSehir(sehir),
          ciro: cityCiro,
          ciroPrev: cityPrev,
          deltaPct:
            cityPrev > 0 ? ((cityCiro - cityPrev) / cityPrev) * 100 : null,
        };
      });
      // Bölge YoY'unu renk-dağıtımlı hedefe çek; ciroPrev'i tutarlı geri-hesapla.
      const targetYoy = REGION_YOY[bolge] ?? delta;
      const ciroPrevAdj =
        targetYoy != null ? Math.round(ciro / (1 + targetYoy / 100)) : ciroPrev;
      return {
        bolge,
        ciro,
        ciroPrev: ciroPrevAdj,
        deltaPct: targetYoy,
        color: REGION_COLORS[bolge] ?? "#78716c",
        sehirler: Array.from(byCity.keys()),
        cities,
      };
    },
  );

  // Channel slice (channel mix donut)
  const channels: KomutaChannelSlice[] = CHANNEL_TYPES.map((ch) => ({
    name: ch.name,
    ciro: Math.round(totalCiro * ch.share),
    pct: ch.share * 100,
    color: ch.color,
  }));

  // Channel monthly — 12 ay stacked
  const channelMonthly: KomutaChannelMonthlyRow[] = [];
  const channelByType: KomutaChannelMonthlyRow[] = [];
  const now = new Date(2026, 3, 17); // demo date 17 Apr 2026
  for (let m = 11; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const ay = d.toLocaleString("tr-TR", { month: "short" });
    // Mevsimsellik — Ramazan (mart-nisan) ve bayram peak
    const isRamazan = d.getMonth() >= 2 && d.getMonth() <= 3;
    const seasonalBoost = isRamazan ? 1.18 : d.getMonth() >= 6 && d.getMonth() <= 8 ? 0.88 : 1.0;
    const monthlyBase = totalCiro * seasonalBoost * rand(0.85, 1.15);
    for (const ch of CHANNEL_TYPES) {
      channelMonthly.push({
        yyyymm,
        ay,
        kanal: ch.name,
        ciro: Math.round(monthlyBase * ch.share),
      });
      // channelByType (FMCG müşteri tipi segmentasyonu) — aynı yapı
      channelByType.push({
        yyyymm,
        ay,
        kanal: ch.name,
        ciro: Math.round(monthlyBase * ch.share * rand(0.95, 1.05)),
      });
    }
  }

  // Monthly trend — 24 ay (current year + prev year)
  const monthlyTrend: KomutaMonthlyBar[] = [];
  for (let m = 23; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const ay = d.toLocaleString("tr-TR", { month: "short" });
    const isRamazan = d.getMonth() >= 2 && d.getMonth() <= 3;
    const isSummer = d.getMonth() >= 6 && d.getMonth() <= 8;
    const isCurrent = m === 0;
    const ratio = isRamazan ? 1.22 : isSummer ? 0.85 : 1.0;
    const ciro = Math.round(totalCiro * ratio * rand(0.9, 1.1));
    const ciroPrev = m + 12 >= 24 ? null : Math.round(ciro * rand(0.78, 0.95));
    monthlyTrend.push({
      yyyymm,
      ay,
      ciro,
      ciroPrev,
      isRamazan,
      isCurrent,
      isSummer,
    });
  }

  // Matrix — ürün grubu × 5 dönem
  const matrix: KomutaMatrixRow[] = PRODUCT_FAMILIES.map((p) => {
    const buAy = Math.round((totalCiro * p.weight) / 100);
    const gecenAy = Math.round(buAy * rand(0.85, 1.1));
    const ucAyOnce = Math.round(buAy * rand(0.8, 1.15));
    const gecenYil = Math.round(buAy * rand(0.7, 1.05));
    const ikiYilOnce = Math.round(buAy * rand(0.6, 0.95));
    const yoyPct =
      gecenYil > 0 ? ((buAy - gecenYil) / gecenYil) * 100 : null;
    let trend: KomutaMatrixRow["trend"] = "flat";
    if (yoyPct !== null) {
      if (yoyPct > 20) trend = "rocket";
      else if (yoyPct > 5) trend = "up";
      else if (yoyPct < -5) trend = "down";
    }
    return {
      grup: p.brand ? `${p.brand} (${p.category})` : p.category,
      tier: p.tier,
      buAy,
      gecenAy,
      ucAyOnce,
      gecenYil,
      ikiYilOnce,
      yoyPct,
      trend,
    };
  });

  // Heatmap — region × ürün grubu YoY
  const heatmap: KomutaHeatmapRow[] = regions.map((r) => {
    const cells: KomutaHeatmapCell[] = PRODUCT_FAMILIES.map((p) => {
      const yoy = rand(-25, 30);
      let bucket: KomutaHeatmapCell["bucket"] = "flat";
      if (yoy > 20) bucket = "fire";
      else if (yoy > 10) bucket = "hot";
      else if (yoy > 3) bucket = "warm";
      else if (yoy < -15) bucket = "cold";
      else if (yoy < -5) bucket = "cool";
      return {
        bolge: r.bolge,
        grup: p.brand ? `${p.brand} (${p.category})` : p.category,
        yoyPct: yoy,
        bucket,
      };
    });
    const avg = cells.reduce((a, c) => a + (c.yoyPct ?? 0), 0) / cells.length;
    return {
      bolge: r.bolge,
      distSayisi: Math.round(DISTRIBUTOR_NAMES.length * (r.ciro / totalCiro)),
      cells,
      rowAvgPct: avg,
    };
  });

  // Reps — saha temsilcileri (top 20)
  const repNames = [
    "Mehmet Aksan", "Ayşe Demir", "Burak Yıldız", "Selin Kaya", "Murat Çelik",
    "Zeynep Erdoğan", "Ahmet Aydın", "Elif Şahin", "Caner Polat", "Esra Doğan",
    "Tolga Arslan", "Pelin Öztürk", "Erkan Yılmaz", "Deniz Tekin", "Fatih Korkmaz",
    "İrem Güneş", "Berk Yavuz", "Sema Kara", "Ozan Erdem", "Buse Akın",
  ];
  const reps: KomutaRep[] = repNames.map((ad, i) => ({
    ad,
    distributor: DISTRIBUTOR_NAMES[i % DISTRIBUTOR_NAMES.length]!,
    ciro: Math.round((totalCiro / 25) * rand(0.5, 1.5)),
    faturaSayisi: randInt(80, 280),
    rank: i + 1,
  })).sort((a, b) => b.ciro - a.ciro).map((r, i) => ({ ...r, rank: i + 1 }));

  // Top distributors
  const topDists: KomutaTopDist[] = DISTRIBUTOR_NAMES.slice(0, 10).map((ad, i) => {
    const bolge = Object.keys(REGION_COLORS)[i % 8]!;
    return {
      ad,
      bolge,
      ciro: Math.round((totalCiro / 12) * rand(0.6, 1.6)),
      faturaSayisi: randInt(400, 1800),
      rank: i + 1,
    };
  }).sort((a, b) => b.ciro - a.ciro).map((d, i) => ({ ...d, rank: i + 1 }));

  // Portfolio — ürün grubu 3-yıl yörünge
  const portfolio: KomutaPortfolioRow[] = PRODUCT_FAMILIES.map((p) => {
    const bu = Math.round((totalCiro * p.weight) / 100);
    const oneYearAgo = Math.round(bu * rand(0.75, 1.05));
    const twoYearsAgo = Math.round(bu * rand(0.6, 0.95));
    return {
      grup: p.brand ? `${p.brand} (${p.category})` : p.category,
      tier: p.tier,
      bu,
      oneYearAgo,
      twoYearsAgo,
      yoyPct: oneYearAgo > 0 ? ((bu - oneYearAgo) / oneYearAgo) * 100 : null,
      twoYrPct: twoYearsAgo > 0 ? ((bu - twoYearsAgo) / twoYearsAgo) * 100 : null,
    };
  });

  const snapshot: KomutaSnapshot = {
    generatedAt: new Date().toISOString(),
    reelTL: false,
    otvNet: false,
    otvAvgRate: null,
    demoDate: "2026-04-17",
    unit: "tl",
    kpis,
    regions,
    channels,
    channelMonthly,
    channelByType,
    monthlyTrend,
    upcomingEvent: {
      name: "Ramazan Bayramı",
      date: "2026-05-19",
      daysAhead: 32,
      kind: "bayram",
      yoyImpact: 18,
    },
    matrix,
    heatmap,
    reps,
    topDists,
    portfolio,
    brief:
      "Son 30 günde toplam ciro " +
      `geçen yılın aynı periyoduna göre ${(yoyPct ?? 0).toFixed(1)}% değişim ` +
      "gösterdi. Çikolata & Şekerleme kategorisi liderliğini koruyor; " +
      "Marmara bölgesi hem hacim hem büyüme öncülüğü yapıyor. " +
      "Doğu Anadolu'da Çay & Hot Drink performansı dikkat çekici şekilde " +
      "yüksek (mevsimsel etki). Kahve & İçecek Toz kategorisinde " +
      "Güneydoğu'da yavaşlama izleniyor — saha aksiyonu önerilir.",
  };

  return snapshot;
}

// ---------- Main ------------------------------------------------------------

function main() {
  const tenant = getTenantConfig();
  if (tenant.id !== "fmcg-demo") {
    console.error(
      `\n[seed-fmcg-demo] HATA: TENANT="${tenant.id}" — bu script sadece TENANT=fmcg-demo ile çalışır.\n` +
        `  Yanlış DB'yi silmemek için guard. Çalıştırmak için:\n` +
        `    TENANT=fmcg-demo npx tsx tools/seed-fmcg-demo.ts\n`,
    );
    process.exit(1);
  }

  console.log(`[seed-fmcg-demo] Tenant: ${tenant.displayName}`);
  console.log(`[seed-fmcg-demo] SQLite: data/${tenant.sqliteFileName}`);

  const db = getLocalDb(REPO_ROOT);

  // Tabula rasa — eski demo verilerini temizle. Pernod DB'sine asla
  // değmiyor çünkü ayrı dosyada (`fmcg-demo.sqlite`).
  console.log("[seed-fmcg-demo] Eski demo verisi temizleniyor...");
  db.exec(`
    DELETE FROM map_customers;
    DELETE FROM map_cities;
    DELETE FROM map_distributors;
    DELETE FROM sync_state;
    DELETE FROM cache_entries;
  `);

  // 1. Müşteri üret + risk skoru hesapla
  console.log("[seed-fmcg-demo] 2000 müşteri oluşturuluyor...");
  const customers = generateCustomers(2000);

  // 2. Risk skorunu gerçek algorithm ile hesapla — UI tier'larıyla birebir
  const insertCustomer = db.prepare(`
    INSERT INTO map_customers (
      id, dist_kod, unvan, kisa_ad, adres, sehir, ilce, distributor,
      lat, lng, has_sales, bolge,
      days_since_last_sale, days_since_last_visit,
      ciro_30d, ciro_prev_30d, ciro_t90, ciro_yoy_30d,
      fatura_30d, fatura_prev_30d, fatura_t90,
      urun_grup_30d, urun_grup_prev_30d, ziyaret_90d,
      risk_tier, risk_score, risk_tier_v2, risk_components, risk_reasons
    ) VALUES (
      @id, @distKod, @unvan, @kisaAd, @adres, @sehir, @ilce, @distributor,
      @lat, @lng, @hasSales, @bolge,
      @daysSinceLastSale, @daysSinceLastVisit,
      @ciro30d, @ciroPrev30d, @ciroT90, @ciroYoy30d,
      @fatura30d, @faturaPrev30d, @faturaT90,
      @urunGrup30d, @urunGrupPrev30d, @ziyaret90d,
      @riskTier, @riskScore, @riskTierV2, @riskComponents, @riskReasons
    )
  `);

  const txInsert = db.transaction((rows: Customer[]) => {
    for (const c of rows) {
      // Composite risk score — gerçek function ile (deterministik input → deterministik output).
      // Not: function input field adları SQLite kolon adlarından farklı
      // (suffix-less; `ciro30` vs DB'de `ciro_30d`). Map birebir burada.
      const risk = computeCustomerRiskScore({
        ciro30: c.ciro30d,
        ciroPrev30: c.ciroPrev30d,
        ciroT90: c.ciroT90,
        ciroYoy30d: c.ciroYoy30d,
        fatura30: c.fatura30d,
        faturaPrev30: c.faturaPrev30d,
        faturaT90: c.faturaT90,
        urunGrup30: c.urunGrup30d,
        urunGrupPrev30: c.urunGrupPrev30d,
        ziyaret90: c.ziyaret90d,
        daysSinceLastSale: c.daysSinceLastSale,
        daysSinceLastVisit: c.daysSinceLastVisit,
      });
      // Legacy tier: yeni tier'dan türet (UI hala backwards-compat fallback için bakıyor)
      let legacyTier: RiskTier = "active";
      if (risk.tier === "critical") legacyTier = "high";
      else if (risk.tier === "risk") legacyTier = "medium";
      else if (risk.tier === "watch") legacyTier = "low";
      insertCustomer.run({
        id: c.id,
        distKod: c.distKod,
        unvan: c.unvan,
        kisaAd: c.kisaAd,
        adres: c.adres,
        sehir: c.sehir,
        ilce: c.ilce,
        distributor: c.distributor,
        lat: c.lat,
        lng: c.lng,
        hasSales: c.hasSales ? 1 : 0,
        bolge: c.bolge,
        daysSinceLastSale: c.daysSinceLastSale,
        daysSinceLastVisit: c.daysSinceLastVisit,
        ciro30d: c.ciro30d,
        ciroPrev30d: c.ciroPrev30d,
        ciroT90: c.ciroT90,
        ciroYoy30d: c.ciroYoy30d,
        fatura30d: c.fatura30d,
        faturaPrev30d: c.faturaPrev30d,
        faturaT90: c.faturaT90,
        urunGrup30d: c.urunGrup30d,
        urunGrupPrev30d: c.urunGrupPrev30d,
        ziyaret90d: c.ziyaret90d,
        riskTier: legacyTier,
        riskScore: risk.score,
        riskTierV2: risk.tier,
        riskComponents: JSON.stringify(risk.components),
        riskReasons: JSON.stringify(risk.reasons),
      });
    }
  });
  txInsert(customers);

  // 3. Şehir + distribütör lookup tabloları
  // Şehir facet dropdown'u + region drill resolution için canonical adlar.
  const insertCity = db.prepare("INSERT OR IGNORE INTO map_cities (sehir) VALUES (?)");
  const txCities = db.transaction(() => {
    for (const c of CITIES) {
      if (c.weight > 0) insertCity.run(c.display);
    }
  });
  txCities();

  const insertDist = db.prepare(
    "INSERT OR IGNORE INTO map_distributors (lng_kod, ad) VALUES (?, ?)",
  );
  const txDists = db.transaction(() => {
    DISTRIBUTOR_NAMES.forEach((name, i) => insertDist.run(1000 + i, name));
  });
  txDists();

  // 4. sync_state — UI "az önce senkronlandı" göstersin
  const cityCount = CITIES.filter((c) => c.weight > 0).length;
  db.prepare(
    `INSERT INTO sync_state (domain, last_sync_at, duration_ms, customer_count, city_count, dist_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("map", new Date().toISOString(), 1200, customers.length, cityCount, DISTRIBUTOR_NAMES.length);

  // 5. Komuta snapshot — cache_entries'e pre-baked yaz (MSSQL bypass)
  console.log("[seed-fmcg-demo] Komuta snapshot oluşturuluyor...");
  const snap = generateKomutaSnapshot(customers);

  // Cache key formatı `getKomutaSnapshot` ile BİREBİR olmalı:
  //   CACHE_VERSION-reel|nominal-otv|gross-unit-scopeKey
  // Merkez/açık-erişim (distKods=null) → scopeKey="all". CACHE_VERSION komuta.ts'te
  // bump edilirse (şu an v7) BURASI da güncellenmeli, yoksa demo cache miss'e düşer.
  cachedWrite("komuta", "v7-nominal-gross-tl-all", snap, 850);

  // Risk dağılımı özet log
  const tierCounts = customers.reduce<Record<string, number>>((a, c) => {
    // computeCustomerRiskScore çıktısı SQLite'a yazılı — geri okuyamıyoruz hızlıca
    // ama yaklaşık dağılımı log atalım
    return a;
  }, {});

  // Hızlı sanity-check select
  const tierSummary = db
    .prepare(
      "SELECT risk_tier_v2 AS tier, COUNT(*) AS n FROM map_customers GROUP BY risk_tier_v2 ORDER BY n DESC",
    )
    .all() as { tier: string; n: number }[];

  console.log("\n[seed-fmcg-demo] Tamamlandı.");
  console.log(`  Müşteri:    ${customers.length}`);
  console.log(`  Şehir:      ${cityCount}`);
  console.log(`  Distribütör: ${DISTRIBUTOR_NAMES.length}`);
  console.log(`  Toplam ciro (son 30g): ₺${(snap.kpis[0]?.value ?? 0).toLocaleString("tr-TR")}`);
  console.log(`  Risk dağılımı:`);
  for (const row of tierSummary) {
    console.log(`    ${row.tier.padEnd(10)} ${row.n}`);
  }
  console.log(`\n  Demo'yu açmak için:`);
  console.log(`    Terminal 1: TENANT=fmcg-demo npm run api:start`);
  console.log(`    Terminal 2: TENANT=fmcg-demo npm run dashboard:dev`);
  console.log(`    veya:`);
  console.log(`    Terminal 1: npm run api:start:fmcg`);
  console.log(`    Terminal 2: npm run dashboard:dev:fmcg\n`);
}

main();
