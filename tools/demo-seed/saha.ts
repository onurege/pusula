/**
 * Wietnauer Dashboard #5 (Saha Operasyon) — offline demo seed.
 *
 * `packages/core/src/wietnauer-saha.ts` MSSQL'siz demo'da (`fmcg-demo`,
 * demoData:true) `withCache<RawSahaBundle>(CACHE_DOMAIN, cacheKey, ...)` ile
 * okunur. MSSQL yokken cache-miss → boş panel. Bu script cache'i pre-bake
 * eder ki `getWietnauerSahaSnapshot()` hiç DB'ye dokunmadan aynı şekilde
 * çalışsın.
 *
 * KESIN domain + key (wietnauer-saha.ts'ten doğrulandı):
 *   CACHE_DOMAIN  = "wietnauer-saha"
 *   CACHE_VERSION = "v7"
 *   cacheKey      = `${CACHE_VERSION}-${win.key}-${cityCacheTag(cities)}`
 *
 * Runtime çağrısında `getWietnauerSahaSnapshot()` varsayılan parametrelerle
 * (dateFrom/dateTo verilmezse, allowedCities verilmezse) çalışır:
 *   - `resolveWindowBounds(undefined, undefined)` → dateFrom/dateTo
 *     geçersiz olduğu için fallback dala düşer → `win.key = "30g"`
 *     (fallbackDays=30 varsayılan; now.ts:145-163).
 *   - `cities = options.allowedCities ?? null` → `null` ⇒
 *     `cityCacheTag(null) = "all"` (auth.ts:404-406, `!cities` dalı).
 *   ⇒ KESIN cache key: **"v7-30g-all"**
 *
 * Yazılan payload şekli `RawSahaBundle` (wietnauer-saha.ts:663-671,
 * export edilmemiş — burada yapısal (structural) eşdeğer local tip
 * kullanılır, TS structural typing sayesinde JSON.stringify sonrası
 * `getWietnauerSahaSnapshot()`'ın aggregate* fonksiyonları aynı alan
 * adlarını okuyabilir):
 *   {
 *     visitDaily:   (VisitDailyRow & { distId })[]
 *     kpi:          { distId, ziyaret, uniqueMusteri, aktifRep, siparisli }[]
 *     coverage:     (CoverageSegmentRow & { distId })[]
 *     reps:         (Omit<RepPerformanceRow,"rank"> & { distId })[]
 *     conversion:   (Omit<VisitConversionRow,"donusumPct"> & { distId })[]
 *     distributors: Omit<DistributorComparisonRow,"rank">[]
 *     generatedAt:  string
 *   }
 *
 * Kullanım:
 *   TENANT=fmcg-demo npx tsx tools/demo-seed/saha.ts
 *
 * Sadece bu dosya değiştirilir — başka dosyaya dokunulmaz (read-only görev).
 */

import { cachedWrite } from "@enroute/core";

// ---------- Sabitler ---------------------------------------------------------

/** wietnauer-saha.ts:57 ile birebir. */
const CACHE_DOMAIN = "wietnauer-saha";
/** wietnauer-saha.ts:722 — `${CACHE_VERSION}-${win.key}-${cityCacheTag(cities)}`,
 *  varsayılan parametrelerle (dateFrom/dateTo yok, allowedCities yok) çözülen
 *  KESIN anahtar: CACHE_VERSION="v7", win.key="30g" (fallback, now.ts:161),
 *  cityCacheTag(null)="all" (auth.ts:405). */
const CACHE_KEY = "v7-30g-all";

/** Demo "bugün" — repo genelinde DEMO_DATE=2026-04-17 sabiti (now.ts /
 *  seed-fmcg-demo.ts ile tutarlı). Saha penceresi bu tarihin son 30 günü. */
const DEMO_DATE = "2026-04-17";

// Deterministik PRNG (xorshift32) — seed sabit, her çalıştırmada aynı sonuç.
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

