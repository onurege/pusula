import { withCache } from "./cache.js";
import { runReadOnly } from "./db.js";
import { generate } from "./gemini.js";
import {
  currentYyyymm,
  getMultiplier,
  loadInflation,
  yyyymmDaysAgo,
  yyyymmYearsAgo,
  type InflationData,
} from "./inflation.js";
import { getOtvRate, loadOtv, type OtvData } from "./tax.js";
import { currentDate, demoDate, sqlNow } from "./now.js";
import { canonicalProvince, loadRegionMaster, normalizeProvince } from "./tr-regions.js";
import { distFilterClause, type TenantScope } from "./auth.js";
import { getTenantConfig } from "./tenant/index.js";

/**
 * Komuta Köprüsü — CEO / Satış Direktörü ekranı için veri agregatları.
 *
 * Mockup orijinalde Pernod Ricard markaları (Chivas, Royal Salute, Martell)
 * üzerinden konuşuyordu; bizim Univera test DB'mizde bu markalar yok. Bu
 * yüzden bazı KPI'lar yerli (Univera-uyumlu) eşdeğeriyle değiştirildi:
 *   - "Hedef Tutturma %" → "Birim Hacim" (toplam DBLMIKTAR; 9L kasa
 *     hesaplamasının ham hâli — product volume master eklenince çevrilebilir)
 *   - "Premium Mix %" → "Top Marka Payı %" (en çok satan ürün grubunun toplam
 *     içindeki payı)
 *   - "Bölge Müdürü Sıralaması" → "Top Satış Temsilcileri"
 *   - "Kanal Mix" → "Distribütör Kırılımı"
 *
 * Tüm sorgular cache'leniyor (withCache → SQLite mirror) — Map sayfasındaki
 * "Verileri yenile" butonu invalidate eder.
 */

const CACHE_DOMAIN = "komuta";

// ---------------------------------------------------------------------------
// Product tier classifier (data/brands/tier-classification.json'dan)
// ---------------------------------------------------------------------------

type TierMaster = {
  tiers: Partial<Record<"luxury" | "premium" | "core", string[]>>;
};

let tierMasterCache: TierMaster | null = null;

async function loadTierMaster(): Promise<TierMaster> {
  if (tierMasterCache) return tierMasterCache;
  try {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(__dirname, "../../..");
    const raw = await fs.readFile(
      path.join(repoRoot, "data/brands/tier-classification.json"),
      "utf-8",
    );
    tierMasterCache = JSON.parse(raw) as TierMaster;
  } catch (err) {
    console.warn("[komuta] tier master yüklenemedi, varsayılan 'value':", err);
    tierMasterCache = { tiers: {} };
  }
  return tierMasterCache;
}

/**
 * Ürün grubu / ürün adından tier sınıflandırır.
 * Lüks > Premium > Core sırasında kontrol; eşleşme bulunmazsa 'value'.
 *
 * Eşleşme substring (case-insensitive, Türkçe karakter dönüşümlü).
 */
export function classifyTier(name: string, master: TierMaster): ProductTier {
  if (!name) return "value";
  const upper = trUpper(name);
  for (const tier of ["luxury", "premium", "core"] as const) {
    const patterns = master.tiers[tier] ?? [];
    for (const p of patterns) {
      if (upper.includes(trUpper(p))) return tier;
    }
  }
  return "value";
}

function trUpper(s: string): string {
  return s
    .replace(/i/g, "İ")
    .replace(/ı/g, "I")
    .toUpperCase();
}

export type KomutaKpiCard = {
  id: string;
  label: string;
  value: number;
  format: "currency" | "count" | "percent" | "compact";
  unit?: string;
  delta?: number;
  deltaSub?: string;
};

/** Bir bölge içindeki bir şehrin (il) YoY kırılımı — Komuta haritası
 *  drill-down'unda kullanılır. */
export type KomutaCityBreakdown = {
  /** İl adı (TBLMUSTERI.TXTSEHIR — normalize edilmeden, ham). */
  sehir: string;
  /** Master JSON'daki normalize il adı — geojson eşleştirmesi için. */
  sehirNorm: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
};

export type KomutaRegionRow = {
  /** Klasik 7 bölge + Kıbrıs adı — data/geo/tr-province-region.json'dan
   *  ("Marmara", "Ege", "Akdeniz", "İç Anadolu", "Karadeniz", "Doğu Anadolu",
   *  "Güneydoğu Anadolu", "Kıbrıs"). */
  bolge: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
  /** Bölgenin master rengi (tr-province-region.json) — /map ile aynı palette;
   *  Komuta haritasında il polygon dolgusu bu rengi kullanır. */
  color: string;
  /** Bu bölgeye agrege edilen Pernod şehirlerinin listesi — debug/tooltip
   *  amaçlı. Örn. Doğu Anadolu = ["VAN", "ERZURUM", ...]. */
  sehirler: string[];
  /** Bölge içindeki her şehrin YoY kırılımı — Komuta drill-down'ında
   *  haritada şehirler bu kendi YoY'larına göre boyanır. */
  cities: KomutaCityBreakdown[];
};

export type KomutaChannelSlice = {
  name: string;
  ciro: number;
  pct: number;
  color: string;
};

export type KomutaMonthlyBar = {
  yyyymm: string;
  ay: string;
  ciro: number;
  ciroPrev: number | null; // 12 ay öncesi aynı ayın cirosu (geçen yıl hizalı)
  isRamazan: boolean;
  isCurrent: boolean;
  isSummer: boolean;
};

/**
 * Aylık kanal (müşteri grubu) kırılımı — son 12 ay × top kanallar + "Diğer".
 * Stacked bar chart için flat row formatı: her satır (ay, kanal, ciro).
 * Frontend tarafında pivot edilir.
 */
export type KomutaChannelMonthlyRow = {
  /** YYYY-MM, sıralama anahtarı */
  yyyymm: string;
  /** Türkçe kısa ay etiketi: Oca/Şub/.../Ara */
  ay: string;
  /** Kanal adı (HORECA, Off-trade, Otel, ... veya "Diğer") */
  kanal: string;
  ciro: number;
};

export type ProductTier = "luxury" | "premium" | "core" | "value";

export type KomutaMatrixRow = {
  grup: string;
  tier: ProductTier;
  buAy: number;
  gecenAy: number;
  ucAyOnce: number;
  gecenYil: number;
  ikiYilOnce: number;
  yoyPct: number | null;
  trend: "rocket" | "up" | "flat" | "down";
};

export type KomutaHeatmapCell = {
  bolge: string;
  grup: string;
  yoyPct: number | null;
  bucket: "fire" | "hot" | "warm" | "flat" | "cool" | "cold";
};

export type KomutaHeatmapRow = {
  bolge: string;
  distSayisi: number;
  cells: KomutaHeatmapCell[];
  rowAvgPct: number | null;
};

export type KomutaRep = {
  ad: string;
  distributor: string | null;
  ciro: number;
  faturaSayisi: number;
  rank: number;
};

export type KomutaTopDist = {
  ad: string;
  bolge: string | null;
  ciro: number;
  faturaSayisi: number;
  rank: number;
};

export type KomutaPortfolioRow = {
  grup: string;
  tier: ProductTier;
  bu: number;
  oneYearAgo: number;
  twoYearsAgo: number;
  yoyPct: number | null;
  twoYrPct: number | null;
};

export type KomutaUpcomingEvent = {
  name: string;
  date: string;
  daysAhead: number;
  kind: string;
  yoyImpact?: number;
};

/**
 * Komuta değer birimi — TL ciro vs 9-Litre-Equivalent (volume).
 * Tüm panel veri akışı bu birime göre hesaplanır; UI suffix'i de switch eder
 * ("₺" vs "9LE"). Demo manager TL'den 9L'ye geçince bütün rakamlar
 * recompute olur.
 */
export type ValueUnit = "tl" | "9le";

export type KomutaSnapshot = {
  generatedAt: string;
  /** True ise geçmiş değerler bugünün parasına (TÜFE arındırılmış) çevrilmiş. */
  reelTL: boolean;
  /** True ise tüm ciro değerlerinden ÖTV (özel tüketim vergisi) düşülmüş. */
  otvNet: boolean;
  /** ÖTV-net modunda uygulanan ağırlıklı ortalama oran (görsel banner için). */
  otvAvgRate: number | null;
  /** Demo modda KOMUTA_DEMO_DATE değeri (YYYY-MM-DD); canlıda null. */
  demoDate: string | null;
  /** Snapshot'taki tüm value'ların birimi — UI suffix'i bundan beslenir. */
  unit: ValueUnit;
  kpis: KomutaKpiCard[];
  regions: KomutaRegionRow[];
  channels: KomutaChannelSlice[];
  channelMonthly: KomutaChannelMonthlyRow[];
  /** Pernod Müşteri Tipi (TBLMUSTERIEKSAHA saha 8) × 12 ay stacked breakdown.
   *  Perakende/On Trade/Otel/Tali Bayi/OPA gibi gerçek segmentasyon. */
  channelByType: KomutaChannelMonthlyRow[];
  monthlyTrend: KomutaMonthlyBar[];
  upcomingEvent: KomutaUpcomingEvent | null;
  matrix: KomutaMatrixRow[];
  heatmap: KomutaHeatmapRow[];
  reps: KomutaRep[];
  topDists: KomutaTopDist[];
  portfolio: KomutaPortfolioRow[];
  brief?: string;
};

// ---------------------------------------------------------------------------
// KPI Strip — 5 kart
// ---------------------------------------------------------------------------

