/**
 * FMCG Demo seed — Wietnauer "Satış Performansı" ekranı (dashboard #2).
 *
 * Amaç: `fmcg-demo` tenant'ı (demoData:true, MSSQL'e bağlanmaz) için
 * `getWietnauerSatisSnapshot` içindeki `withCache` katmanının okuyacağı
 * `RawSatisBundle` şeklinde bir snapshot'ı `cache_entries` tablosuna direkt
 * yazar. Böylece demo'da endpoint canlı DB'ye gitmeden, önceden pişirilmiş
 * (pre-baked) veriyi cache'ten okur.
 *
 * KESIN cache anahtarı — `packages/core/src/wietnauer-satis.ts` okunarak
 * doğrulandı:
 *   - CACHE_DOMAIN = "wietnauer-satis"
 *   - CACHE_VERSION = "v6"
 *   - cacheKey = `${CACHE_VERSION}-30g-${cityCacheTag(cities)}${dateTag}`
 *   - Demo isteği `allowedCities` GEÇMEZ (merkez, açık erişim) → cities=null
 *     → `cityCacheTag(null)` = "all" (bkz. `packages/core/src/auth.ts`
 *     `cityCacheTag`: `if (!cities) return "all";`).
 *   - Demo isteği `dateFrom`/`dateTo` GEÇMEZ → `dateTag` = "" (boş — kod:
 *     `dateFrom || dateTo ? ... : ""`).
 *   → Nihai anahtar: **"v6-30g-all"**
 *
 * Kullanım:
 *   TENANT=fmcg-demo npx tsx tools/demo-seed/satis.ts
 *
 * NOT: Bu dosya `RawSatisBundle` (ve onun kullandığı `SatisRepRawRow`,
 * `AvgOrderTrendRawRow`) tiplerini YEREL olarak tanımlar çünkü kaynak
 * dosyada bu üç tip `export` edilmemiş (yalnızca `SatisDistRow`,
 * `SatisRepRow`, `DropSizeRow`, `NewCustomerRow`, `AvgOrderTrendPoint`,
 * `WietnauerSatisSnapshot` export ediliyor). Yerel tanımlar kaynaktaki
 * tanımlarla BİREBİR aynı tutulmalı (bkz. yorum referansları).
 */
import {
  cachedWrite,
  type SatisDistRow,
  type SatisRepRow,
  type DropSizeRow,
  type NewCustomerRow,
} from "@enroute/core";

// ---------- Yerel tip kopyaları (wietnauer-satis.ts ile birebir) -----------

/** wietnauer-satis.ts: `SatisRepRawRow` (export edilmemiş) */
type SatisRepRawRow = Omit<SatisRepRow, "rank"> & { distId: number | null };

/** wietnauer-satis.ts: `AvgOrderTrendRawRow` (export edilmemiş) */
type AvgOrderTrendRawRow = {
  distId: number;
  ayBaslangic: string;
  net: number;
  faturaSayi: number;
};

/** wietnauer-satis.ts: `RawSatisBundle` (export edilmemiş) */
type RawSatisBundle = {
  distLeaderboard: Omit<SatisDistRow, "rank" | "satisHizi">[];
  repLeaderboard: SatisRepRawRow[];
  dropSize: Omit<DropSizeRow, "rank">[];
  newCustomers: NewCustomerRow[];
  avgOrderTrendRaw: AvgOrderTrendRawRow[];
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

const rand = mulberry32(20260915);

function randInt(min: number, max: number): number {
  return Math.floor(min + rand() * (max - min + 1));
}

function randFloat(min: number, max: number): number {
  return min + rand() * (max - min);
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)] as T;
}

// ---------- FMCG sentetik referans verisi -----------------------------------

const REGIONS = [
  "MARMARA",
  "EGE",
  "AKDENIZ",
  "İÇ ANADOLU",
  "KARADENİZ",
  "GÜNEYDOĞU ANADOLU",
] as const;

type DistDef = { id: number; ad: string; region: string };

