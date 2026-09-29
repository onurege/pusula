/**
 * FMCG Demo seed — Müşteri Segmentasyon (Wietnauer Dashboard #3) cache pre-bake.
 *
 * `packages/core/src/wietnauer-segment.ts`'teki `getWietnauerSegmentSnapshot()`
 * fonksiyonu `withCache<RawSegmentBundle>(CACHE_DOMAIN, cacheKey, loader)` ile
 * MSSQL'e gider. Demo'da (fmcg-demo, MSSQL yok) bu loader hiç tetiklenmemeli —
 * bu dosya `cache_entries` tablosuna doğrudan aynı domain/key altında sentetik
 * bir `RawSegmentBundle` yazar; böylece cache HIT olur ve ekran offline çalışır
 * (`cachedWrite` upsert eder, ön koşul olarak MSSQL/tenant bağlantısı gerekmez).
 *
 * KESİN domain + key (wietnauer-segment.ts kaynağından doğrulandı):
 *   CACHE_DOMAIN  = "wietnauer-segment"                        (wietnauer-segment.ts:60)
 *   CACHE_VERSION = "v7"                                       (wietnauer-segment.ts:74)
 *   cacheKey      = `${CACHE_VERSION}-${win.key}-${cityCacheTag(cities)}`
 *                                                               (wietnauer-segment.ts:1007)
 *   - `win = resolveWindowBounds(dateFrom, dateTo)` — parametresiz/varsayılan
 *     çağrıda (dateFrom/dateTo verilmez) now.ts'teki fallback dalına düşer:
 *     `key: \`${fallbackDays}g\`\`, fallbackDays=30 → "30g" (now.ts:145-163).
 *   - `cities = allowedCities ?? null` — demo'da merkez/kısıtsız erişim
 *     varsayımıyla `cityCacheTag(null)` → "all" (auth.ts:404-406, `if (!cities) return "all"`).
 *   ⇒ CACHE_KEY = "v7-30g-all"  — UI'ın varsayılan (filtre uygulanmamış) görünümünün
 *     okuduğu TEK anahtar.
 *
 * `RawSegmentBundle` ve alt `*RawRow` tipleri wietnauer-segment.ts içinde
 * `export` EDİLMEMİŞ (module-private, satır 197-981) — `@enroute/core`'dan
 * import edilemezler. Bu yüzden burada alan-alan BİREBİR eşleşen yerel
 * kopyalar tanımlanır. Şema kayarsa (CACHE_VERSION v8+ olursa) bu dosyanın da
 * güncellenmesi gerekir, aksi halde demo stale/boş cache okur.
 */
import { cachedWrite } from "@enroute/core";

const CACHE_DOMAIN = "wietnauer-segment";
const CACHE_KEY = "v7-30g-all";

// ---------- Deterministik RNG (seed-fmcg-demo.ts ile aynı desen — xorshift32) ----------
function makeRng(seed: number) {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000_000) / 1_000_000_000;
  };
}
const rng = makeRng(20260915);
const rand = (min: number, max: number) => min + rng() * (max - min);

// ---------- RawSegmentBundle yerel kopyası (wietnauer-segment.ts private tipleri) ----------

/** A) Müşteri Grubu + C) Müşteri Tipi ortak ham satır şekli (TipSegmentRawRow). */
type TipSegmentRawRow = {
  kod: string;
  ad: string;
  distId: number | null;
  musteriSayi: number;
  ciro: number;
  brut: number;
  iskonto: number;
};

/** B) Müşteri Ek Grubu (bayilik formatı) ham satır şekli (EkGrupSegmentRawRow). */
type EkGrupSegmentRawRow = {
  kod: string;
  ad: string;
  distId: number | null;
  musteriSayi: number;
  aktifMusteri: number;
  ciro: number;
};

/** D) Cirosal segment ham satır şekli (CirosalSegmentRawRow) — demo'da boş
 *  bırakılır: Wietnauer'da bu boyut da sık boş, UI empty-state ile karşılar
 *  (bkz. wietnauer-segment.ts:24-26, :119-126). */