async function fetchKpis(unit: ValueUnit, distClause: string): Promise<KomutaKpiCard[]> {
  // Son 30 gün vs önceki 30 gün karşılaştırma için tek seferde 4 metriği döner.
  // SQL unit'ten bağımsız — hem ciro (TL) hem miktar (9LE) her zaman hesaplanır.
  // Birim swap'i sadece UI çıktısında yapılır (primary KPI'nın value/label/unit'i).
  const sql = `
    WITH son AS (
      SELECT
        ISNULL(SUM(f.DBLNETTUTAR), 0)             AS ciro,
        COUNT(*)                                  AS fatura,
        COUNT(DISTINCT f.LNGMUSTERIKOD)           AS musteri
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
    ),
    onceki AS (
      SELECT
        ISNULL(SUM(f.DBLNETTUTAR), 0)             AS ciro,
        COUNT(DISTINCT f.LNGMUSTERIKOD)           AS musteri
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -60, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -30, ${sqlNow()})
        ${distClause}
    ),
    -- 9LE (9-Litre-Equivalent) — Pernod kendi resmi katsayısını TBLURUNEKSAHA
    -- saha 26 "9 LT Değer" alanında tutuyor. Her ürünün 1 adetinin kaç 9LE'ye
    -- denk geldiği nümerik string olarak orada yazıyor (örn. "0.03888889" =
    -- 0.35L şişe / 9).
    --
    -- Formül: SUM(DBLMIKTAR × ek_saha_26)
    -- Fallback: ek saha boşsa (701 ürün için dolu, geri kalan için yok)
    -- klasik DBLLITRE/9 hesabına düş — toplam 0 olmasın.
    miktar AS (
      SELECT ISNULL(SUM(
        d.DBLMIKTAR * ISNULL(
          TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA),
          ISNULL(u.DBLLITRE, 0) / 9.0
        )
      ), 0) AS adet
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNEKSAHA ue
        ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
    ),
    miktar_onceki AS (
      SELECT ISNULL(SUM(
        d.DBLMIKTAR * ISNULL(
          TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA),
          ISNULL(u.DBLLITRE, 0) / 9.0
        )
      ), 0) AS adet
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNEKSAHA ue
        ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -60, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -30, ${sqlNow()})
        ${distClause}
    ),
    top_grup AS (
      SELECT TOP 1
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        SUM(d.DBLNETFIYAT) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    ),
    -- Pay ve payda aynı tabandan (DBLNETFIYAT*DBLMIKTAR — detay seviyesi)
    -- olmalı. son.ciro (faturanın DBLNETTUTAR'ı) farklı taban → top_grup
    -- payı için yanıltıcı. Bu CTE detay toplamı verir.
    detay_total AS (
      SELECT ISNULL(SUM(d.DBLNETFIYAT), 0) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
    )
    SELECT
      son.ciro       AS son_ciro,
      onceki.ciro    AS onceki_ciro,
      son.fatura     AS son_fatura,
      son.musteri    AS son_musteri,
      onceki.musteri AS onceki_musteri,
      miktar.adet    AS son_adet,
      miktar_onceki.adet AS onceki_adet,
      detay_total.ciro AS detay_total_ciro,
      (SELECT TOP 1 grup FROM top_grup) AS top_grup_ad,
      (SELECT TOP 1 ciro FROM top_grup) AS top_grup_ciro
    FROM son, onceki, miktar, miktar_onceki, detay_total
  `;
  const out = await runReadOnly(sql, { limit: 1, timeoutMs: 60_000 });
  const r = (out.rows[0] ?? {}) as Record<string, unknown>;

  const sonCiro = Number(r.son_ciro ?? 0);
  const oncekiCiro = Number(r.onceki_ciro ?? 0);
  const sonFatura = Number(r.son_fatura ?? 0);
  const sonMusteri = Number(r.son_musteri ?? 0);
  const oncekiMusteri = Number(r.onceki_musteri ?? 0);
  const sonAdet = Number(r.son_adet ?? 0);
  const oncekiAdet = Number(r.onceki_adet ?? 0);
  const topGrupCiro = Number(r.top_grup_ciro ?? 0);
  const detayTotalCiro = Number(r.detay_total_ciro ?? 0);
  const sepet = sonFatura > 0 ? sonCiro / sonFatura : 0;
  // Pay yüzdesi detay-tabanına göre (DBLNETFIYAT*DBLMIKTAR), faturanın
  // DBLNETTUTAR'ına değil; ikisi farklı seviyeler.
  const topGrupPct = detayTotalCiro > 0 ? (topGrupCiro / detayTotalCiro) * 100 : 0;

  // Birim-bağımlı KPI seçimi — 9LE modunda Ciro yerine Hacim primary olur.
  const isVolume = unit === "9le";
  const primaryValue = isVolume ? sonAdet : sonCiro;
  const primaryPrev = isVolume ? oncekiAdet : oncekiCiro;
  const primaryLabel = isVolume
    ? "Toplam Hacim (9L) · 30 gün"
    : "Toplam Net Ciro · 30 gün";
  const primaryUnit = isVolume ? "9L" : "₺";
  const primaryFormat: KomutaKpiCard["format"] = isVolume ? "count" : "compact";

  return [
    {
      id: "ciro",
      label: primaryLabel,
      value: primaryValue,
      format: primaryFormat,
      unit: primaryUnit,
      delta:
        primaryPrev > 0
          ? ((primaryValue - primaryPrev) / primaryPrev) * 100
          : (null as never),
      deltaSub:
        primaryPrev > 0
          ? `vs önceki 30g (${formatCompact(primaryPrev)} ${primaryUnit})`
          : "geçmiş veri yok",
    },
    // İkinci KPI — primary TL ise Hacim'i, primary 9LE ise toplam fatura
    // sayısını göster (volume modunda Hacim duplicate olur, anlamsız).
    isVolume
      ? {
          id: "fatura",
          label: "Toplam Fatura · 30 gün",
          value: sonFatura,
          format: "count" as const,
          delta:
            r.onceki_fatura != null && Number(r.onceki_fatura) > 0
              ? ((sonFatura - Number(r.onceki_fatura)) /
                  Number(r.onceki_fatura)) *
                100
              : (null as never),
          deltaSub: `${sonFatura.toLocaleString("tr-TR")} fatura`,
        }
      : {
          id: "hacim",
          label: "Hacim (9L) · 30 gün",
          value: sonAdet,
          format: "count" as const,
          unit: "9L",
          delta:
            oncekiAdet > 0
              ? ((sonAdet - oncekiAdet) / oncekiAdet) * 100
              : (null as never),
          deltaSub:
            oncekiAdet > 0
              ? `vs önceki 30g (${Math.round(oncekiAdet).toLocaleString("tr-TR")} 9L)`
              : "geçmiş veri yok",
        },
    {
      id: "top_marka",
      label: "Top Marka Payı · 30 gün",
      value: topGrupPct,
      format: "percent",
      // Görsel tutarlılık için top grup'un proportional fatura cirosunu
      // göster (detay tabanı yerine fatura tabanı): son ciro × pay yüzdesi.
      deltaSub: `${(r.top_grup_ad as string) ?? "—"} (${formatCompact(sonCiro * (topGrupPct / 100))} ₺)`,
    },
    {
      id: "musteri",
      label: "Aktif Satış Noktası · 30 gün",
      value: sonMusteri,
      format: "count",
      delta: oncekiMusteri > 0
        ? ((sonMusteri - oncekiMusteri) / oncekiMusteri) * 100
        : null as never,
      deltaSub: oncekiMusteri > 0
        ? `${sonMusteri - oncekiMusteri >= 0 ? "+" : ""}${(sonMusteri - oncekiMusteri).toLocaleString("tr-TR")} vs önceki 30g`
        : "geçmiş veri yok",
    },
    isVolume
      ? {
          id: "sepet",
          label: "Fatura başına 9L · 30 gün",
          value: sonFatura > 0 ? Math.round((sonAdet / sonFatura) * 10) / 10 : 0,
          format: "count" as const,
          unit: "9L",
          deltaSub: `${sonFatura.toLocaleString("tr-TR")} fatura üzerinden`,
        }
      : {
          id: "sepet",
          label: "Ortalama Sepet · 30 gün",
          value: Math.round(sepet),
          format: "currency" as const,
          unit: "₺",
          deltaSub: `${sonFatura.toLocaleString("tr-TR")} fatura üzerinden`,
        },
  ];
}

// ---------------------------------------------------------------------------
// Bölge bazlı ciro + YoY (harita için)
//
// TBLDIST.TXTGRUP → TBLDISTGRUP.TXTKOD üzerinden distribütör bölgesini çekiyor.
// Bu mockup'taki "İstanbul Avrupa / Anadolu / Marmara / Ege ..." gibi gerçek
// dağıtım bölgesi ayrımına denk düşer; şehir kullanmaktan daha doğru çünkü
// distribütör network'ü zaten bölgeye atanmış.
// ---------------------------------------------------------------------------

