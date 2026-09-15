/**
 * FMCG Demo seed — Ticari Yatırım & İskonto (Wietnauer Dashboard #7) pre-bake.
 *
 * `getWietnauerIskontoSnapshot` (packages/core/src/wietnauer-iskonto.ts)
 * MSSQL'e bakmadan önce `withCache(CACHE_DOMAIN, cacheKey, ...)` ile
 * `cache_entries` tablosunu kontrol eder. Demo tenant'ta (fmcg-demo) MSSQL
 * yok — bu yüzden aynı domain/key altına sentetik bir `RawIskontoBundle`
 * doğrudan `cachedWrite` ile yazılır (bkz. tools/seed-fmcg-demo.ts'teki komuta
 * snapshot pre-bake deseni).
 *
 * KESIN domain + key (packages/core/src/wietnauer-iskonto.ts ile birebir):
 *   CACHE_DOMAIN  = "wietnauer-iskonto"
 *   CACHE_VERSION = "v5"
 *   cacheKey (varsayılan görünüm, allowedCities=null/undefined) =
 *     `${CACHE_VERSION}-30g-${cityCacheTag(null)}` = "v5-30g-all"
 *   (cityCacheTag: `cities` null/undefined → "all" — auth.ts:404-406 DOĞRULANDI)
 *
 * `RawIskontoBundle` scope-free (tüm dist) ham satırlardan oluşur; public API
 * (`getWietnauerIskontoSnapshot`) bu ham satırları JS'te dist-scope + top-N +
 * segment collapse uygulayarak `WietnauerIskontoSnapshot`'a çevirir. Bu dosya
 * ham satırları (distId=null → merkez/tüm-dist görünümünde her satır scope'a
 * girer) üretir, agregasyon/etiketleme mantığına dokunmaz.
 *
 *   TENANT=fmcg-demo npx tsx tools/demo-seed/iskonto.ts
 */
import { cachedWrite } from "@enroute/core";

// ---------- Cache sabitleri (wietnauer-iskonto.ts ile birebir) -------------

const CACHE_DOMAIN = "wietnauer-iskonto";
const CACHE_VERSION = "v5";
/** Varsayılan (şehir kısıtsız, aralık verilmemiş) görünümün cache key'i. */
const CACHE_KEY = `${CACHE_VERSION}-30g-all`;

// ---------- Yerel tip kopyaları (packages/core/src/wietnauer-iskonto.ts) ---
// Not: bu dosya core paketini import etmez (yalnız `cachedWrite` dışa
// aktarılıyor) — cache'lenen tipin ŞEKLİ burada birebir kopyalanır ki
// `withCache<RawIskontoBundle>` deserialize ederken alan eksikliği/typo
// runtime'da sessizce yutulmasın (typecheck bunu derleme zamanında yakalar).

type DiscountOverallRawRow = {
  distId: number | null;
  brut: number;
  iskonto: number;
  net: number;
  faturaCount: number;
  aktifMusteriCount: number;
};

type DiscountMonthlyRawRow = {
  distId: number | null;
  yyyymm: string;
  brut: number;
  iskonto: number;
  net: number;
};

type DiscountBrandRawRow = {
  markaKod: string;
  marka: string;
  distId: number | null;
  brut: number;
  net: number;
  netPrev: number;
};

type DiscountTopCustomerRawRow = {
  id: number;
  distId: number | null;
  unvan: string;
  sehir: string | null;
  brut: number;
  iskonto: number;
  net: number;
  faturaSayisi: number;
};

type DiscountSegmentRawRow = {
  segment: string;
  distId: number | null;
  brut: number;
  iskonto: number;
  net: number;
  musteriSayi: number;
  faturaSayisi: number;
};

type RawIskontoBundle = {
  overall: DiscountOverallRawRow[];
  monthly: DiscountMonthlyRawRow[];
  brands: DiscountBrandRawRow[];
  topCustomers: DiscountTopCustomerRawRow[];
  segments: DiscountSegmentRawRow[];
  ekGrupSegments: DiscountSegmentRawRow[];
  generatedAt: string;
};