type CirosalSegmentRawRow = {
  segment: string;
  distId: number | null;
  musteriSayi: number;
  ciro: number;
};

/** E) Müşteri Tipi × Marka cross ham satır şekli (SegmentBrandCrossRawRow). */
type SegmentBrandCrossRawRow = {
  tipKod: string;
  tipAd: string;
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro: number;
};

/** F) Ek Grup bazında iskonto ham satır şekli (EkGrupIskontoRawRow). */
type EkGrupIskontoRawRow = {
  kod: string;
  ad: string;
  distId: number | null;
  iskonto: number;
  brut: number;
  ciro: number;
};

/** F) Nokta (müşteri) bazında iskonto ham satır şekli (MusteriIskontoRawRow). */
type MusteriIskontoRawRow = {
  musteriKod: number;
  distId: number | null;
  unvan: string;
  ekGrupAd: string | null;
  iskonto: number;
  brut: number;
  ciro: number;
};

/** wietnauer-segment.ts `RawSegmentBundle` ile birebir alan eşleşmesi. */
type RawSegmentBundle = {
  musteriGrubu: TipSegmentRawRow[];
  ekGrup: EkGrupSegmentRawRow[];
  ekSaha: TipSegmentRawRow[];
  cirosal: CirosalSegmentRawRow[];
  ekGrupIskonto: EkGrupIskontoRawRow[];
  musteriIskonto: MusteriIskontoRawRow[];
  cross: SegmentBrandCrossRawRow[];
  generatedAt: string;
};

// Not: aşağıdaki tüm ham satırlarda `distId: null` kullanılır — demo'da
// merkez/kısıtsız erişim varsayılır (`getWietnauerSegmentSnapshot` içindeki
// `inScope()` yalnızca `allowedDistKods`/`distId` seçenekleri geçildiğinde
// dist bazlı filtreler; merkez görünümde `effectiveDistKods == null` → tüm
// satırlar scope'ta sayılır). Satırlar zaten dimension bazında ÖN-toplanmış
// tek satır olarak verilir; `aggregateTipSegment` vb. fonksiyonlar bu tekil
// satırları kendileriyle "toplayıp" (no-op) aynen geçirir.

// ---------- A) Müşteri Grubu — Müşteri Grup Kırılımı (Prestige/Premium/…/Ekonomik) ----------

const MUSTERI_GRUBU = [
  { kod: "1", ad: "Prestige", musteriSayi: 120, ciroBase: 8_500_000, iskontoPct: 7.6 },
  { kod: "2", ad: "Premium", musteriSayi: 340, ciroBase: 6_200_000, iskontoPct: 8.8 },
  { kod: "3", ad: "Standart", musteriSayi: 980, ciroBase: 4_100_000, iskontoPct: 9.9 },
  { kod: "4", ad: "Ekonomik", musteriSayi: 1450, ciroBase: 2_050_000, iskontoPct: 10.9 },
  { kod: "0", ad: "(Tanımsız)", musteriSayi: 110, ciroBase: 180_000, iskontoPct: 10.0 },
] as const;

function buildTipSegmentRow(
  kod: string,
  ad: string,
  musteriSayi: number,
  ciro: number,
  iskontoPct: number,
): TipSegmentRawRow {
  const brut = Math.round(ciro / (1 - iskontoPct / 100));
  const iskonto = Math.round(brut - ciro);
  return { kod, ad, distId: null, musteriSayi, ciro: Math.round(ciro), brut, iskonto };
}

function buildMusteriGrubu(): TipSegmentRawRow[] {
  return MUSTERI_GRUBU.map((s) =>
    buildTipSegmentRow(s.kod, s.ad, s.musteriSayi, s.ciroBase * rand(0.94, 1.06), s.iskontoPct),
  );
}

// ---------- C) Müşteri Tipi — Kanal Mix (Zincir Market/Bakkal/Mini Market/Horeca…) ----------