async function fetchRegions(unit: ValueUnit, distClause: string): Promise<KomutaRegionRow[]> {
  // /map sayfası ile tutarlılık için şehir-bazlı agregasyon. TBLDISTGRUP
  // (bayi grubu adı) yerine TBLMUSTERI.TXTSEHIR (müşterinin şehri) → klasik
  // 7 bölge mapping'i yapıyoruz. Kaynak: data/geo/tr-province-region.json.
  //
  // Avantaj: Pernod'un Doğu Anadolu bayi grubu olmasa bile Van/Erzurum'daki
  // müşteriler "Doğu Anadolu"ya doğru agregat olur. Alias hack'i yok,
  // resmi 81 il → 8 bölge eşlemesi tek master üzerinden.
  const valueExpr = unitValueExpr(unit, {
    faturaTL: "f.DBLNETTUTAR",
    miktarAlias: "d9.DBLMIKTAR",
    eksahaAlias: "ue.TXTEKSAHAACIKLAMA",
    urunAlias: "u",
  });
  const joins = unit9leJoins(unit, { detayAlias: "d9", faturaAlias: "f" });
  const sql = `
    WITH son AS (
      SELECT
        m.TXTSEHIR         AS sehir,
        ${valueExpr}       AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      ${joins}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        AND m.TXTSEHIR IS NOT NULL
        ${distClause}
      GROUP BY m.TXTSEHIR
    ),
    onceki AS (
      SELECT
        m.TXTSEHIR         AS sehir,
        ${valueExpr}       AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      ${joins}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
        AND m.TXTSEHIR IS NOT NULL
        ${distClause}
      GROUP BY m.TXTSEHIR
    )
    SELECT
      COALESCE(s.sehir, o.sehir) AS sehir,
      ISNULL(s.ciro, 0)          AS ciro,
      ISNULL(o.ciro, 0)          AS ciroPrev
    FROM son s
    FULL OUTER JOIN onceki o ON o.sehir = s.sehir
    ORDER BY ISNULL(s.ciro, 0) DESC
  `;
  const out = await runReadOnly(sql, { limit: 200, timeoutMs: 60_000 });

  // Şehirleri klasik 7 bölgeye + Kıbrıs'a topla. Master JSON il adlarını
  // diacritic-strip normalize ile saklıyor (İSTANBUL → ISTANBUL); o yüzden
  // burada da normalizeProvince ile arıyoruz.
  const master = await loadRegionMaster();
  type CityAgg = { sehir: string; sehirNorm: string; ciro: number; ciroPrev: number };
  type Agg = {
    ciro: number;
    ciroPrev: number;
    sehirler: Set<string>;
    cities: Map<string, CityAgg>; // key = sehirNorm
  };
  const byRegion = new Map<string, Agg>();
  // 8 bölgenin hepsini önceden seed et — sıfır cirolu bölge bile sonuçta
  // bulunsun. Harita "veri yok" olarak gösterebilir.
  for (const region of master.byRegion.keys()) {
    byRegion.set(region, {
      ciro: 0,
      ciroPrev: 0,
      sehirler: new Set(),
      cities: new Map(),
    });
  }
  const unmatched = new Set<string>();
  for (const r of out.rows) {
    const sehir = String(r.sehir ?? "").trim();
    if (!sehir) continue;
    const rawNorm = normalizeProvince(sehir);
    const info = master.byProvince.get(rawNorm);
    if (!info) {
      unmatched.add(sehir);
      continue;
    }
    // ALIAS → KANONİK (geojson'da olan) — örn. "AFYONKARAHISAR" → "AFYON"
    const norm = canonicalProvince(rawNorm);
    const agg = byRegion.get(info.region)!;
    const ciro = Number(r.ciro ?? 0);
    const ciroPrev = Number(r.ciroPrev ?? 0);
    agg.ciro += ciro;
    agg.ciroPrev += ciroPrev;
    agg.sehirler.add(sehir);
    // Per-city kırılımı sakla — kanonik isimle merge
    const existing = agg.cities.get(norm);
    if (existing) {
      existing.ciro += ciro;
      existing.ciroPrev += ciroPrev;
    } else {
      agg.cities.set(norm, { sehir, sehirNorm: norm, ciro, ciroPrev });
    }
  }
  if (unmatched.size > 0) {
    console.warn(
      `[komuta regions] ${unmatched.size} eşleşmeyen şehir (master JSON'a eklenmeli):`,
      Array.from(unmatched).slice(0, 20).join(", "),
    );
  }

  return Array.from(byRegion.entries())
    .map(([bolge, agg]) => {
      const info = master.byRegion.get(bolge)!;
      const deltaPct =
        agg.ciroPrev > 0 ? ((agg.ciro - agg.ciroPrev) / agg.ciroPrev) * 100 : null;
      const cities = Array.from(agg.cities.values())
        .map((c) => ({
          sehir: c.sehir,
          sehirNorm: c.sehirNorm,
          ciro: c.ciro,
          ciroPrev: c.ciroPrev,
          deltaPct:
            c.ciroPrev > 0 ? ((c.ciro - c.ciroPrev) / c.ciroPrev) * 100 : null,
        }))
        .sort((a, b) => b.ciro - a.ciro);
      return {
        bolge,
        ciro: agg.ciro,
        ciroPrev: agg.ciroPrev,
        deltaPct,
        color: info.color,
        sehirler: Array.from(agg.sehirler).sort(),
        cities,
      };
    })
    .sort((a, b) => b.ciro - a.ciro);
}

// ---------------------------------------------------------------------------
// Kanal Mix — müşteri grup bazında kırılım (HORECA / Off-trade / Otel vs.)
// TBLMSDFATURA → TBLMUSTERI.TXTGRUPKOD → TBLMUSTERIGRUP.TXTAD
// ---------------------------------------------------------------------------

const CHANNEL_COLORS = ["#d4a857", "#58a6ff", "#c084fc", "#3fb950", "#f0c674"];