// ---------- Tipler (RawSahaBundle yapısal eşdeğeri) --------------------------
//
// wietnauer-saha.ts export etmediği için burada yerel kopya tutulur. Alan
// adları/tipler kaynak dosyayla (VisitDailyRow, VisitKpi7gRawRow,
// CoverageSegmentRow, RepPerformanceRow, VisitConversionRow,
// DistributorComparisonRow) birebir eşleşir.

type VisitDailyRawRow = {
  gun: string; // YYYY-MM-DD
  toplam: number;
  rutIci: number;
  rutDisi: number;
  distId: number | null;
};

type VisitKpi7gRawRow = {
  distId: number | null;
  ziyaret: number;
  uniqueMusteri: number;
  aktifRep: number;
  siparisli: number;
};

type CoverageRawRow = {
  distId: number | null;
  segment: string;
  ziyaretEdilen: number;
  aktif: number;
  kapsamaPct: number;
};

type RepPerformanceRawRow = {
  repId: number;
  distId: number | null;
  ad: string;
  distributor: string | null;
  ziyaret: number;
  uniqueMusteri: number;
  aktifMusteri: number;
  siparisliZiyaret: number;
  donusumPct: number;
  rutDisiPct: number;
};

type VisitConversionRawRow = {
  distId: number | null;
  tip: "Rut İçi" | "Rut Dışı";
  ziyaret: number;
  siparisli: number;
  faturali: number;
  irsaliyeli: number;
};

type DistributorComparisonRawRow = {
  distKod: number;
  distributor: string;
  bolge: string | null;
  aktifTemsilci: number;
  ziyaret: number;
  kapsananMusteri: number;
  donusumPct: number;
};

type RawSahaBundle = {
  visitDaily: VisitDailyRawRow[];
  kpi: VisitKpi7gRawRow[];
  coverage: CoverageRawRow[];
  reps: RepPerformanceRawRow[];
  conversion: VisitConversionRawRow[];
  distributors: DistributorComparisonRawRow[];
  generatedAt: string;
};

// ---------- Sentetik sabitler -------------------------------------------------

const BOLGELER = ["Marmara", "Ege", "İç Anadolu", "Akdeniz", "Karadeniz", "Güneydoğu Anadolu"] as const;

const DISTRIBUTORS: readonly { distKod: number; ad: string; bolge: string }[] = [
  { distKod: 4001, ad: "AKSAN GIDA DAĞITIM", bolge: "Marmara" },
  { distKod: 4002, ad: "EGE GIDA DAĞITIM", bolge: "Ege" },
  { distKod: 4003, ad: "ANADOLU TİCARET", bolge: "İç Anadolu" },
  { distKod: 4004, ad: "AKDENİZ GIDA", bolge: "Akdeniz" },
  { distKod: 4005, ad: "KARADENİZ DAĞITIM", bolge: "Karadeniz" },
  { distKod: 4006, ad: "GÜNEYDOĞU TİCARET", bolge: "Güneydoğu Anadolu" },
  { distKod: 4007, ad: "MARMARA GIDA", bolge: "Marmara" },
  { distKod: 4008, ad: "PINAR DAĞITIM", bolge: "Ege" },
  { distKod: 4009, ad: "GÜVEN GIDA", bolge: "İç Anadolu" },
  { distKod: 4010, ad: "ZAFER TİCARET", bolge: "Akdeniz" },
];

const REP_NAMES = [
  "Mehmet Aksan", "Ayşe Demir", "Burak Yıldız", "Selin Kaya", "Murat Çelik",
  "Zeynep Erdoğan", "Ahmet Aydın", "Elif Şahin", "Caner Polat", "Esra Doğan",
  "Tolga Arslan", "Pelin Öztürk", "Erkan Yılmaz", "Deniz Tekin", "Fatih Korkmaz",
  "İrem Güneş", "Berk Yavuz", "Sema Kara", "Ozan Erdem", "Buse Akın",
  "Kerem Uslu", "Nazlı Ergin", "Volkan Bulut", "Gamze Sarı", "Emir Toprak",
  "Aslı Koç", "Barış Yıldırım", "Hande Özkan", "Serkan Yücel", "Ceren Aktaş",
];

