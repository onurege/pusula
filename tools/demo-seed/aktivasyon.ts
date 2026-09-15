/**
 * FMCG Demo seed — Aktivasyon & Risk ekranı (Dashboard #6) pre-bake.
 *
 * `packages/core/src/wietnauer-aktivasyon.ts` → `getWietnauerAktivasyonSnapshot()`
 * Panel A/B/C (aktif müşteri, sessizleşen müşteri, stratejik marka sessizliği)
 * `withCache(CACHE_DOMAIN, cacheKey, loader)` ile MSSQL'e gider. fmcg-demo
 * tenant'ında MSSQL YOK — `withCache` cache HIT olursa loader hiç çağrılmaz
 * (bkz. packages/core/src/cache.ts `withCache`), cache MISS olursa
 * `runReadOnly` MSSQL bağlantısı deneyip patlar. Bu yüzden demo'da bu anahtar
 * ÖNCEDEN yazılmış olmalı.
 *
 * KESIN cache anahtarı türetimi (wietnauer-aktivasyon.ts satır 33-43, 602-609):
 *   CACHE_DOMAIN  = "wietnauer-aktivasyon"
 *   CACHE_VERSION = "v5"
 *   stratKey      = (tenant.strategicBrands ?? []).map(lowercase).sort().join("|")
 *                   fmcg-demo config'te `strategicBrands` TANIMSIZ →
 *                   `tenant.strategicBrands ?? []` (server.ts satır 1756) → []
 *                   → stratKey = "" → `stratKey || "none"` = "none"
 *   cityTag       = cityCacheTag(allowedCities) — demo scope `cities: null`
 *                   (auth.ts `resolveTenantScope`: `demoData === true` →
 *                   `{ type: "merkez", distKods: null, cities: null }`) →
 *                   cityCacheTag(null) = "all" (auth.ts satır 405)
 *   cacheKey      = `${CACHE_VERSION}-90g-${stratKey || "none"}-${cityTag}`
 *                 = "v5-90g-none-all"  ← DOĞRULANDI (server.ts + auth.ts +
 *                   wietnauer-aktivasyon.ts okunarak, MSSQL/demo çalıştırılmadan
 *                   statik iz sürme ile).
 *
 * Demo branch notu: wietnauer-aktivasyon.ts içinde ayrı bir demo/sqlite
 * kısayolu YOK — A/B/C panelleri her koşulda `withCache` üzerinden gider
 * (cache hit'e düşene kadar). D (risk tier) ve E (yeniden kazanım) panelleri
 * zaten `getLocalDb` ile SQLite `map_customers` tablosunu SENKRON okuyor —
 * bu tablo `tools/seed-fmcg-demo.ts` tarafından ayrıca dolduruluyor (bu
 * dosyanın kapsamı DIŞINDA, dokunulmadı). Yani eksik olan tek şey bu cache
 * anahtarıydı; SQLite tablo şeması için ek çözüm gerekmiyor.
 *
 * Senaryo (sentetik, deterministik xorshift32 — Math.random YOK):
 *   - Panel A: ~900 aktif + ~800 önceki-90g müşteri, FMCG kanal segmentleri
 *     (Zincir Market/Bakkal/Mini Market/Horeca/Okul Kantini/Hipermarket) —
 *     hafif büyüme (aktif > önceki).
 *   - Panel B (pasifleşen müşteri): önceki 90g'de vardı, son 90g'de yok —
 *     yüksek geçmiş cirolu birkaç "kayıp risk" müşterisi dahil (aynı zamanda
 *     SQLite tabanlı "yeniden kazanım" panelinin anlatısıyla tutarlı olacak
 *     şekilde ciro/marka hikâyesi kurgulandı).
 *   - Panel C (stratejik marka sessizliği): karma FMCG marka havuzundan
 *     (ÇİKOMASTER, GOFRETKING, KAHVELİDER, TEMİZ-YOL, JELSTAR, ...) her marka
 *     için toplam/sessiz müşteri sayısı — bazı markalarda belirgin sessizlik
 *     (%50+) anlatısı.
 */
import { cachedWrite } from "@enroute/core";

// ---------- Cache hedefi (wietnauer-aktivasyon.ts ile birebir) --------------