async function fetchChannels(unit: ValueUnit, distClause: string): Promise<KomutaChannelSlice[]> {
  const valueExpr = unitValueExpr(unit, {
    faturaTL: "f.DBLNETTUTAR",
    miktarAlias: "d9.DBLMIKTAR",
    eksahaAlias: "ue.TXTEKSAHAACIKLAMA",
    urunAlias: "u",
  });
  const joins = unit9leJoins(unit, { detayAlias: "d9", faturaAlias: "f" });
  // Bu ay (last 30 gün) — müşteri grubuna göre Top 5 kanal
  const sql = `
    SELECT TOP 5
      ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Grupsuz)') AS ad,
      ISNULL(${valueExpr}, 0) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
    LEFT JOIN dbo.TBLMUSTERIGRUP g ON g.TXTKOD = m.TXTGRUPKOD
    ${joins}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND m.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      ${distClause}
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Grupsuz)')
    ORDER BY ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 5, timeoutMs: 30_000 });

  // Toplam — yüzde hesabı için (tüm müşteri grupları, top 5 dışındakiler dahil)
  const totSql = `
    SELECT ISNULL(${valueExpr}, 0) AS tot
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
    ${joins}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND m.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      ${distClause}
  `;
  const totOut = await runReadOnly(totSql, { limit: 1, timeoutMs: 20_000 });
  const total = Number((totOut.rows[0] ?? { tot: 0 }).tot ?? 0);

  return out.rows.map((r, i) => {
    const ciro = Number(r.ciro ?? 0);
    return {
      name: String(r.ad ?? ""),
      ciro,
      pct: total > 0 ? (ciro / total) * 100 : 0,
      color: CHANNEL_COLORS[i] ?? "#8b949e",
    };
  });
}

// ---------------------------------------------------------------------------
// 12 aylık kanal (müşteri grubu) kırılımı — stacked bar chart için
// ---------------------------------------------------------------------------

/**
 * Son 12 ay × top kanallar matrisi. Top 5 kanal listelenir; kalan tüm
 * gruplar "Diğer" altında toplanır (long-tail'in chart legend'ı şişirmesin).
 *
 * Hesap kaynağı:
 *   - Tablo: TBLMSDFATURA × TBLMUSTERI × TBLMUSTERIGRUP
 *   - Pencere: son 12 ay (DATEADD(month,-12, GETDATE()))
 *   - Baz: SUM(DBLNETTUTAR), BYTTUR=0 AND BYTDURUM=0, m.BYTDURUM=0
 *   - Kanal: ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)),''),'(Grupsuz)')
 */
async function fetchChannelMonthly(unit: ValueUnit, distClause: string): Promise<KomutaChannelMonthlyRow[]> {
  const rowExpr = unit === "9le"
    ? "d9.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)"
    : "f.DBLNETTUTAR";
  const joins = unit9leJoins(unit, { detayAlias: "d9", faturaAlias: "f" });
  const sql = `
    WITH base AS (
      SELECT
        DATEPART(year,  f.TRHISLEMTARIHI) AS yil,
        DATEPART(month, f.TRHISLEMTARIHI) AS ay,
        ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Grupsuz)') AS kanal,
        ${rowExpr} AS tutar
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      LEFT JOIN dbo.TBLMUSTERIGRUP g ON g.TXTKOD = m.TXTGRUPKOD
      ${joins}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND m.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(month, -12, ${sqlNow()})
        ${distClause}
    ),
    top_kanal AS (
      SELECT TOP 5 kanal, SUM(tutar) AS toplam
      FROM base
      GROUP BY kanal
      ORDER BY toplam DESC
    )
    SELECT
      b.yil,
      b.ay,
      CASE WHEN tk.kanal IS NOT NULL THEN b.kanal ELSE 'Diğer' END AS kanal,
      SUM(b.tutar) AS ciro
    FROM base b
    LEFT JOIN top_kanal tk ON tk.kanal = b.kanal
    GROUP BY b.yil, b.ay,
             CASE WHEN tk.kanal IS NOT NULL THEN b.kanal ELSE 'Diğer' END
    ORDER BY b.yil, b.ay
  `;
  const out = await runReadOnly(sql, { limit: 200, timeoutMs: 30_000 });
  const monthsTR = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  return out.rows.map((r) => {
    const yil = Number(r.yil);
    const ay = Number(r.ay);
    return {
      yyyymm: `${yil}-${String(ay).padStart(2, "0")}`,
      ay: monthsTR[ay - 1] ?? "?",
      kanal: String(r.kanal ?? "(Grupsuz)"),
      ciro: Number(r.ciro ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------
// 12 aylık Pernod Müşteri Tipi (kanal) kırılımı — Univera ek-saha tabanlı.
// ---------------------------------------------------------------------------
//
// Pernod'un gerçek kanal segmentasyonu TBLMUSTERIGRUP'tan değil,
// TBLEKSAHATANIMLAMA "Müşteri Tipi" (LNGTAKIPKOD=8) ek sahasından geliyor.
// Her müşterinin TBLMUSTERIEKSAHA satırı saha kodu '8' altında nümerik
// seçenek kodu (1..9) tutar; TBLEKSAHASECENEK aynı LNGTAKIPKOD ile lookup
// edilince "Perakende / On Trade / Otel / Tali Bayi / OPA..." adına çevrilir.
//
// SQL kaynağı:
//   TBLMSDFATURA × TBLMUSTERI × TBLMUSTERIEKSAHA(LNGEKSAHAKODU=8) × TBLEKSAHASECENEK(LNGTAKIPKOD=8, LNGKOD=value)
//
// Pencere: son 12 ay. Müşterinin Müşteri Tipi sahası boşsa "(Tanımsız)"
// fallback kategorisine düşer.
async function fetchChannelByCustomerType(unit: ValueUnit, distClause: string): Promise<KomutaChannelMonthlyRow[]> {
  const rowExpr = unit === "9le"
    ? "d9.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)"
    : "f.DBLNETTUTAR";
  const joins = unit9leJoins(unit, { detayAlias: "d9", faturaAlias: "f" });
  const sql = `
    WITH lookup AS (
      SELECT CAST(LNGKOD AS NVARCHAR(20)) AS kod, TXTACIKLAMA AS adi
      FROM dbo.TBLEKSAHASECENEK
      WHERE LNGTAKIPKOD = 8
    ),
    base AS (
      SELECT
        DATEPART(year,  f.TRHISLEMTARIHI) AS yil,
        DATEPART(month, f.TRHISLEMTARIHI) AS ay,
        ISNULL(NULLIF(LTRIM(RTRIM(l.adi)), ''), '(Tanımsız)') AS kanal,
        ${rowExpr} AS tutar
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      LEFT JOIN dbo.TBLMUSTERIEKSAHA me
        ON me.LNGMUSTERIREF = m.LNGKOD AND me.LNGEKSAHAKODU = 8
      LEFT JOIN lookup l ON l.kod = LTRIM(RTRIM(me.TXTEKSAHAACIKLAMA))
      ${joins}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND m.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(month, -12, ${sqlNow()})
        ${distClause}
    ),
    top_kanal AS (
      SELECT TOP 7 kanal, SUM(tutar) AS toplam
      FROM base
      GROUP BY kanal
      ORDER BY toplam DESC
    )
    SELECT
      b.yil,
      b.ay,
      CASE WHEN tk.kanal IS NOT NULL THEN b.kanal ELSE 'Diğer' END AS kanal,
      SUM(b.tutar) AS ciro
    FROM base b
    LEFT JOIN top_kanal tk ON tk.kanal = b.kanal
    GROUP BY b.yil, b.ay,
             CASE WHEN tk.kanal IS NOT NULL THEN b.kanal ELSE 'Diğer' END
    ORDER BY b.yil, b.ay
  `;
  const out = await runReadOnly(sql, { limit: 250, timeoutMs: 45_000 });
  const monthsTR = [
    "Oca", "Şub", "Mar", "Nis", "May", "Haz",
    "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
  ];
  return out.rows.map((r) => {
    const yil = Number(r.yil);
    const ay = Number(r.ay);
    return {
      yyyymm: `${yil}-${String(ay).padStart(2, "0")}`,
      ay: monthsTR[ay - 1] ?? "?",
      kanal: String(r.kanal ?? "(Tanımsız)"),
      ciro: Number(r.ciro ?? 0),
    };
  });
}

// ---------------------------------------------------------------------------
// 12 aylık trend
// ---------------------------------------------------------------------------

async function fetchMonthlyTrend(unit: ValueUnit, distClause: string): Promise<KomutaMonthlyBar[]> {
  const valueExpr = unitValueExpr(unit, {
    faturaTL: "f.DBLNETTUTAR",
    miktarAlias: "d9.DBLMIKTAR",
    eksahaAlias: "ue.TXTEKSAHAACIKLAMA",
    urunAlias: "u",
  });
  const joins = unit9leJoins(unit, { detayAlias: "d9", faturaAlias: "f" });
  // Son 24 ay: 12 ay current + 12 ay önceki (geçen yıl hizalı kıyas için)
  const sql = `
    SELECT
      DATEPART(year, f.TRHISLEMTARIHI)  AS yil,
      DATEPART(month, f.TRHISLEMTARIHI) AS ay,
      ISNULL(${valueExpr}, 0)           AS ciro
    FROM dbo.TBLMSDFATURA f
    ${joins}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(month, -24, ${sqlNow()})
      ${distClause}
    GROUP BY DATEPART(year, f.TRHISLEMTARIHI), DATEPART(month, f.TRHISLEMTARIHI)
    ORDER BY yil, ay
  `;
  const out = await runReadOnly(sql, { limit: 30, timeoutMs: 30_000 });
  const monthsTR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const today = currentDate();

  // yyyymm -> ciro map (tüm 24 ay)
  const byKey = new Map<string, number>();
  for (const r of out.rows) {
    const yil = Number(r.yil);
    const ay = Number(r.ay);
    const key = `${yil}-${String(ay).padStart(2, "0")}`;
    byKey.set(key, Number(r.ciro ?? 0));
  }

  // Son 12 ay listesi (bugünden 12 ay önceye)
  const result: KomutaMonthlyBar[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const yil = d.getFullYear();
    const ay = d.getMonth() + 1;
    const key = `${yil}-${String(ay).padStart(2, "0")}`;
    const prevKey = `${yil - 1}-${String(ay).padStart(2, "0")}`;
    result.push({
      yyyymm: key,
      ay: monthsTR[ay - 1] ?? "",
      ciro: byKey.get(key) ?? 0,
      ciroPrev: byKey.has(prevKey) ? (byKey.get(prevKey) ?? 0) : null,
      // Yaklaşık Ramazan ayı tespiti
      isRamazan:
        (yil === 2026 && ay === 3) ||
        (yil === 2025 && ay === 3) ||
        (yil === 2024 && (ay === 3 || ay === 4)),
      isCurrent: yil === today.getFullYear() && ay === today.getMonth() + 1,
      isSummer: ay >= 6 && ay <= 9, // Haziran–Eylül turistik sezon
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Yaklaşan takvim olayı (calendar.json'dan)
// ---------------------------------------------------------------------------

async function fetchUpcomingEvent(): Promise<KomutaUpcomingEvent | null> {
  // Calendar import in this module would create a cycle; just read JSON.
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(__dirname, "../../..");
  const today = currentDate();
  const calFile = path.join(repoRoot, "data/calendar", `tr-${today.getFullYear()}.json`);
  let cal: { events: Array<{ date: string; name: string; kind: string }> };
  try {
    const raw = await fs.readFile(calFile, "utf-8");
    cal = JSON.parse(raw);
  } catch {
    return null;
  }

  const todayStr = today.toISOString().slice(0, 10);
  const horizonMs = 30 * 86_400_000;
  const horizon = new Date(today.getTime() + horizonMs).toISOString().slice(0, 10);

  // Önümüzdeki 30 günde bayram/milli/okul; maaş günleri filtrelenir
  const upcoming = cal.events
    .filter((e) => e.date >= todayStr && e.date <= horizon)
    .filter((e) => e.kind === "dini" || e.kind === "milli" || e.kind === "okul")
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  if (!upcoming) return null;
  const daysAhead = Math.ceil(
    (new Date(upcoming.date).getTime() - today.getTime()) / 86_400_000,
  );
  return {
    name: upcoming.name,
    date: upcoming.date,
    daysAhead,
    kind: upcoming.kind,
  };
}

// ---------------------------------------------------------------------------
// Dönem bazında fatura/detay oranları — DBLNETFIYAT*DBLMIKTAR (detay) ve
// f.DBLNETTUTAR (fatura) farklı tabanda olduğu için, ürün grubu kırılımındaki
// TL değerlerini fatura tabanına çevirmek için scale factor lazım.
// Her dönem için ayrı scale çünkü ürün mix'i ve KDV/ÖTV payı dönemler arasında
// değişebilir.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 9LE / TL ortak SQL fragment helper'ları
// ---------------------------------------------------------------------------
//
// Tüm Komuta fetcher'ları unit'e göre TL ciro veya 9LE hacim hesaplar.
// SUM ifadesi ve gerektiğinde detay JOIN'leri inject edilir.
//
// 9LE formülü: SUM(detay.DBLMIKTAR × 9-litre-çarpanı)
//   Çarpan: TBLURUNEKSAHA saha 26 ("9 LT Değer") değeri varsa onu kullan,
//   yoksa fallback DBLLITRE / 9. Bu Pernod'un resmi formülü.
//
// TL formülü: SUM(fatura.DBLNETTUTAR) (fatura toplam) veya SUM(detay.DBLNETFIYAT)
//   (detay-bazlı). Hangi alias kullanıldığını fetcher belirtir.

/** 9LE çarpan ifadesi — detay (`bd` veya `dd` veya `d`) + ürün (`u`) +
 *  ek saha (`ue`) alias'ları halihazırda JOIN'lenmiş olmalı. */
function unitValueExpr(unit: ValueUnit, opts: {
  /** Fatura toplam alias'ı (örn. `f.DBLNETTUTAR`) — TL modunda kullanılır. */
  faturaTL?: string;
  /** Detay-bazlı TL ifadesi (örn. `dd.DBLNETFIYAT`) — TL modunda alternatif. */
  detayTL?: string;
  /** Detay miktar alias'ı (örn. `dd.DBLMIKTAR`) — 9LE için zorunlu. */
  miktarAlias: string;
  /** Ek saha alias'ı (örn. `ue.TXTEKSAHAACIKLAMA`). 9LE için zorunlu. */
  eksahaAlias: string;
  /** TBLURUN alias'ı (DBLLITRE fallback için). */
  urunAlias: string;
}): string {
  if (unit === "9le") {
    return `SUM(${opts.miktarAlias} * COALESCE(TRY_CONVERT(decimal(18,8), ${opts.eksahaAlias}), ISNULL(${opts.urunAlias}.DBLLITRE, 0) / 9.0))`;
  }
  // TL — fatura tabanı tercih edilir; verilmemişse detay TL alternatifi
  if (opts.faturaTL) return `SUM(${opts.faturaTL})`;
  if (opts.detayTL) return `SUM(${opts.detayTL})`;
  return "0";
}

/** 9LE hesabı için detay+ürün+eksaha JOIN'lerinin SQL fragment'ı.
 *  Sadece unit=9le iken döner; TL modunda boş string. */
function unit9leJoins(unit: ValueUnit, opts: {
  detayAlias: string;
  faturaAlias: string;
}): string {
  if (unit !== "9le") return "";
  const d = opts.detayAlias;
  const f = opts.faturaAlias;
  return `
    INNER JOIN dbo.TBLMSDBELGEDETAY ${d}
      ON ${d}.LNGYIL = ${f}.LNGYIL
     AND ${d}.LNGFATURAKOD = ${f}.LNGBELGEKOD
     AND ${d}.LNGDISTKOD = ${f}.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = ${d}.LNGURUNKOD
    LEFT JOIN dbo.TBLURUNEKSAHA ue
      ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26
  `;
}

type PeriodScales = {
  buAy: number;
  gecenAy: number;
  ucAyOnce: number;
  gecenYil: number;
  ikiYilOnce: number;
};

async function fetchPeriodScales(distClause: string): Promise<PeriodScales> {
  const sql = `
    WITH fatura_per_period AS (
      SELECT
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()}) THEN f.DBLNETTUTAR ELSE 0 END) AS bu_fat,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -60, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -30, ${sqlNow()}) THEN f.DBLNETTUTAR ELSE 0 END) AS gecen_ay_fat,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -120, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -90, ${sqlNow()}) THEN f.DBLNETTUTAR ELSE 0 END) AS uc_ay_fat,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()}) THEN f.DBLNETTUTAR ELSE 0 END) AS gecen_yil_fat,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -760, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -730, ${sqlNow()}) THEN f.DBLNETTUTAR ELSE 0 END) AS iki_yil_fat
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -800, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
    ),
    detay_per_period AS (
      SELECT
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()}) THEN d.DBLNETFIYAT ELSE 0 END) AS bu_det,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -60, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -30, ${sqlNow()}) THEN d.DBLNETFIYAT ELSE 0 END) AS gecen_ay_det,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -120, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -90, ${sqlNow()}) THEN d.DBLNETFIYAT ELSE 0 END) AS uc_ay_det,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()}) THEN d.DBLNETFIYAT ELSE 0 END) AS gecen_yil_det,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -760, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -730, ${sqlNow()}) THEN d.DBLNETFIYAT ELSE 0 END) AS iki_yil_det
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -800, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
    )
    SELECT
      fpp.bu_fat, dpp.bu_det,
      fpp.gecen_ay_fat, dpp.gecen_ay_det,
      fpp.uc_ay_fat, dpp.uc_ay_det,
      fpp.gecen_yil_fat, dpp.gecen_yil_det,
      fpp.iki_yil_fat, dpp.iki_yil_det
    FROM fatura_per_period fpp, detay_per_period dpp
  `;
  const out = await runReadOnly(sql, { limit: 1, timeoutMs: 90_000 });
  const r = (out.rows[0] ?? {}) as Record<string, unknown>;
  const ratio = (fatura: unknown, detay: unknown): number => {
    const f = Number(fatura ?? 0);
    const d = Number(detay ?? 0);
    return d > 0 ? f / d : 1;
  };
  return {
    buAy: ratio(r.bu_fat, r.bu_det),
    gecenAy: ratio(r.gecen_ay_fat, r.gecen_ay_det),
    ucAyOnce: ratio(r.uc_ay_fat, r.uc_ay_det),
    gecenYil: ratio(r.gecen_yil_fat, r.gecen_yil_det),
    ikiYilOnce: ratio(r.iki_yil_fat, r.iki_yil_det),
  };
}

// ---------------------------------------------------------------------------
// Marka × Dönem Matrisi (top 8 ürün grubu × 5 dönem)
// ---------------------------------------------------------------------------

async function fetchMatrix(scales: PeriodScales, unit: ValueUnit, distClause: string): Promise<KomutaMatrixRow[]> {
  // Detay-bazlı per-row value — TL ise DBLNETFIYAT, 9LE ise DBLMIKTAR × çarpan.
  const rowExpr = unit === "9le"
    ? "d.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)"
    : "d.DBLNETFIYAT";
  const eksahaJoin = unit === "9le"
    ? "LEFT JOIN dbo.TBLURUNEKSAHA ue ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26"
    : "";
  // Top 8 grup'u bul + her biri için 5 dönem ciro
  const sql = `
    WITH gruplar AS (
      SELECT TOP 8
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        SUM(${rowExpr}) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
      ${eksahaJoin}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
        ${distClause}
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    ),
    raw AS (
      SELECT
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        f.TRHISLEMTARIHI            AS tarih,
        ${rowExpr} AS satir
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
      ${eksahaJoin}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -800, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
        ${distClause}
    )
    SELECT
      gr.grup,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -30, ${sqlNow()})  THEN raw.satir ELSE 0 END) AS bu_ay,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -60, ${sqlNow()})  AND raw.tarih < DATEADD(day, -30, ${sqlNow()}) THEN raw.satir ELSE 0 END) AS gecen_ay,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -120, ${sqlNow()}) AND raw.tarih < DATEADD(day, -90, ${sqlNow()}) THEN raw.satir ELSE 0 END) AS uc_ay_once,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -395, ${sqlNow()}) AND raw.tarih < DATEADD(day, -365, ${sqlNow()}) THEN raw.satir ELSE 0 END) AS gecen_yil,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -760, ${sqlNow()}) AND raw.tarih < DATEADD(day, -730, ${sqlNow()}) THEN raw.satir ELSE 0 END) AS iki_yil_once
    FROM gruplar gr
    LEFT JOIN raw ON raw.grup = gr.grup
    GROUP BY gr.grup, gr.ciro
    ORDER BY gr.ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 10, timeoutMs: 90_000 });
  const tierMaster = await loadTierMaster();
  // PeriodScales sadece TL modunda anlamlı (detay DBLNETFIYAT → fatura
  // DBLNETTUTAR oranı). 9LE modunda her iki taraf zaten 9LE — scale=1.
  const scale = unit === "tl" ? scales : {
    buAy: 1, gecenAy: 1, ucAyOnce: 1, gecenYil: 1, ikiYilOnce: 1,
  };
  return out.rows.map((r) => {
    const grup = String(r.grup ?? "");
    const bu = Number(r.bu_ay ?? 0) * scale.buAy;
    const gecenAy = Number(r.gecen_ay ?? 0) * scale.gecenAy;
    const ucAyOnce = Number(r.uc_ay_once ?? 0) * scale.ucAyOnce;
    const gecenYil = Number(r.gecen_yil ?? 0) * scale.gecenYil;
    const ikiYilOnce = Number(r.iki_yil_once ?? 0) * scale.ikiYilOnce;
    const yoyPct = gecenYil > 0 ? ((bu - gecenYil) / gecenYil) * 100 : null;
    let trend: KomutaMatrixRow["trend"] = "flat";
    if (yoyPct != null) {
      if (yoyPct >= 30) trend = "rocket";
      else if (yoyPct >= 5) trend = "up";
      else if (yoyPct <= -5) trend = "down";
    }
    return {
      grup,
      tier: classifyTier(grup, tierMaster),
      buAy: bu,
      gecenAy,
      ucAyOnce,
      gecenYil,
      ikiYilOnce,
      yoyPct,
      trend,
    };
  });
}