const SEGMENTLER = [
  "Prestige",
  "Premium",
  "Premium Plus",
  "Standart",
  "Standart Plus",
  "Off Trade C&PS Tedarikçi",
  "(Tanımsız)",
] as const;

/** Son 30 gün, DEMO_DATE dahil (2026-03-19 .. 2026-04-17). */
function last30Days(): string[] {
  const end = new Date(`${DEMO_DATE}T00:00:00Z`);
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

// ---------- Bundle üretimi -----------------------------------------------------

function buildBundle(): RawSahaBundle {
  const days = last30Days();

  // Her temsilciyi bir distribütöre bağla (round-robin + hafif rastgelelik).
  const repAssignments = REP_NAMES.map((ad, i) => {
    const dist = DISTRIBUTORS[i % DISTRIBUTORS.length]!;
    return {
      repId: 9000 + i,
      ad,
      distKod: dist.distKod,
      distributor: dist.ad,
    };
  });

  // ---- Panel A: günlük ziyaret trendi (dist bazlı ham satırlar) -----------
  const visitDaily: VisitDailyRawRow[] = [];
  for (const gun of days) {
    const gunDate = new Date(`${gun}T00:00:00Z`);
    const isWeekend = gunDate.getUTCDay() === 0 || gunDate.getUTCDay() === 6;
    for (const dist of DISTRIBUTORS) {
      const base = isWeekend ? randInt(4, 12) : randInt(18, 42);
      const rutDisi = Math.round(base * rand(0.08, 0.22));
      const rutIci = base - rutDisi;
      visitDaily.push({
        gun,
        toplam: base,
        rutIci,
        rutDisi,
        distId: dist.distKod,
      });
    }
  }

  // ---- Panel KPI: son 7g özet (dist bazlı) --------------------------------
  const last7Dates = new Set(days.slice(-7));
  const kpi: VisitKpi7gRawRow[] = DISTRIBUTORS.map((dist) => {
    const distDays = visitDaily.filter((r) => r.distId === dist.distKod && last7Dates.has(r.gun));
    const ziyaret = distDays.reduce((a, r) => a + r.toplam, 0);
    const uniqueMusteri = Math.round(ziyaret * rand(0.55, 0.75));
    const aktifRep = randInt(3, 6);
    const siparisli = Math.round(ziyaret * rand(0.35, 0.55));
    return { distId: dist.distKod, ziyaret, uniqueMusteri, aktifRep, siparisli };
  });

  // ---- Panel B: segment × dist kapsama -------------------------------------
  const coverage: CoverageRawRow[] = [];
  for (const dist of DISTRIBUTORS) {
    for (const segment of SEGMENTLER) {
      const aktif =
        segment === "(Tanımsız)" ? randInt(2, 15) : randInt(20, 180);
      const kapsamaOraniHedef =
        segment === "Prestige" || segment === "Premium"
          ? rand(0.65, 0.9)
          : segment === "(Tanımsız)"
            ? rand(0.1, 0.35)
            : rand(0.35, 0.65);
      const ziyaretEdilen = Math.min(aktif, Math.round(aktif * kapsamaOraniHedef));
      coverage.push({
        distId: dist.distKod,
        segment,
        ziyaretEdilen,
        aktif,
        kapsamaPct: aktif > 0 ? Number(((ziyaretEdilen / aktif) * 100).toFixed(2)) : 0,
      });
    }
  }

  // ---- Panel C: temsilci performansı (son 30g) ------------------------------
  const reps: RepPerformanceRawRow[] = repAssignments.map((rep) => {
    const ziyaret = randInt(60, 220);
    const uniqueMusteri = Math.round(ziyaret * rand(0.5, 0.8));
    const aktifMusteri = Math.round(uniqueMusteri * rand(0.4, 0.75));
    const siparisliZiyaret = Math.round(ziyaret * rand(0.3, 0.6));
    const rutDisiSayisi = Math.round(ziyaret * rand(0.05, 0.2));
    return {
      repId: rep.repId,
      distId: rep.distKod,
      ad: rep.ad,
      distributor: rep.distributor,
      ziyaret,
      uniqueMusteri,
      aktifMusteri,
      siparisliZiyaret,
      donusumPct: ziyaret > 0 ? Number(((siparisliZiyaret / ziyaret) * 100).toFixed(2)) : 0,
      rutDisiPct: ziyaret > 0 ? Number(((rutDisiSayisi / ziyaret) * 100).toFixed(2)) : 0,
    };
  });

  // ---- Panel D: rut içi/dışı dönüşüm (dist bazlı) ---------------------------
  const conversion: VisitConversionRawRow[] = [];
  for (const dist of DISTRIBUTORS) {
    for (const tip of ["Rut İçi", "Rut Dışı"] as const) {
      const ziyaret = tip === "Rut İçi" ? randInt(450, 900) : randInt(60, 180);
      const siparisli = Math.round(ziyaret * (tip === "Rut İçi" ? rand(0.4, 0.6) : rand(0.15, 0.35)));
      const faturali = Math.round(siparisli * rand(0.75, 0.95));
      const irsaliyeli = Math.round(faturali * rand(0.5, 0.8));
      conversion.push({ distId: dist.distKod, tip, ziyaret, siparisli, faturali, irsaliyeli });
    }
  }

  // ---- Panel E: distribütör karşılaştırma (son 30g) -------------------------
  const distributors: DistributorComparisonRawRow[] = DISTRIBUTORS.map((dist) => {
    const distVisits = visitDaily.filter((r) => r.distId === dist.distKod);
    const ziyaret = distVisits.reduce((a, r) => a + r.toplam, 0);
    const kapsananMusteri = Math.round(ziyaret * rand(0.35, 0.55));
    const aktifTemsilci = repAssignments.filter((r) => r.distKod === dist.distKod).length;
    const donusumPct = Number(rand(28, 55).toFixed(2));
    return {
      distKod: dist.distKod,
      distributor: dist.ad,
      bolge: dist.bolge,
      aktifTemsilci,
      ziyaret,
      kapsananMusteri,
      donusumPct,
    };
  });

  return {
    visitDaily,
    kpi,
    coverage,
    reps,
    conversion,
    distributors,
    generatedAt: new Date().toISOString(),
  };
}

// ---------- Public API ------------------------------------------------------

/**
 * Saha Operasyon (Dashboard #5) demo cache'ini pre-bake eder.
 * `getWietnauerSahaSnapshot()` varsayılan parametrelerle çağrıldığında
 * MSSQL'e hiç dokunmadan bu snapshot'ı okur (cache hit, CACHE_KEY="v7-30g-all").
 */
export function seedSaha(): void {
  const bundle = buildBundle();
  cachedWrite(CACHE_DOMAIN, CACHE_KEY, bundle, 900);
  console.log(
    `[demo-seed/saha] cache_entries yazıldı: domain="${CACHE_DOMAIN}" key="${CACHE_KEY}" ` +
      `(visitDaily=${bundle.visitDaily.length}, reps=${bundle.reps.length}, ` +
      `distributors=${bundle.distributors.length}, coverage=${bundle.coverage.length}, ` +
      `conversion=${bundle.conversion.length})`,
  );
}

// Doğrudan `npx tsx tools/demo-seed/saha.ts` ile çalıştırıldığında otomatik seed et.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedSaha();
}