// ---------- Deterministik PRNG (seed-fmcg-demo.ts ile aynı desen) ----------

function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000_000) / 1_000_000_000;
  };
}
const rng = makeRng(20260615);
const rand = (min: number, max: number) => min + rng() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// ---------- Sentetik veri havuzları -----------------------------------------

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

const COMPANY_HEADS = [
  "ASLAN", "GÜVEN", "ALTIN", "ZAFER", "MAVİ", "ANADOLU", "EGE", "GÜNEŞ",
  "AY", "YILDIZ", "DENİZ", "BÜYÜK", "SARP", "DOĞU", "BATU", "KARTAL",
  "BEREKET", "ÖZ", "MARMARA", "FATİH", "MERT", "DEMİR", "PINAR", "CESUR",
];
const COMPANY_TAILS = ["MARKET", "BAKKAL", "MİNİ MARKET", "GIDA", "ŞARKÜTERİ", "TİCARET"];
const CITIES = [
  "İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Adana", "Konya",
  "Gaziantep", "Şanlıurfa", "Kocaeli", "Mersin", "Diyarbakır", "Kayseri",
  "Samsun", "Manisa",
];

const SEGMENTS = ["Prestige", "Premium", "Premium Plus", "Standart", "Standart Plus", "(Tanımsız)"];
const EK_GRUPLAR = ["TEKEL", "BÜFE", "MARKET", "BAR", "OTEL", "OKUL", "KANTİN", "PASTANE", "DİĞER"];

function companyName(): string {
  return `${pick(COMPANY_HEADS)} ${pick(COMPANY_TAILS)}`;
}

// ---------- Fetcher eşdeğeri üretim fonksiyonları ---------------------------
// Tümü tek "merkez" dist (distId=null → `inScope` her zaman true, bkz.
// wietnauer-iskonto.ts:833-837) altında üretilir; demo'da dist bazlı yetki
// kırılımı gerekmiyor (RBAC merkez-only, BYTTIP=0 — bkz. proje hafızası).

function buildOverall(): DiscountOverallRawRow[] {
  const brut = 42_500_000 + rand(-1_500_000, 1_500_000);
  const iskontoOraniPct = rand(11, 15); // sağlıklı bant
  const iskonto = brut * (iskontoOraniPct / 100);
  const net = brut - iskonto;
  return [
    {
      distId: null,
      brut: Math.round(brut),
      iskonto: Math.round(iskonto),
      net: Math.round(net),
      faturaCount: randInt(18_000, 22_000),
      aktifMusteriCount: randInt(7_800, 9_200),
    },
  ];
}

function buildMonthly(): DiscountMonthlyRawRow[] {
  const rows: DiscountMonthlyRawRow[] = [];
  const now = new Date(2026, 8, 15); // DEMO_DATE ~15 Eyl 2026
  for (let m = 11; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const isRamazan = d.getMonth() >= 2 && d.getMonth() <= 3;
    const seasonal = isRamazan ? 1.2 : d.getMonth() >= 6 && d.getMonth() <= 8 ? 0.85 : 1.0;
    const brut = 3_400_000 * seasonal * rand(0.9, 1.1);
    // Ramazan/bayram döneminde iskonto oranı hafif yükselir (promosyon yoğunluğu)
    const oranPct = (isRamazan ? rand(13, 17) : rand(10, 14));
    const iskonto = brut * (oranPct / 100);
    rows.push({
      distId: null,
      yyyymm,
      brut: Math.round(brut),
      iskonto: Math.round(iskonto),
      net: Math.round(brut - iskonto),
    });
  }
  return rows;
}

function buildBrands(): DiscountBrandRawRow[] {
  return BRANDS.map((b) => {
    const brut = 42_500_000 * (b.weight / 100) * rand(0.85, 1.15);
    // Stratejik/premium markalarda iskonto oranı düşük tutulur (sağlıklı),
    // generic/value kategorilerde daha yüksek (etkinlik yoğun).
    const oranPct = b.kod === "JELSTAR" || b.kod === "ATISTIRMALIK" ? rand(18, 26) : rand(8, 16);
    const net = brut * (1 - oranPct / 100);
    const netPrev = net * rand(0.82, 1.12); // YoY karışık — bazı markalar büyüyor bazı geriliyor
    return {
      markaKod: b.kod,
      marka: b.ad,
      distId: null,
      brut: Math.round(brut),
      net: Math.round(net),
      netPrev: Math.round(netPrev),
    };
  });
}