const DISTRIBUTORS: DistDef[] = [
  { id: 101, ad: "Marmara Gıda Dağıtım A.Ş.", region: "MARMARA" },
  { id: 102, ad: "Trakya Perakende Toptan", region: "MARMARA" },
  { id: 103, ad: "İstanbul Anadolu Yakası Dağıtım", region: "MARMARA" },
  { id: 104, ad: "Ege Toptan Gıda Ltd.", region: "EGE" },
  { id: 105, ad: "Ege Sahil Dağıtım", region: "EGE" },
  { id: 106, ad: "Akdeniz FMCG Lojistik", region: "AKDENIZ" },
  { id: 107, ad: "Çukurova Gıda Dağıtım", region: "AKDENIZ" },
  { id: 108, ad: "İç Anadolu Toptan Ticaret", region: "İÇ ANADOLU" },
  { id: 109, ad: "Orta Anadolu Dağıtım A.Ş.", region: "İÇ ANADOLU" },
  { id: 110, ad: "Karadeniz Sahil Toptan", region: "KARADENİZ" },
  { id: 111, ad: "Batı Karadeniz Dağıtım", region: "KARADENİZ" },
  { id: 112, ad: "Güneydoğu Ticaret ve Dağıtım", region: "GÜNEYDOĞU ANADOLU" },
  { id: 113, ad: "Doğu Anadolu Lojistik Dağıtım", region: "GÜNEYDOĞU ANADOLU" },
  { id: 114, ad: "Marmara İkinci Bölge Toptan", region: "MARMARA" },
];

const REP_FIRST_NAMES = [
  "Ahmet",
  "Mehmet",
  "Ayşe",
  "Fatma",
  "Emre",
  "Zeynep",
  "Burak",
  "Elif",
  "Can",
  "Deniz",
  "Selin",
  "Onur",
  "Merve",
  "Kerem",
  "Gizem",
  "Serkan",
  "Aslı",
  "Volkan",
  "Pınar",
  "Barış",
];
const REP_LAST_NAMES = [
  "Yılmaz",
  "Kaya",
  "Demir",
  "Şahin",
  "Çelik",
  "Yıldız",
  "Aydın",
  "Öztürk",
  "Arslan",
  "Doğan",
  "Kılıç",
  "Aslan",
  "Çetin",
  "Koç",
  "Kurt",
];

// ---------- Distribütör Leaderboard ----------------------------------------

const distLeaderboard: Omit<SatisDistRow, "rank" | "satisHizi">[] = DISTRIBUTORS.map((d) => {
  // 30g ciro — bölgeye göre kabaca büyüklük farkı (MARMARA en büyük).
  const sizeFactor = d.region === "MARMARA" ? 1.4 : d.region === "İÇ ANADOLU" ? 1.1 : 1.0;
  const ciro = Math.round(randFloat(900_000, 3_800_000) * sizeFactor);
  const musteriSayi = randInt(60, 320);
  const faturaSayi = Math.round(musteriSayi * randFloat(1.6, 3.4));
  const ortSepet = faturaSayi > 0 ? ciro / faturaSayi : 0;
  // Hacim: yaklaşık 70cl-eşdeğer litre — ortalama birim fiyatı ~40-55 TL varsayımıyla.
  const hacim = Math.round(ciro / randFloat(38, 55));
  const deltaPct = randFloat(-14, 22);
  const prevCiro = Math.round(ciro / (1 + deltaPct / 100));
  return {
    id: d.id,
    ad: d.ad,
    region: d.region,
    ciro,
    hacim,
    musteriSayi,
    faturaSayi,
    ortSepet,
    prevCiro,
    deltaPct,
  };
}).sort((a, b) => b.ciro - a.ciro);

// ---------- Satış Temsilcisi Leaderboard -----------------------------------