// ---------------------------------------------------------------------------
// Bölge × Grup Heatmap (top 8 bölge × top 6 grup)
// ---------------------------------------------------------------------------

function heatmapBucket(yoyPct: number | null): KomutaHeatmapCell["bucket"] {
  if (yoyPct == null) return "flat";
  if (yoyPct >= 25) return "fire";
  if (yoyPct >= 10) return "hot";
  if (yoyPct >= 3) return "warm";
  if (yoyPct >= -3) return "flat";
  if (yoyPct >= -15) return "cool";
  return "cold";
}

async function fetchHeatmap(unit: ValueUnit, distClause: string): Promise<KomutaHeatmapRow[]> {
  // Top bölgeler ve top gruplar tespit edilir, sonra pivot.
  // dist_grup CTE: distribütör → coğrafi bölge eşlemesi. Kaynak tenant'a göre
  // TERS: Pernod TBLDISTGRUP(TXTGRUP)=bölge, Wietnauer TBLDISTEKGRUP(TXTEKGRUP)=bölge.
  const tenant = getTenantConfig();
  const distRegionTable = tenant.distRegionTable ?? "TBLDISTGRUP";
  const distRegionColumn = tenant.distRegionColumn ?? "TXTGRUP";
  // 9LE modunda her aggregation TBLURUNEKSAHA (saha 26) çarpanına ihtiyaç duyar.
  const valExpr = unit === "9le"
    ? "SUM(dd.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0))"
    : "SUM(dd.DBLNETFIYAT)";
  // top_bolge: TL modunda TBLURUN gerekmez; 9LE modunda gerekir
  const topBolgeUrunJoin = unit === "9le"
    ? `INNER JOIN dbo.TBLURUN u ON u.LNGKOD = dd.LNGURUNKOD
       LEFT JOIN dbo.TBLURUNEKSAHA ue ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26`
    : "";
  // top_grup ve subquery'ler zaten TBLURUN join'liyor; sadece TBLURUNEKSAHA ekle
  const eksahaJoin = unit === "9le"
    ? "LEFT JOIN dbo.TBLURUNEKSAHA ue ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26"
    : "";
  const sql = `
    WITH dist_grup AS (
      SELECT d.LNGKOD AS distKod, dg.TXTKOD AS bolgeKod, dg.TXTAD AS bolge
      FROM dbo.TBLDIST d
      INNER JOIN dbo.${distRegionTable} dg ON dg.TXTKOD = d.${distRegionColumn}
      WHERE d.BYTDURUM = 0
    ),
    top_bolge AS (
      SELECT TOP 8
        dg.bolge,
        dg.bolgeKod,
        COUNT(DISTINCT dg.distKod)        AS distSayisi,
        ${valExpr} AS ciro
      FROM dist_grup dg
      INNER JOIN dbo.TBLMSDFATURA f ON f.LNGDISTKOD = dg.distKod
      INNER JOIN dbo.TBLMSDBELGEDETAY dd
        ON dd.LNGYIL = f.LNGYIL
       AND dd.LNGFATURAKOD = f.LNGBELGEKOD
       AND dd.LNGDISTKOD = f.LNGDISTKOD
      ${topBolgeUrunJoin}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
      GROUP BY dg.bolge, dg.bolgeKod
      ORDER BY ciro DESC
    ),
    top_grup AS (
      SELECT TOP 6
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        ${valExpr} AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY dd
        ON dd.LNGYIL = f.LNGYIL
       AND dd.LNGFATURAKOD = f.LNGBELGEKOD
       AND dd.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = dd.LNGURUNKOD
      ${eksahaJoin}
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
        ${distClause}
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    ),
    -- VYK-02: iki correlated subquery (her biri TBLMSDFATURA+3 JOIN tekrar
    -- tarayan) yerine, dist_grup x FATURA x URUN tek kez taranip hem
    -- son 30 gun hem gecen yil ayni 30 gun pencerelerini CASE-WHEN ile
    -- ayni GROUP BY da toplar. top_bolge/top_grup ile INNER filtresi
    -- zaten 8x6=48 hucreye daraltir (Top-N secimi SQL de kalir).
    agg AS (
      SELECT
        dg2.bolgeKod,
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
                  AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
                 THEN ${unit === "9le" ? "dd.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)" : "dd.DBLNETFIYAT"}
                 ELSE 0 END) AS son,
        SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                  AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
                 THEN ${unit === "9le" ? "dd.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)" : "dd.DBLNETFIYAT"}
                 ELSE 0 END) AS onceki
      FROM dist_grup dg2
      INNER JOIN dbo.TBLMSDFATURA f ON f.LNGDISTKOD = dg2.distKod
      INNER JOIN dbo.TBLMSDBELGEDETAY dd
        ON dd.LNGYIL = f.LNGYIL AND dd.LNGFATURAKOD = f.LNGBELGEKOD AND dd.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = dd.LNGURUNKOD
      ${eksahaJoin}
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND (
          (f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})  AND f.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()}))
          OR
          (f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()}) AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()}))
        )
        AND dg2.bolgeKod IN (SELECT bolgeKod FROM top_bolge)
        AND COALESCE(g.TXTAD, u.TXTAD) IN (SELECT grup FROM top_grup)
        ${distClause}
      GROUP BY dg2.bolgeKod, COALESCE(g.TXTAD, u.TXTAD)
    )
    SELECT
      tb.bolge,
      tb.distSayisi,
      tg.grup,
      ISNULL(a.son, 0) AS son,
      ISNULL(a.onceki, 0) AS onceki
    FROM top_bolge tb
    CROSS JOIN top_grup tg
    LEFT JOIN agg a ON a.bolgeKod = tb.bolgeKod AND a.grup = tg.grup
    ORDER BY tb.ciro DESC, tg.ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 100, timeoutMs: 120_000 });

  // Pivot by bolge
  const byBolge: Map<string, KomutaHeatmapRow> = new Map();
  for (const r of out.rows) {
    const bolge = String(r.bolge ?? "");
    const grup = String(r.grup ?? "");
    const son = Number(r.son ?? 0);
    const onceki = Number(r.onceki ?? 0);
    const yoy = onceki > 0 ? ((son - onceki) / onceki) * 100 : null;
    if (!byBolge.has(bolge)) {
      byBolge.set(bolge, {
        bolge,
        distSayisi: Number(r.distSayisi ?? 0),
        cells: [],
        rowAvgPct: null,
      });
    }
    byBolge.get(bolge)!.cells.push({
      bolge,
      grup,
      yoyPct: yoy,
      bucket: heatmapBucket(yoy),
    });
  }
  for (const row of byBolge.values()) {
    const valid = row.cells.filter((c) => c.yoyPct != null);
    row.rowAvgPct =
      valid.length > 0
        ? valid.reduce((a, c) => a + (c.yoyPct ?? 0), 0) / valid.length
        : null;
  }
  return [...byBolge.values()];
}

// ---------------------------------------------------------------------------
// Top Satış Temsilcileri (Bölge Müdürü yerine)
// ---------------------------------------------------------------------------

async function fetchTopReps(unit: ValueUnit, distClause: string): Promise<KomutaRep[]> {
  // 9LE modunda fatura toplamını detay × ek saha 26 ile değiştir.
  const valueExpr = unit === "9le"
    ? "ISNULL(SUM(d9.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)), 0)"
    : "ISNULL(SUM(f.DBLNETTUTAR), 0)";
  const joins9le = unit === "9le"
    ? `
    INNER JOIN dbo.TBLMSDBELGEDETAY d9
      ON d9.LNGYIL = f.LNGYIL AND d9.LNGFATURAKOD = f.LNGBELGEKOD AND d9.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d9.LNGURUNKOD
    LEFT JOIN dbo.TBLURUNEKSAHA ue ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26`
    : "";
  // 9LE'de detay JOIN fatura'yı satır sayısı kadar çoğaltır; COUNT(*) yanlış
  // verir, fatura için composite PK üzerinden DISTINCT lazım.
  // CONCAT kullanıyoruz çünkü aritmetik (LNGYIL * 1e8) INT'i aşar
  // (2026 * 1e8 = 2.026e11 > INT max 2.147e9) → "Arithmetic overflow" hatası
  // → SQL fail, fetcher boş array döner → UI "verisi yok" gösterir.
  const faturaCount = unit === "9le"
    ? "COUNT(DISTINCT CONCAT(f.LNGYIL, '-', f.LNGBELGEKOD, '-', f.LNGDISTKOD))"
    : "COUNT(*)";
  const sql = `
    SELECT TOP 8
      st.TXTSTAD AS ad,
      d.TXTAD    AS distributor,
      ${valueExpr} AS ciro,
      ${faturaCount} AS fatura
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLSATISTEMSILCISI st ON st.LNGSTKOD = f.LNGSTKOD
    LEFT JOIN dbo.TBLDIST d ON d.LNGKOD = st.LNGDISTKOD
    ${joins9le}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      AND st.TXTSTAD IS NOT NULL
      ${distClause}
    GROUP BY st.TXTSTAD, d.TXTAD
    ORDER BY ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 10, timeoutMs: 30_000 });
  return out.rows.map((r, i) => ({
    rank: i + 1,
    ad: String(r.ad ?? ""),
    distributor: (r.distributor as string) ?? null,
    ciro: Number(r.ciro ?? 0),
    faturaSayisi: Number(r.fatura ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Top Distribütörler — son 30g, net ciro sırası
// ---------------------------------------------------------------------------

async function fetchTopDists(unit: ValueUnit, distClause: string): Promise<KomutaTopDist[]> {
  // 9LE modunda fatura toplamını detay × ek saha 26 ile değiştir.
  const valueExpr = unit === "9le"
    ? "ISNULL(SUM(d9.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)), 0)"
    : "ISNULL(SUM(f.DBLNETTUTAR), 0)";
  const joins9le = unit === "9le"
    ? `
    INNER JOIN dbo.TBLMSDBELGEDETAY d9
      ON d9.LNGYIL = f.LNGYIL AND d9.LNGFATURAKOD = f.LNGBELGEKOD AND d9.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d9.LNGURUNKOD
    LEFT JOIN dbo.TBLURUNEKSAHA ue ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26`
    : "";
  // 9LE'de detay JOIN fatura'yı çoğaltır; composite PK üzerinden DISTINCT.
  // CONCAT (INT aritmetik overflow'undan kaçınmak için — bkz fetchTopReps).
  const faturaCount = unit === "9le"
    ? "COUNT(DISTINCT CONCAT(f.LNGYIL, '-', f.LNGBELGEKOD, '-', f.LNGDISTKOD))"
    : "COUNT(*)";
  const sql = `
    SELECT TOP 8
      d.TXTAD AS ad,
      d.TXTGRUP AS bolge,
      ${valueExpr} AS ciro,
      ${faturaCount} AS fatura
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    ${joins9le}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND d.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      ${distClause}
    GROUP BY d.TXTAD, d.TXTGRUP
    ORDER BY ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 10, timeoutMs: 30_000 });
  return out.rows.map((r, i) => ({
    rank: i + 1,
    ad: String(r.ad ?? ""),
    bolge: (r.bolge as string) ?? null,
    ciro: Number(r.ciro ?? 0),
    faturaSayisi: Number(r.fatura ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Marka Portföyü · 2 Yıllık Yörünge
// ---------------------------------------------------------------------------

async function fetchPortfolio(scales: PeriodScales, unit: ValueUnit, distClause: string): Promise<KomutaPortfolioRow[]> {
  // 9LE: detay miktar × ek saha 26 çarpanı; TL: detay net fiyat.
  // top10 + raw CTE'leri için ortak satır ifadesi.
  const satirExpr = unit === "9le"
    ? "d.DBLMIKTAR * COALESCE(TRY_CONVERT(decimal(18,8), ue.TXTEKSAHAACIKLAMA), ISNULL(u.DBLLITRE, 0) / 9.0)"
    : "d.DBLNETFIYAT";
  const top10Sum = unit === "9le"
    ? `SUM(${satirExpr})`
    : "SUM(d.DBLNETFIYAT)";
  const eksahaJoin = unit === "9le"
    ? "LEFT JOIN dbo.TBLURUNEKSAHA ue ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26"
    : "";
  const sql = `
    WITH top10 AS (
      SELECT TOP 10
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        ${top10Sum} AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      ${eksahaJoin}
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
        ${distClause}
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    ),
    raw AS (
      SELECT
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        f.TRHISLEMTARIHI            AS tarih,
        ${satirExpr} AS satir
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      ${eksahaJoin}
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -800, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
        ${distClause}
    )
    SELECT
      t.grup,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -30, ${sqlNow()})   THEN raw.satir ELSE 0 END) AS bu,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -395, ${sqlNow()})  AND raw.tarih < DATEADD(day, -365, ${sqlNow()}) THEN raw.satir ELSE 0 END) AS one_y,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -760, ${sqlNow()})  AND raw.tarih < DATEADD(day, -730, ${sqlNow()}) THEN raw.satir ELSE 0 END) AS two_y
    FROM top10 t
    LEFT JOIN raw ON raw.grup = t.grup
    GROUP BY t.grup, t.ciro
    ORDER BY t.ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 15, timeoutMs: 90_000 });
  const tierMaster = await loadTierMaster();
  // 9LE modunda PeriodScales (fatura/detay normalize katsayısı) anlamsız —
  // çünkü 9LE her zaman detaydan hesaplanır, fatura↔detay normalize gerekmez.
  const scale = unit === "tl" ? scales : {
    buAy: 1, gecenAy: 1, ucAyOnce: 1, gecenYil: 1, ikiYilOnce: 1,
  };
  return out.rows.map((r) => {
    const grup = String(r.grup ?? "");
    // Her dönem değerini fatura tabanına çevir (sadece TL).
    const bu = Number(r.bu ?? 0) * scale.buAy;
    const oneY = Number(r.one_y ?? 0) * scale.gecenYil;
    const twoY = Number(r.two_y ?? 0) * scale.ikiYilOnce;
    return {
      grup,
      tier: classifyTier(grup, tierMaster),
      bu,
      oneYearAgo: oneY,
      twoYearsAgo: twoY,
      yoyPct: oneY > 0 ? ((bu - oneY) / oneY) * 100 : null,
      twoYrPct: twoY > 0 ? ((bu - twoY) / twoY) * 100 : null,
    };
  });
}