const CACHE_DOMAIN = "wietnauer-aktivasyon";
const CACHE_KEY = "v5-90g-none-all";

// ---------- Yerel tip kopyaları (wietnauer-aktivasyon.ts export etmiyor) ----

type ActiveCustomers90dRawRow = {
  distId: number | null;
  musteriId: number;
  isAktif: boolean;
  isOnceki: boolean;
  segment: string;
};

type SilentCustomerRawRow = {
  id: number;
  unvan: string;
  sehir: string | null;
  sonSatisTarihi: string | null;
  oncekiCiro: number;
  sonMarka: string | null;
  distId: number | null;
};

type StrategicBrandSilenceRawRow = {
  marka: string;
  distId: number | null;
  toplamMusteri: number;
  sessizMusteri: number;
};

type RawAktivasyonMssqlBundle = {
  active: ActiveCustomers90dRawRow[];
  silent: SilentCustomerRawRow[];
  strategicSilence: StrategicBrandSilenceRawRow[];
  generatedAt: string;
};

// ---------- Deterministik PRNG (Math.random yok — xorshift32) --------------

function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000_000) / 1_000_000_000;
  };
}
const rng = makeRng(20260417);
const rand = (min: number, max: number) => min + rng() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
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

// ---------- Sabit havuzlar (FMCG demo taksonomisiyle tutarlı) ---------------

const SEGMENTS = [
  { item: "Zincir Market", weight: 18 },
  { item: "Bakkal", weight: 28 },
  { item: "Mini Market", weight: 22 },
  { item: "Horeca", weight: 12 },
  { item: "Okul Kantini", weight: 9 },
  { item: "Hipermarket", weight: 6 },
  { item: "(Tanımsız)", weight: 5 },
] as const;

const STRATEGIC_BRANDS = [
  "ÇİKOMASTER",
  "GOFRETKING",
  "KAHVELİDER",
  "ÇIKIRBİS",
  "MISIRKING",
  "TAMMAVİ",
  "TEMİZ-YOL",
  "JELSTAR",
] as const;

const CITIES = [
  "İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Adana", "Konya",
  "Gaziantep", "Kocaeli", "Mersin", "Samsun", "Kayseri", "Denizli",
] as const;

const COMPANY_HEADS = [
  "ASLAN", "GÜVEN", "ALTIN", "ZAFER", "MAVİ", "ANADOLU", "EGE", "GÜNEŞ",
  "YILDIZ", "DENIZ", "BÜYÜK", "SARP", "DOĞU", "KARTAL", "ÖZ", "AKDENİZ",
  "MERT", "ÇINAR", "DEMİR", "PINAR", "TURGUT", "YEŞİL",
] as const;

const COMPANY_TAILS = [
  { tail: "MARKET", weight: 5 },
  { tail: "BAKKAL", weight: 4 },
  { tail: "MİNİ MARKET", weight: 4 },
  { tail: "GIDA", weight: 3 },
  { tail: "ŞARKÜTERİ", weight: 2 },
  { tail: "TİCARET", weight: 2 },
  { tail: "BÜFE", weight: 2 },
  { tail: "KAFE & RESTORAN", weight: 1 },
] as const;