const repLeaderboard: SatisRepRawRow[] = [];
let repIdSeq = 5001;
for (const d of DISTRIBUTORS) {
  const repCount = randInt(2, 4);
  const distTotal = distLeaderboard.find((x) => x.id === d.id)?.ciro ?? 1_500_000;
  for (let i = 0; i < repCount; i += 1) {
    const share = randFloat(0.15, 0.4);
    const ciro = Math.round((distTotal * share) / repCount);
    const musteriSayi = randInt(15, 90);
    const faturaSayi = Math.round(musteriSayi * randFloat(1.4, 3.0));
    const ortSepet = faturaSayi > 0 ? ciro / faturaSayi : 0;
    const deltaPct = randFloat(-18, 26);
    const prevCiro = Math.round(ciro / (1 + deltaPct / 100));
    repLeaderboard.push({
      id: repIdSeq,
      ad: `${pick(REP_FIRST_NAMES)} ${pick(REP_LAST_NAMES)}`,
      distId: d.id,
      distAd: d.ad,
      region: d.region,
      ciro,
      musteriSayi,
      faturaSayi,
      ortSepet,
      prevCiro,
      deltaPct,
    });
    repIdSeq += 1;
  }
}
repLeaderboard.sort((a, b) => b.ciro - a.ciro);

// ---------- Drop Size (ciro / distinct müşteri) -----------------------------

const dropSize: Omit<DropSizeRow, "rank">[] = distLeaderboard
  .map((d) => ({
    id: d.id,
    ad: d.ad,
    region: d.region,
    ciro: d.ciro,
    musteriSayi: d.musteriSayi,
    dropSize: Math.round((d.ciro / Math.max(d.musteriSayi, 1)) * 100) / 100,
  }))
  .sort((a, b) => b.dropSize - a.dropSize);

// ---------- Yeni Müşteri Kazanımı (son 90g) --------------------------------

const newCustomers: NewCustomerRow[] = DISTRIBUTORS.map((d) => {
  const yeniMusteriSayi = randInt(8, 45);
  const yeniMusteriCiro = Math.round(yeniMusteriSayi * randFloat(3_500, 12_000));
  return {
    distId: d.id,
    distAd: d.ad,
    region: d.region,
    yeniMusteriSayi,
    yeniMusteriCiro,
  };
}).sort((a, b) => b.yeniMusteriSayi - a.yeniMusteriSayi);

// ---------- Ortalama Sipariş Büyüklüğü Trendi (son 12 ay × dist) -----------

function monthStartIso(monthsAgo: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  return d.toISOString();
}

const avgOrderTrendRaw: AvgOrderTrendRawRow[] = [];
for (const d of DISTRIBUTORS) {
  const distRow = distLeaderboard.find((x) => x.id === d.id);
  const baseMonthlyCiro = (distRow?.ciro ?? 1_500_000) * randFloat(0.9, 1.1);
  for (let m = 11; m >= 0; m -= 1) {
    // Hafif mevsimsellik + rastgele dalgalanma — büyüme trendi son aylara doğru.
    const growth = 1 + (11 - m) * 0.01;
    const noise = randFloat(0.82, 1.18);
    const net = Math.round(baseMonthlyCiro * growth * noise);
    const faturaSayi = Math.round((distRow?.faturaSayi ?? 200) * randFloat(0.85, 1.15));
    avgOrderTrendRaw.push({
      distId: d.id,
      ayBaslangic: monthStartIso(m),
      net,
      faturaSayi,
    });
  }
}

// ---------- Bundle & seed fonksiyonu ----------------------------------------

/**
 * `wietnauer-satis` cache domaininde, demo isteğinin (cities=null,
 * dateFrom/dateTo=null) okuyacağı KESIN anahtar altında `RawSatisBundle`
 * şeklinde bir snapshot yazar.
 *
 * Cache anahtarı: "v6-30g-all"
 *   = `${CACHE_VERSION}-30g-${cityCacheTag(null)}${dateTag}`
 *   = "v6" + "-30g-" + "all" + ""  (bkz. dosya üstü yorum + kaynak doğrulaması)
 */
export function seedSatis(): void {
  const bundle: RawSatisBundle = {
    distLeaderboard,
    repLeaderboard,
    dropSize,
    newCustomers,
    avgOrderTrendRaw,
    generatedAt: new Date().toISOString(),
  };
  cachedWrite("wietnauer-satis", "v6-30g-all", bundle, 900);
}

// Doğrudan `npx tsx tools/demo-seed/satis.ts` ile çalıştırılırsa seed'i uygula.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedSatis();
  // eslint-disable-next-line no-console
  console.log("[seed-satis] wietnauer-satis / v6-30g-all yazıldı.");
}