const MUSTERI_TIPI = [
  { kod: "10", ad: "Zincir Market", musteriSayi: 210, ciroBase: 9_800_000, iskontoPct: 7.5 },
  { kod: "11", ad: "Bakkal", musteriSayi: 1600, ciroBase: 5_400_000, iskontoPct: 9.3 },
  { kod: "12", ad: "Mini Market", musteriSayi: 780, ciroBase: 3_600_000, iskontoPct: 8.9 },
  { kod: "13", ad: "Horeca", musteriSayi: 340, ciroBase: 1_950_000, iskontoPct: 9.3 },
  { kod: "14", ad: "Hipermarket", musteriSayi: 60, ciroBase: 1_500_000, iskontoPct: 7.4 },
  { kod: "0", ad: "(Tanımsız)", musteriSayi: 60, ciroBase: 100_000, iskontoPct: 9.1 },
] as const;

function buildEkSaha(): TipSegmentRawRow[] {
  return MUSTERI_TIPI.map((s) =>
    buildTipSegmentRow(s.kod, s.ad, s.musteriSayi, s.ciroBase * rand(0.94, 1.06), s.iskontoPct),
  );
}

// ---------- B) Müşteri Ek Grubu — bayilik formatı ----------

const EK_GRUP = [
  { kod: "B1", ad: "BAKKAL", musteriSayi: 1500, aktifOran: 0.8, ciroBase: 5_000_000 },
  { kod: "B2", ad: "MARKET", musteriSayi: 700, aktifOran: 0.87, ciroBase: 4_200_000 },
  { kod: "B3", ad: "MİNİ MARKET", musteriSayi: 600, aktifOran: 0.8, ciroBase: 2_800_000 },
  { kod: "B4", ad: "BÜFE", musteriSayi: 300, aktifOran: 0.7, ciroBase: 900_000 },
  { kod: "B5", ad: "FRANCHISE", musteriSayi: 90, aktifOran: 0.91, ciroBase: 2_600_000 },
  { kod: "B6", ad: "HİPERMARKET", musteriSayi: 40, aktifOran: 0.95, ciroBase: 1_700_000 },
] as const;

function buildEkGrup(): EkGrupSegmentRawRow[] {
  return EK_GRUP.map((g) => ({
    kod: g.kod,
    ad: g.ad,
    distId: null,
    musteriSayi: g.musteriSayi,
    aktifMusteri: Math.round(g.musteriSayi * g.aktifOran),
    ciro: Math.round(g.ciroBase * rand(0.94, 1.06)),
  }));
}

// ---------- F) Ek Grup bazında iskonto kırılımı (md35) ----------

const EK_GRUP_ISKONTO_PCT: Record<string, number> = {
  B1: 6.0,
  B2: 9.0,
  B3: 7.9,
  B4: 6.7,
  B5: 10.0,
  B6: 11.8,
};

function buildEkGrupIskonto(ekGrup: EkGrupSegmentRawRow[]): EkGrupIskontoRawRow[] {
  return ekGrup.map((g) => {
    const pct = EK_GRUP_ISKONTO_PCT[g.kod] ?? 8.0;
    const brut = Math.round(g.ciro / (1 - pct / 100));
    const iskonto = Math.round(brut - g.ciro);
    return { kod: g.kod, ad: g.ad, distId: null, iskonto, brut, ciro: g.ciro };
  });
}

// ---------- F) Nokta (müşteri) bazında iskonto — Top 20 ----------

const MUSTERI_ISKONTO_HEADS = [
  "ASLAN", "GÜVEN", "ALTIN", "ZAFER", "MAVİ", "ANADOLU", "EGE", "GÜNEŞ",
  "YILDIZ", "DENİZ", "BÜYÜK", "SARP", "DOĞU", "KARTAL", "BEREKET", "PINAR",
  "TURGUT", "CESUR", "USTA", "DEMİR",
];
const MUSTERI_ISKONTO_TAILS = ["MARKET", "BAKKAL", "MİNİ MARKET", "GIDA", "TİCARET"];