function buildTopCustomers(): DiscountTopCustomerRawRow[] {
  const rows: DiscountTopCustomerRawRow[] = [];
  for (let i = 0; i < 20; i++) {
    const brut = (900_000 - i * 32_000) * rand(0.85, 1.15);
    // Rank'a göre etiket dağılımı: ilk sıralarda "bağımlı" (yüksek iskonto
    // yemiş büyük müşteriler), ortada "sağlıklı", kuyrukta "premium".
    const oranPct = i < 6 ? rand(26, 38) : i < 14 ? rand(12, 24) : rand(4, 9);
    const iskonto = brut * (oranPct / 100);
    rows.push({
      id: 2_000_000 + i,
      distId: null,
      unvan: companyName(),
      sehir: pick(CITIES),
      brut: Math.round(brut),
      iskonto: Math.round(iskonto),
      net: Math.round(brut - iskonto),
      faturaSayisi: randInt(8, 45),
    });
  }
  return rows;
}

function buildSegments(): DiscountSegmentRawRow[] {
  const weights: Record<string, number> = {
    Prestige: 22,
    Premium: 28,
    "Premium Plus": 12,
    Standart: 26,
    "Standart Plus": 10,
    "(Tanımsız)": 2,
  };
  const oranBySeg: Record<string, [number, number]> = {
    Prestige: [6, 11],
    Premium: [10, 16],
    "Premium Plus": [8, 13],
    Standart: [14, 22],
    "Standart Plus": [12, 19],
    "(Tanımsız)": [5, 30],
  };
  return SEGMENTS.map((segment) => {
    const brut = 42_500_000 * (weights[segment]! / 100) * rand(0.9, 1.1);
    const [lo, hi] = oranBySeg[segment]!;
    const oranPct = rand(lo, hi);
    const iskonto = brut * (oranPct / 100);
    return {
      segment,
      distId: null,
      brut: Math.round(brut),
      iskonto: Math.round(iskonto),
      net: Math.round(brut - iskonto),
      musteriSayi: randInt(300, 2400),
      faturaSayisi: randInt(900, 6800),
    };
  });
}

function buildEkGrupSegments(): DiscountSegmentRawRow[] {
  const weights = EK_GRUPLAR.map(() => rand(4, 22));
  const total = weights.reduce((a, b) => a + b, 0);
  return EK_GRUPLAR.map((segment, i) => {
    const brut = 42_500_000 * (weights[i]! / total) * rand(0.9, 1.1);
    const oranPct = rand(9, 24);
    const iskonto = brut * (oranPct / 100);
    return {
      segment,
      distId: null,
      brut: Math.round(brut),
      iskonto: Math.round(iskonto),
      net: Math.round(brut - iskonto),
      musteriSayi: randInt(150, 1800),
      faturaSayisi: randInt(400, 5200),
    };
  }).sort((a, b) => b.brut - a.brut);
}

// ---------- Public API -------------------------------------------------------

/**
 * Ticari Yatırım & İskonto snapshot'ını üretip `cache_entries`'e pre-bake
 * yazar. `getWietnauerIskontoSnapshot` (packages/core/src/wietnauer-iskonto.ts)
 * varsayılan çağrıda (options boş → `allowedCities=null`, aralık yok) tam bu
 * domain+key altına bakar; MSSQL'e hiç gitmeden bu bundle'ı okur.
 */
export function seedIskonto(): void {
  const bundle: RawIskontoBundle = {
    overall: buildOverall(),
    monthly: buildMonthly(),
    brands: buildBrands(),
    topCustomers: buildTopCustomers(),
    segments: buildSegments(),
    ekGrupSegments: buildEkGrupSegments(),
    generatedAt: new Date().toISOString(),
  };
  cachedWrite(CACHE_DOMAIN, CACHE_KEY, bundle, 900);
}