function generateCompanyName(): string {
  const head = pick(COMPANY_HEADS);
  const tail = pickWeighted(COMPANY_TAILS.map((t) => ({ item: t.tail, weight: t.weight })));
  return `${head} ${tail}`;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ---------- Panel A — Aktif Müşteri (90g) -----------------------------------

/**
 * ~900 aktif + ~800 önceki-90g distinct müşteri, segment kırılımıyla.
 * Aktif > önceki → pozitif trend (demo anlatısı: hafif büyüme momentum'u).
 */
function buildActiveRows(): ActiveCustomers90dRawRow[] {
  const rows: ActiveCustomers90dRawRow[] = [];
  let musteriId = 800_000;

  // Devam eden aktif müşteriler (hem önceki hem şimdiki dönemde var).
  for (let i = 0; i < 720; i++) {
    rows.push({
      distId: null,
      musteriId: musteriId++,
      isAktif: true,
      isOnceki: true,
      segment: pickWeighted(SEGMENTS.map((s) => ({ item: s.item, weight: s.weight }))),
    });
  }
  // Yeni aktifleşen müşteriler (önceki dönemde yoktu, şimdi var).
  for (let i = 0; i < 180; i++) {
    rows.push({
      distId: null,
      musteriId: musteriId++,
      isAktif: true,
      isOnceki: false,
      segment: pickWeighted(SEGMENTS.map((s) => ({ item: s.item, weight: s.weight }))),
    });
  }
  // Pasifleşen müşteriler (önceki dönemde vardı, şimdi yok) — Panel B'nin
  // kaynağıyla aynı köken (musteriId aralığı overlap etmiyor, ayrı ID'ler
  // Panel B'de kullanılıyor; burada sadece Panel A'nın "önceki toplam"ını
  // doğru büyütmek için ayrı satırlar).
  for (let i = 0; i < 80; i++) {
    rows.push({
      distId: null,
      musteriId: musteriId++,
      isAktif: false,
      isOnceki: true,
      segment: pickWeighted(SEGMENTS.map((s) => ({ item: s.item, weight: s.weight }))),
    });
  }

  return rows;
}

// ---------- Panel B — Sessizleşen (Pasifleşen) Müşteri ----------------------

/**
 * ~45 pasifleşen müşteri — önceki 90g'de fatura kesilmiş, son 90g'de sessiz.
 * Yüksek geçmiş cirolu birkaç kayıp-risk müşterisi dahil (yeniden kazanım
 * anlatısıyla tutarlı — yüksek ciro + uzun sessizlik).
 */
function buildSilentRows(): SilentCustomerRawRow[] {
  const rows: SilentCustomerRawRow[] = [];
  let id = 900_000;

  for (let i = 0; i < 45; i++) {
    // Pareto-ish geçmiş ciro — birkaç büyük kayıp, çoğu orta ölçekli.
    const oncekiCiro = Math.round(8_000 + Math.pow(rng(), 3) * 180_000);
    // 91-170 gün önce son satış — "son 90g'de yok" koşuluyla tutarlı,
    // önceki 90g penceresi (180..90) içinde.
    const sessizGunBase = randInt(91, 170);
    rows.push({
      id: id++,
      distId: null,
      unvan: generateCompanyName(),
      sehir: pick(CITIES),
      sonSatisTarihi: daysAgoIso(sessizGunBase),
      oncekiCiro,
      sonMarka: pick(STRATEGIC_BRANDS),
    });
  }

  return rows;
}

// ---------- Panel C — Stratejik Marka Sessizliği ----------------------------

/**
 * Her stratejik marka için toplam/sessiz müşteri — bazı markalarda (KAHVELİDER,
 * TEMİZ-YOL) belirgin sessizlik oranı (%50+) anlatısı kurgulandı.
 */
function buildStrategicSilenceRows(): StrategicBrandSilenceRawRow[] {
  const sessizPctByBrand: Record<string, number> = {
    "ÇİKOMASTER": 0.18,
    "GOFRETKING": 0.24,
    "KAHVELİDER": 0.58,
    "ÇIKIRBİS": 0.31,
    "MISIRKING": 0.22,
    "TAMMAVİ": 0.27,
    "TEMİZ-YOL": 0.52,
    "JELSTAR": 0.44,
  };

  return STRATEGIC_BRANDS.map((marka) => {
    const toplamMusteri = randInt(180, 420);
    const pct = sessizPctByBrand[marka] ?? 0.3;
    const sessizMusteri = Math.round(toplamMusteri * pct);
    return { marka, distId: null, toplamMusteri, sessizMusteri };
  });
}

// ---------- Public API -------------------------------------------------------

/**
 * fmcg-demo tenant'ı için Aktivasyon & Risk (A/B/C panel) cache bundle'ını
 * `cache_entries` tablosuna pre-bake eder — `getWietnauerAktivasyonSnapshot()`
 * çağrıldığında `withCache` cache HIT bulup MSSQL'e hiç gitmez.
 */
export function seedAktivasyon(): void {
  const bundle: RawAktivasyonMssqlBundle = {
    active: buildActiveRows(),
    silent: buildSilentRows(),
    strategicSilence: buildStrategicSilenceRows(),
    generatedAt: new Date().toISOString(),
  };

  cachedWrite(CACHE_DOMAIN, CACHE_KEY, bundle, 640);
}