function buildMusteriIskonto(ekGrup: EkGrupSegmentRawRow[]): MusteriIskontoRawRow[] {
  const ekGrupAdlar = ekGrup.map((g) => g.ad);
  return MUSTERI_ISKONTO_HEADS.map((head, i) => {
    const tail = MUSTERI_ISKONTO_TAILS[i % MUSTERI_ISKONTO_TAILS.length]!;
    // Top 20'de kademeli azalan iskonto — ilk satır en yüksek.
    const iskonto = Math.round(90_000 * Math.pow(0.905, i) * rand(0.92, 1.08));
    const pct = rand(6, 13);
    const brut = Math.round((iskonto * 100) / pct);
    const ciro = Math.round(brut - iskonto);
    return {
      musteriKod: 2_000_000 + i,
      distId: null,
      unvan: `${head} ${tail}`,
      ekGrupAd: rng() < 0.85 ? ekGrupAdlar[i % ekGrupAdlar.length]! : null,
      iskonto,
      brut,
      ciro,
    };
  });
}

// ---------- E) Cross-segment: Müşteri Tipi × Marka ----------

const MARKALAR = [
  { kod: "M1", ad: "ÇİKOMASTER", agirlik: 18 },
  { kod: "M2", ad: "GOFRETKING", agirlik: 14 },
  { kod: "M3", ad: "KAHVELİDER", agirlik: 8 },
  { kod: "M4", ad: "ÇIKIRBİS", agirlik: 11 },
  { kod: "M5", ad: "MISIRKING", agirlik: 9 },
  { kod: "M6", ad: "TAMMAVİ", agirlik: 8 },
  { kod: "M7", ad: "TEMİZ-YOL", agirlik: 9 },
  { kod: "M8", ad: "JELSTAR", agirlik: 5 },
  { kod: "M9", ad: "Diğer", agirlik: 18 },
] as const;

function buildCross(ekSaha: TipSegmentRawRow[]): SegmentBrandCrossRawRow[] {
  const cells: SegmentBrandCrossRawRow[] = [];
  for (const tip of ekSaha) {
    if (tip.kod === "0") continue; // (Tanımsız) heatmap eksenine girmez
    for (const marka of MARKALAR) {
      const ciro = Math.round(tip.ciro * (marka.agirlik / 100) * rand(0.8, 1.2));
      cells.push({
        tipKod: tip.kod,
        tipAd: tip.ad,
        markaKod: marka.kod,
        marka: marka.ad,
        distId: null,
        ciro,
      });
    }
  }
  return cells;
}

// ---------- Public API -------------------------------------------------------

/**
 * `cache_entries` tablosuna `wietnauer-segment` domain'i + `v7-30g-all`
 * anahtarı altında sentetik bir `RawSegmentBundle` yazar (upsert). Demo API
 * süreci ayağa kalktığında `getWietnauerSegmentSnapshot()` bu satırı
 * `withCache` üzerinden okur; MSSQL'e hiç gidilmez.
 */
export function seedSegment(): void {
  const musteriGrubu = buildMusteriGrubu();
  const ekSaha = buildEkSaha();
  const ekGrup = buildEkGrup();

  const bundle: RawSegmentBundle = {
    musteriGrubu,
    ekGrup,
    ekSaha,
    // D) Wietnauer'da genelde boş — UI empty-state ile karşılar
    // (bkz. wietnauer-segment.ts:24-26, :119-126).
    cirosal: [],
    ekGrupIskonto: buildEkGrupIskonto(ekGrup),
    musteriIskonto: buildMusteriIskonto(ekGrup),
    cross: buildCross(ekSaha),
    generatedAt: new Date().toISOString(),
  };

  // 4. parametre `durationMs` (cache.ts `cachedWrite`) — kb DEĞİL, ms cinsinden
  // "fetch süresi" göstergesidir (UI'da yalnızca gözlemlenebilirlik amaçlı).
  cachedWrite(CACHE_DOMAIN, CACHE_KEY, bundle, 420);
}

// Doğrudan çalıştırılırsa (`npx tsx tools/demo-seed/segment.ts`) hemen seed'le.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedSegment();
  console.log(`[demo-seed/segment] cache_entries yazıldı: ${CACHE_DOMAIN} / ${CACHE_KEY}`);
}