// ---------------------------------------------------------------------------
// AI Insight Bar — Gemini ile 3-paragraf brief
// ---------------------------------------------------------------------------

async function fetchBrief(snap: Omit<KomutaSnapshot, "brief">): Promise<string> {
  const ciroKpi = snap.kpis.find((k) => k.id === "ciro");
  const hacimKpi = snap.kpis.find((k) => k.id === "hacim");
  const topReps = snap.reps
    .slice(0, 3)
    .map((r) => `${r.ad} (${formatCompact(r.ciro)} ₺)`)
    .join(", ");
  const topGroups = snap.matrix
    .slice(0, 3)
    .map((m) => `${m.grup} (${formatCompact(m.buAy)} ₺${m.yoyPct != null ? `, %${m.yoyPct.toFixed(0)} YoY` : ""})`)
    .join(", ");
  const dropGroups = snap.matrix.filter((m) => (m.yoyPct ?? 0) < -5);
  const sortedRegions = snap.regions
    .filter((c) => c.deltaPct != null)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0));
  const topRegion = sortedRegions[0];
  const bottomRegion = sortedRegions[sortedRegions.length - 1];

  const system = [
    "Sen Univera distribütör operasyonu için CEO/Satış Direktörü sabah brifi yazan bir analistsin.",
    "3 paragraf yaz, her biri 1-2 cümle. Sırayla:",
    "1. paragraf — POZİTİF strateji: en güçlü ürün grubu/temsilci, somut sayılarla.",
    "2. paragraf — POZİTİF nüans: ikinci sırada bir gözlem (toparlanma, momentum, ikincil iyi haber).",
    "3. paragraf — ANOMALİ/AKSİYON: en kötü performans veya risk, somut adıyla.",
    "",
    "İYİ-İYİ-KÖTÜ sırası önemli (psikolojik kabul).",
    "Türkçe yaz, somut ad+sayı, jargon yok, içi boş ifade yok.",
    "Her paragrafı <strong>kalın bir başlık:</strong> ile başlat.",
  ].join("\n");

  const userPrompt = [
    `Bugün: ${currentDate().toLocaleDateString("tr-TR")}.`,
    `Toplam ciro: ${ciroKpi ? formatCompact(ciroKpi.value) + " ₺" : "?"} (YoY ${ciroKpi?.delta != null ? `%${ciroKpi.delta.toFixed(1)}` : "?"}).`,
    `Birim hacim: ${hacimKpi ? hacimKpi.value.toLocaleString("tr-TR") : "?"} adet.`,
    `Top 3 ürün grubu: ${topGroups}.`,
    `Top 3 temsilci: ${topReps}.`,
    `En çok büyüyen bölge: ${topRegion ? `${topRegion.bolge} (%${topRegion.deltaPct?.toFixed(1)})` : "veri yok"}.`,
    `En çok küçülen bölge: ${bottomRegion ? `${bottomRegion.bolge} (%${bottomRegion.deltaPct?.toFixed(1)})` : "veri yok"}.`,
    dropGroups.length > 0
      ? `Düşen gruplar: ${dropGroups.map((d) => `${d.grup} (%${d.yoyPct?.toFixed(0)})`).join(", ")}.`
      : "Önemli düşen grup yok.",
    snap.upcomingEvent
      ? `Yaklaşan takvim: ${snap.upcomingEvent.daysAhead} gün sonra ${snap.upcomingEvent.name}.`
      : "",
    "",
    "Brief:",
  ].join("\n");

  try {
    const text = await generate(system, userPrompt, {
      temperature: 0.4,
      maxOutputTokens: 800,
    });
    return text.trim();
  } catch (err) {
    console.error("[komuta brief] generate failed:", err);
    return "";
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Detects a fundamentally-empty snapshot — most/all SQL fetchers failed.
 * Used to skip caching so the next load triggers a fresh attempt instead
 * of serving stale emptiness.
 */
function isEmptySnapshot(s: KomutaSnapshot): boolean {
  return (
    s.kpis.length === 0 &&
    s.regions.length === 0 &&
    s.matrix.length === 0 &&
    s.reps.length === 0 &&
    s.portfolio.length === 0
  );
}

/** Snapshot data dolu ama AI brief üretilemedi — cache'ten brief'i
 *  invalidate etmek için ayrı kontrol. Veri tamken brief tekrar denenmeli. */
function isMissingBrief(s: KomutaSnapshot): boolean {
  return (
    !isEmptySnapshot(s) &&
    (typeof s.brief !== "string" || s.brief.trim().length < 50)
  );
}

/**
 * Geçmiş değerleri (gecenAy, ucAyOnce, gecenYil, ikiYilOnce, ciroPrev,
 * portfolio.oneYearAgo, portfolio.twoYearsAgo, monthlyTrend) TÜFE multiplier
 * ile bugünün parasına çevirir + YoY/2yr%'leri buna göre yeniden hesaplar.
 *
 * Nominal değerlerden inflation-adjusted (Reel TL) snapshot üretir.
 */
async function applyReelTL(
  snap: KomutaSnapshot,
  inflation: InflationData,
): Promise<KomutaSnapshot> {
  const now = currentYyyymm();
  const mGecenAy = getMultiplier(yyyymmDaysAgo(45), now, inflation);
  const m3AyOnce = getMultiplier(yyyymmDaysAgo(105), now, inflation);
  const mGecenYil = getMultiplier(yyyymmYearsAgo(1), now, inflation);
  const m2YilOnce = getMultiplier(yyyymmYearsAgo(2), now, inflation);

  return {
    ...snap,
    reelTL: true,
    regions: snap.regions.map((r) => {
      const ciroPrevReel = r.ciroPrev * mGecenYil;
      return {
        ...r,
        ciroPrev: ciroPrevReel,
        deltaPct: ciroPrevReel > 0 ? ((r.ciro - ciroPrevReel) / ciroPrevReel) * 100 : null,
      };
    }),
    monthlyTrend: snap.monthlyTrend.map((m) => {
      const mult = getMultiplier(m.yyyymm, now, inflation);
      // ciroPrev: 12 ay önceki aynı ay — kendi multiplier'ı
      let ciroPrevReel: number | null = null;
      if (m.ciroPrev != null) {
        const [y, mo] = m.yyyymm.split("-");
        const prevKey = `${Number(y) - 1}-${mo}`;
        const multPrev = getMultiplier(prevKey, now, inflation);
        ciroPrevReel = m.ciroPrev * multPrev;
      }
      return { ...m, ciro: m.ciro * mult, ciroPrev: ciroPrevReel };
    }),
    channelMonthly: snap.channelMonthly.map((row) => ({
      ...row,
      ciro: row.ciro * getMultiplier(row.yyyymm, now, inflation),
    })),
    channelByType: snap.channelByType.map((row) => ({
      ...row,
      ciro: row.ciro * getMultiplier(row.yyyymm, now, inflation),
    })),
    matrix: snap.matrix.map((row) => {
      const buAy = row.buAy;
      const gecenYil = row.gecenYil * mGecenYil;
      const yoyPct = gecenYil > 0 ? ((buAy - gecenYil) / gecenYil) * 100 : null;
      let trend: KomutaMatrixRow["trend"] = "flat";
      if (yoyPct != null) {
        if (yoyPct >= 30) trend = "rocket";
        else if (yoyPct >= 5) trend = "up";
        else if (yoyPct <= -5) trend = "down";
      }
      return {
        ...row,
        gecenAy: row.gecenAy * mGecenAy,
        ucAyOnce: row.ucAyOnce * m3AyOnce,
        gecenYil,
        ikiYilOnce: row.ikiYilOnce * m2YilOnce,
        yoyPct,
        trend,
      };
    }),
    heatmap: snap.heatmap.map((row) => {
      const cells = row.cells.map((cell) => {
        // Heatmap cell yoyPct'i nominal hesaplanmıştı; YoY oranı kendisi reel olmalı.
        // Çünkü cell yoyPct'i (son - onceki) / onceki ham hesabı; reel'de onceki inflate edilir.
        if (cell.yoyPct == null) return cell;
        // YoY = (son - onceki) / onceki
        // Nominal: y = (s - p) / p → s/p - 1
        // Reel: y' = (s - p*m) / (p*m) = s/(p*m) - 1
        // Reel y' = (1 + y) / m - 1
        const nominalRatio = 1 + cell.yoyPct / 100;
        const reelYoy = (nominalRatio / mGecenYil - 1) * 100;
        return {
          ...cell,
          yoyPct: reelYoy,
          bucket: heatmapBucket(reelYoy),
        };
      });
      const valid = cells.filter((c) => c.yoyPct != null);
      const rowAvg =
        valid.length > 0
          ? valid.reduce((a, c) => a + (c.yoyPct ?? 0), 0) / valid.length
          : null;
      return { ...row, cells, rowAvgPct: rowAvg };
    }),
    portfolio: snap.portfolio.map((p) => {
      const oneYearReel = p.oneYearAgo * mGecenYil;
      const twoYearReel = p.twoYearsAgo * m2YilOnce;
      return {
        ...p,
        oneYearAgo: oneYearReel,
        twoYearsAgo: twoYearReel,
        yoyPct: oneYearReel > 0 ? ((p.bu - oneYearReel) / oneYearReel) * 100 : null,
        twoYrPct: twoYearReel > 0 ? ((p.bu - twoYearReel) / twoYearReel) * 100 : null,
      };
    }),
  };
}

/**
 * ÖTV-net transformasyonu — tüm ciro değerlerinden vergi düşülür.
 * Her ürün grubu için tax.ts'teki master üzerinden oran çıkarılır,
 * (1 - rate) ile çarpılır. KPI'larda ve özet metriklerde matrix top
 * gruplarından türetilen ağırlıklı ortalama oran kullanılır.
 *
 * YoY ratios değişmez (vergi geçmişe de uygulandığı için orantısal eşit).
 */
function applyOtvNet(snap: KomutaSnapshot, data: OtvData): KomutaSnapshot {
  // Ağırlıklı ortalama oran — KPI ciro, regions, monthlyTrend, reps, channels
  // için kullanılacak (KPI breakdown'ları matrix'in dışına çıkıyor).
  const totalBu = snap.matrix.reduce((a, r) => a + r.buAy, 0);
  const avgRate =
    totalBu > 0
      ? snap.matrix.reduce((acc, r) => acc + r.buAy * getOtvRate(r.grup, r.tier, data), 0) /
        totalBu
      : data.fallback;
  const avgInv = 1 - avgRate;

  return {
    ...snap,
    otvNet: true,
    otvAvgRate: avgRate,
    kpis: snap.kpis.map((k) => {
      // Sadece ciro ve sepet vergi etkilenir. Hacim (adet), top marka payı
      // (oran), aktif SN (sayı) değişmez.
      if (k.id === "ciro" || k.id === "sepet") {
        return { ...k, value: k.value * avgInv };
      }
      return k;
    }),
    regions: snap.regions.map((r) => ({
      ...r,
      ciro: r.ciro * avgInv,
      ciroPrev: r.ciroPrev * avgInv,
      // deltaPct unchanged — same factor applied to both ciro and ciroPrev
    })),
    monthlyTrend: snap.monthlyTrend.map((m) => ({
      ...m,
      ciro: m.ciro * avgInv,
      ciroPrev: m.ciroPrev != null ? m.ciroPrev * avgInv : null,
    })),
    channels: snap.channels.map((c) => ({ ...c, ciro: c.ciro * avgInv })),
    channelMonthly: snap.channelMonthly.map((row) => ({
      ...row,
      ciro: row.ciro * avgInv,
    })),
    channelByType: snap.channelByType.map((row) => ({
      ...row,
      ciro: row.ciro * avgInv,
    })),
    reps: snap.reps.map((r) => ({ ...r, ciro: r.ciro * avgInv })),
    topDists: snap.topDists.map((d) => ({ ...d, ciro: d.ciro * avgInv })),
    matrix: snap.matrix.map((row) => {
      const rate = getOtvRate(row.grup, row.tier, data);
      const inv = 1 - rate;
      return {
        ...row,
        buAy: row.buAy * inv,
        gecenAy: row.gecenAy * inv,
        ucAyOnce: row.ucAyOnce * inv,
        gecenYil: row.gecenYil * inv,
        ikiYilOnce: row.ikiYilOnce * inv,
        // yoyPct, trend unchanged (ratio constant)
      };
    }),
    portfolio: snap.portfolio.map((p) => {
      const rate = getOtvRate(p.grup, p.tier, data);
      const inv = 1 - rate;
      return {
        ...p,
        bu: p.bu * inv,
        oneYearAgo: p.oneYearAgo * inv,
        twoYearsAgo: p.twoYearsAgo * inv,
        // yoyPct, twoYrPct unchanged
      };
    }),
    // heatmap: cells YoY ratios unchanged
  };
}

/**
 * VYK-01 (cache-key scope fragmentation) DEĞERLENDİRMESİ — bu snapshot JS-
 * filtreye ÇEVRİLMEDİ, scope'lu (`distClause` enjekte edilmiş) kalıyor:
 *
 *   - `fetchHeatmap` bölge×grup hücrelerini (VYK-02 sonrası) TEK GROUP BY
 *     (`agg` CTE, CASE-WHEN dönem-flag) ile hesaplıyor; `TOP 8 bölge`/`TOP 6
 *     grup` SQL'de seçiliyor. dist_id eklemek bu Top-N seçimini kaldırmayı
 *     gerektirir — JS-filtreye çevirmek mevcut per-dist sorgudan DAHA AĞIR
 *     tek bir sorgu üretir (satır-seviyesine indirmek veri hacmini patlatır).
 *   - `fetchMatrix` 800 günlük pencerede satır-seviyesi tarama yapıyor
 *     (`raw` CTE) + `TOP 8` grup seçimi; aynı risk.
 *   - `fetchPeriodScales`/`fetchRegions`/`fetchChannelMonthly`/
 *     `fetchChannelByCustomerType` 12-24 aylık pencerelerde çalışıyor;
 *     dist×ay×kanal×tier kombinasyonu kontrolsüz büyüyebilir.
 *   - Ayrıca `fetchBrief` (Gemini AI çağrısı) snapshot'a bağlı — cache
 *     semantiğini değiştirmek AI brief üretim maliyetini de etkiler.
 *
 * Karar: full-dataset satır sayısı makul değil (stok'un ~6000'i ile
 * karşılaştırılamaz büyüklükte olurdu) → dokunulmadı.
 *
 * NOT: nightRefresh (apps/api/src/server.ts) yalnızca `allowedDistKods: null`
 * (merkez) scope'unu ısıtıyor — 30 dist kullanıcısının kendi scope'lu cache
 * anahtarı (`v7-...-d<n>`) hâlâ soğuk-cache MSSQL yüküne maruz kalıyor.
 * server.ts'e bu görevde dokunma yetkim yok; **nightRefresh her dist için de
 * (veya en azından en aktif dist'ler için) `getKomutaSnapshot({ allowedDistKods: [distId] })`
 * çağıracak şekilde genişletilmeli** — bu ayrı bir görev/PR gerektirir.
 */
export async function getKomutaSnapshot(
  options: {
    forceRefresh?: boolean;
    reelTL?: boolean;
    otvNet?: boolean;
    unit?: ValueUnit;
    /** Dist kullanıcının izinli distribütör kodları; null/undefined → merkez
     *  (filtre yok). Sunucu-otoriter — server.ts JWT scope'undan geçirir. */
    allowedDistKods?: number[] | null;
    /** Tek bir dist'e drill-down (merkez) ya da dist kullanıcının tek izinli
     *  dist'i (server.ts `scopeSingleDistId` ile hesaplar). */
    distId?: number | null;
  } = {},
): Promise<KomutaSnapshot> {
  const unit: ValueUnit = options.unit === "9le" ? "9le" : "tl";

  // Scope hesabı — wietnauer-satis.ts ile aynı desen: distId varsa tek dist,
  // yoksa allowedDistKods (dist scope) ya da null (merkez, filtresiz).
  const effectiveDistKods =
    options.distId != null ? [options.distId] : (options.allowedDistKods ?? null);
  const scope: TenantScope =
    effectiveDistKods == null
      ? { type: "merkez", distKods: null }
      : { type: "dist", distKods: effectiveDistKods };
  const distClause = distFilterClause(scope, "f.LNGDISTKOD");
  const scopeKey =
    effectiveDistKods == null
      ? "all"
      : "d" + [...effectiveDistKods].sort((a, b) => a - b).join("_");

  // CACHE_VERSION — snapshot shape veya temel SQL değiştiğinde bump et
  // ki eski entry'ler otomatik invalidate olsun (TTL yok, manuel refresh
  // tek geri kalan yol oluyor). v2: fetchRegions TBLDISTGRUP driver'a geçti
  // ("Doğu Anadolu kayboldu" fix'i), 8 bölge garanti. v7: dist-bazlı veri
  // izolasyonu — tüm fatura sorgularına distClause enjekte edildi.
  const CACHE_VERSION = "v7";
  const cacheKey = [
    CACHE_VERSION,
    options.reelTL ? "reel" : "nominal",
    options.otvNet ? "otv" : "gross",
    unit,
    scopeKey,
  ].join("-");
  const cached = await withCache<KomutaSnapshot>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      // Önce her dönem için fatura/detay scale factor'ları çek — Matrix ve
      // Portfolio bunlarla detay-tabanı TL'leri fatura-tabanına çevirir.
      const scales = await fetchPeriodScales(distClause).catch((e) => {
        console.error("[komuta scales]", e);
        return { buAy: 1, gecenAy: 1, ucAyOnce: 1, gecenYil: 1, ikiYilOnce: 1 };
      });

      // Tüm sorgular paraleldir; iletim süresi max(her bir sorgu) olur.
      const [
        kpis,
        regions,
        channels,
        channelMonthly,
        channelByType,
        monthlyTrend,
        upcomingEvent,
        matrix,
        heatmap,
        reps,
        topDists,
        portfolio,
      ] = await Promise.all([
        fetchKpis(unit, distClause).catch((e) => {
          console.error("[komuta kpis]", e);
          return [] as KomutaKpiCard[];
        }),
        fetchRegions(unit, distClause).catch((e) => {
          console.error("[komuta regions]", e);
          return [] as KomutaRegionRow[];
        }),
        fetchChannels(unit, distClause).catch((e) => {
          console.error("[komuta channels]", e);
          return [] as KomutaChannelSlice[];
        }),
        fetchChannelMonthly(unit, distClause).catch((e) => {
          console.error("[komuta channelMonthly]", e);
          return [] as KomutaChannelMonthlyRow[];
        }),
        fetchChannelByCustomerType(unit, distClause).catch((e) => {
          console.error("[komuta channelByType]", e);
          return [] as KomutaChannelMonthlyRow[];
        }),
        fetchMonthlyTrend(unit, distClause).catch((e) => {
          console.error("[komuta trend]", e);
          return [] as KomutaMonthlyBar[];
        }),
        fetchUpcomingEvent().catch(() => null),
        fetchMatrix(scales, unit, distClause).catch((e) => {
          console.error("[komuta matrix]", e);
          return [] as KomutaMatrixRow[];
        }),
        fetchHeatmap(unit, distClause).catch((e) => {
          console.error("[komuta heatmap]", e);
          return [] as KomutaHeatmapRow[];
        }),
        fetchTopReps(unit, distClause).catch((e) => {
          console.error("[komuta reps]", e);
          return [] as KomutaRep[];
        }),
        fetchTopDists(unit, distClause).catch((e) => {
          console.error("[komuta topDists]", e);
          return [] as KomutaTopDist[];
        }),
        fetchPortfolio(scales, unit, distClause).catch((e) => {
          console.error("[komuta portfolio]", e);
          return [] as KomutaPortfolioRow[];
        }),
      ]);

      const partial: Omit<KomutaSnapshot, "brief"> = {
        generatedAt: new Date().toISOString(),
        reelTL: false,
        otvNet: false,
        otvAvgRate: null,
        demoDate: demoDate(),
        unit,
        kpis,
        regions,
        channels,
        channelMonthly,
        channelByType,
        monthlyTrend,
        upcomingEvent,
        matrix,
        heatmap,
        reps,
        topDists,
        portfolio,
      };
      const brief = await fetchBrief(partial);
      let snap: KomutaSnapshot = { ...partial, brief };
      // Reel TL → ÖTV-net sırası: önce TÜFE arındır, sonra vergi düş.
      // İkisi de multiplicative olduğu için ters sıra da matematik olarak
      // aynı sonucu verir; ama sıralama log/banner için tutarlı.
      if (options.reelTL) {
        const inflation = await loadInflation();
        snap = await applyReelTL(snap, inflation);
      }
      if (options.otvNet) {
        const otv = await loadOtv();
        snap = applyOtvNet(snap, otv);
      }
      return snap;
    },
    { forceRefresh: options.forceRefresh },
  );
  // Eğer cache'ten dönen snapshot temel olarak boşsa (tüm SQL'ler initial
  // attempt'te başarısız olmuş ve yanlışlıkla cache'lenmiş), bir kez daha
  // dene — bu sefer bypass ile.
  if (isEmptySnapshot(cached.value) && !options.forceRefresh) {
    console.warn("[komuta] cached snapshot is empty, retrying with refresh");
    return getKomutaSnapshot({
      forceRefresh: true,
      reelTL: options.reelTL,
      otvNet: options.otvNet,
      unit: options.unit,
      allowedDistKods: options.allowedDistKods,
      distId: options.distId,
    });
  }
  // Veri var ama Gemini brief üretilememiş (network/key/timeout) → retry et.
  // Bu sayede AI yorumu sürekli "boş" cache'lenip kalmaz, bir sonraki istekte
  // tekrar denenir. forceRefresh false ise yine de bir kez dene.
  if (isMissingBrief(cached.value) && !options.forceRefresh) {
    console.warn(
      "[komuta] cached snapshot has empty/short brief, retrying with refresh",
    );
    return getKomutaSnapshot({
      forceRefresh: true,
      reelTL: options.reelTL,
      otvNet: options.otvNet,
      unit: options.unit,
      allowedDistKods: options.allowedDistKods,
      distId: options.distId,
    });
  }
  return cached.value;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "Mr";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toString();
}
