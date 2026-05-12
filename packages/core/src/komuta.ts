import { withCache } from "./cache.js";
import { runReadOnly } from "./db.js";
import { generate } from "./gemini.js";

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

export type KomutaKpiCard = {
  id: string;
  label: string;
  value: number;
  format: "currency" | "count" | "percent" | "compact";
  unit?: string;
  delta?: number;
  deltaSub?: string;
};

export type KomutaCityRow = {
  sehir: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
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
  isRamazan: boolean;
  isCurrent: boolean;
};

export type KomutaMatrixRow = {
  grup: string;
  buAy: number;
  gecenAy: number;
  ucAyOnce: number;
  gecenYil: number;
  ikiYilOnce: number;
  yoyPct: number | null;
  trend: "rocket" | "up" | "flat" | "down";
};

export type KomutaHeatmapCell = {
  sehir: string;
  grup: string;
  yoyPct: number | null;
  bucket: "fire" | "hot" | "warm" | "flat" | "cool" | "cold";
};

export type KomutaHeatmapRow = {
  sehir: string;
  noktaSayisi: number;
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

export type KomutaPortfolioRow = {
  grup: string;
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

export type KomutaSnapshot = {
  generatedAt: string;
  kpis: KomutaKpiCard[];
  cities: KomutaCityRow[];
  channels: KomutaChannelSlice[];
  monthlyTrend: KomutaMonthlyBar[];
  upcomingEvent: KomutaUpcomingEvent | null;
  matrix: KomutaMatrixRow[];
  heatmap: KomutaHeatmapRow[];
  reps: KomutaRep[];
  portfolio: KomutaPortfolioRow[];
  brief?: string;
};

// ---------------------------------------------------------------------------
// KPI Strip — 5 kart
// ---------------------------------------------------------------------------

async function fetchKpis(): Promise<KomutaKpiCard[]> {
  // Son 30 gün vs önceki 30 gün karşılaştırma için tek seferde 4 metriği döner.
  const sql = `
    WITH son AS (
      SELECT
        ISNULL(SUM(f.DBLNETTUTAR), 0)             AS ciro,
        COUNT(*)                                  AS fatura,
        COUNT(DISTINCT f.LNGMUSTERIKOD)           AS musteri
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
    ),
    onceki AS (
      SELECT
        ISNULL(SUM(f.DBLNETTUTAR), 0)             AS ciro,
        COUNT(DISTINCT f.LNGMUSTERIKOD)           AS musteri
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -60, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -30, GETDATE())
    ),
    miktar AS (
      SELECT ISNULL(SUM(d.DBLMIKTAR), 0) AS adet
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
    ),
    miktar_onceki AS (
      SELECT ISNULL(SUM(d.DBLMIKTAR), 0) AS adet
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -60, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -30, GETDATE())
    ),
    top_grup AS (
      SELECT TOP 1
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    )
    SELECT
      son.ciro       AS son_ciro,
      onceki.ciro    AS onceki_ciro,
      son.fatura     AS son_fatura,
      son.musteri    AS son_musteri,
      onceki.musteri AS onceki_musteri,
      miktar.adet    AS son_adet,
      miktar_onceki.adet AS onceki_adet,
      (SELECT TOP 1 grup FROM top_grup) AS top_grup_ad,
      (SELECT TOP 1 ciro FROM top_grup) AS top_grup_ciro
    FROM son, onceki, miktar, miktar_onceki
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
  const sepet = sonFatura > 0 ? sonCiro / sonFatura : 0;
  const topGrupPct = sonCiro > 0 ? (topGrupCiro / sonCiro) * 100 : 0;

  return [
    {
      id: "ciro",
      label: "Toplam Net Ciro · 30 gün",
      value: sonCiro,
      format: "compact",
      unit: "₺",
      delta: oncekiCiro > 0 ? ((sonCiro - oncekiCiro) / oncekiCiro) * 100 : null as never,
      deltaSub: oncekiCiro > 0
        ? `vs önceki 30g (${formatCompact(oncekiCiro)} ₺)`
        : "geçmiş veri yok",
    },
    {
      id: "hacim",
      label: "Birim Hacim · 30 gün",
      value: sonAdet,
      format: "count",
      unit: "adet",
      delta: oncekiAdet > 0 ? ((sonAdet - oncekiAdet) / oncekiAdet) * 100 : null as never,
      deltaSub: oncekiAdet > 0
        ? `vs önceki 30g (${oncekiAdet.toLocaleString("tr-TR")} adet)`
        : "geçmiş veri yok",
    },
    {
      id: "top_marka",
      label: "Top Marka Payı · 30 gün",
      value: topGrupPct,
      format: "percent",
      deltaSub: `${(r.top_grup_ad as string) ?? "—"} (${formatCompact(topGrupCiro)} ₺)`,
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
    {
      id: "sepet",
      label: "Ortalama Sepet · 30 gün",
      value: Math.round(sepet),
      format: "currency",
      unit: "₺",
      deltaSub: `${sonFatura.toLocaleString("tr-TR")} fatura üzerinden`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Şehir bazlı ciro + YoY (harita için)
// ---------------------------------------------------------------------------

async function fetchCities(): Promise<KomutaCityRow[]> {
  const sql = `
    WITH son AS (
      SELECT
        LTRIM(RTRIM(m.TXTSEHIR)) AS sehir,
        SUM(f.DBLNETTUTAR)       AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        AND m.TXTSEHIR IS NOT NULL AND LTRIM(RTRIM(m.TXTSEHIR)) <> ''
      GROUP BY LTRIM(RTRIM(m.TXTSEHIR))
    ),
    onceki AS (
      SELECT
        LTRIM(RTRIM(m.TXTSEHIR)) AS sehir,
        SUM(f.DBLNETTUTAR)       AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -395, GETDATE())
        AND f.TRHISLEMTARIHI <  DATEADD(day, -365, GETDATE())
        AND m.TXTSEHIR IS NOT NULL AND LTRIM(RTRIM(m.TXTSEHIR)) <> ''
      GROUP BY LTRIM(RTRIM(m.TXTSEHIR))
    )
    SELECT TOP 15
      s.sehir,
      ISNULL(s.ciro, 0)  AS ciro,
      ISNULL(o.ciro, 0)  AS ciroPrev
    FROM son s
    LEFT JOIN onceki o ON o.sehir = s.sehir
    ORDER BY s.ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 50, timeoutMs: 60_000 });
  return out.rows.map((r) => {
    const ciro = Number(r.ciro ?? 0);
    const ciroPrev = Number(r.ciroPrev ?? 0);
    const deltaPct = ciroPrev > 0 ? ((ciro - ciroPrev) / ciroPrev) * 100 : null;
    return {
      sehir: String(r.sehir ?? ""),
      ciro,
      ciroPrev,
      deltaPct,
    };
  });
}

// ---------------------------------------------------------------------------
// Distribütör kırılımı (kanal mix yerine)
// ---------------------------------------------------------------------------

const CHANNEL_COLORS = ["#d4a857", "#58a6ff", "#c084fc", "#3fb950", "#f0c674"];

async function fetchChannels(): Promise<KomutaChannelSlice[]> {
  const sql = `
    SELECT TOP 5
      d.TXTAD AS ad,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND d.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
    GROUP BY d.TXTAD
    ORDER BY ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 5, timeoutMs: 30_000 });
  const totSql = `
    SELECT ISNULL(SUM(f.DBLNETTUTAR), 0) AS tot
    FROM dbo.TBLMSDFATURA f
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
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
// 12 aylık trend
// ---------------------------------------------------------------------------

async function fetchMonthlyTrend(): Promise<KomutaMonthlyBar[]> {
  const sql = `
    SELECT
      DATEPART(year, f.TRHISLEMTARIHI)  AS yil,
      DATEPART(month, f.TRHISLEMTARIHI) AS ay,
      ISNULL(SUM(f.DBLNETTUTAR), 0)     AS ciro
    FROM dbo.TBLMSDFATURA f
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(month, -12, GETDATE())
    GROUP BY DATEPART(year, f.TRHISLEMTARIHI), DATEPART(month, f.TRHISLEMTARIHI)
    ORDER BY yil, ay
  `;
  const out = await runReadOnly(sql, { limit: 15, timeoutMs: 30_000 });
  const monthsTR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const today = new Date();
  return out.rows.map((r) => {
    const yil = Number(r.yil);
    const ay = Number(r.ay);
    return {
      yyyymm: `${yil}-${String(ay).padStart(2, "0")}`,
      ay: monthsTR[ay - 1] ?? "",
      ciro: Number(r.ciro ?? 0),
      // Yaklaşık Ramazan ayı tespiti: 2026'da Mart, 2025'te Mart, 2024'te Mart-Nisan
      isRamazan: (yil === 2026 && ay === 3) || (yil === 2025 && ay === 3) || (yil === 2024 && (ay === 3 || ay === 4)),
      isCurrent: yil === today.getFullYear() && ay === today.getMonth() + 1,
    };
  });
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
  const today = new Date();
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
// Marka × Dönem Matrisi (top 8 ürün grubu × 5 dönem)
// ---------------------------------------------------------------------------

async function fetchMatrix(): Promise<KomutaMatrixRow[]> {
  // Top 8 grup'u bul + her biri için 5 dönem ciro
  const sql = `
    WITH gruplar AS (
      SELECT TOP 8
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    ),
    raw AS (
      SELECT
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        f.TRHISLEMTARIHI            AS tarih,
        d.DBLNETFIYAT * d.DBLMIKTAR AS satir
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -800, GETDATE())
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
    )
    SELECT
      gr.grup,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -30, GETDATE())  THEN raw.satir ELSE 0 END) AS bu_ay,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -60, GETDATE())  AND raw.tarih < DATEADD(day, -30, GETDATE()) THEN raw.satir ELSE 0 END) AS gecen_ay,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -120, GETDATE()) AND raw.tarih < DATEADD(day, -90, GETDATE()) THEN raw.satir ELSE 0 END) AS uc_ay_once,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -395, GETDATE()) AND raw.tarih < DATEADD(day, -365, GETDATE()) THEN raw.satir ELSE 0 END) AS gecen_yil,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -760, GETDATE()) AND raw.tarih < DATEADD(day, -730, GETDATE()) THEN raw.satir ELSE 0 END) AS iki_yil_once
    FROM gruplar gr
    LEFT JOIN raw ON raw.grup = gr.grup
    GROUP BY gr.grup, gr.ciro
    ORDER BY gr.ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 10, timeoutMs: 90_000 });
  return out.rows.map((r) => {
    const bu = Number(r.bu_ay ?? 0);
    const gecenYil = Number(r.gecen_yil ?? 0);
    const yoyPct = gecenYil > 0 ? ((bu - gecenYil) / gecenYil) * 100 : null;
    let trend: KomutaMatrixRow["trend"] = "flat";
    if (yoyPct != null) {
      if (yoyPct >= 30) trend = "rocket";
      else if (yoyPct >= 5) trend = "up";
      else if (yoyPct <= -5) trend = "down";
    }
    return {
      grup: String(r.grup ?? ""),
      buAy: bu,
      gecenAy: Number(r.gecen_ay ?? 0),
      ucAyOnce: Number(r.uc_ay_once ?? 0),
      gecenYil,
      ikiYilOnce: Number(r.iki_yil_once ?? 0),
      yoyPct,
      trend,
    };
  });
}

// ---------------------------------------------------------------------------
// Şehir × Grup Heatmap (top 8 şehir × top 6 grup)
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

async function fetchHeatmap(): Promise<KomutaHeatmapRow[]> {
  // Top şehirler ve top gruplar tespit edilir, sonra pivot
  const sql = `
    WITH top_sehir AS (
      SELECT TOP 8
        LTRIM(RTRIM(m.TXTSEHIR)) AS sehir,
        COUNT(DISTINCT m.LNGKOD) AS noktaSayisi,
        SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        AND m.TXTSEHIR IS NOT NULL AND LTRIM(RTRIM(m.TXTSEHIR)) <> ''
      GROUP BY LTRIM(RTRIM(m.TXTSEHIR))
      ORDER BY ciro DESC
    ),
    top_grup AS (
      SELECT TOP 6
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    )
    SELECT
      ts.sehir,
      ts.noktaSayisi,
      tg.grup,
      ISNULL((
        SELECT SUM(d.DBLNETFIYAT * d.DBLMIKTAR)
        FROM dbo.TBLMSDFATURA f
        INNER JOIN dbo.TBLMSDBELGEDETAY d
          ON d.LNGYIL = f.LNGYIL AND d.LNGFATURAKOD = f.LNGBELGEKOD AND d.LNGDISTKOD = f.LNGDISTKOD
        INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
        INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
        LEFT JOIN dbo.TBLURUNGRUP g
          ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
        WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
          AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
          AND LTRIM(RTRIM(m.TXTSEHIR)) = ts.sehir
          AND COALESCE(g.TXTAD, u.TXTAD) = tg.grup
      ), 0) AS son,
      ISNULL((
        SELECT SUM(d.DBLNETFIYAT * d.DBLMIKTAR)
        FROM dbo.TBLMSDFATURA f
        INNER JOIN dbo.TBLMSDBELGEDETAY d
          ON d.LNGYIL = f.LNGYIL AND d.LNGFATURAKOD = f.LNGBELGEKOD AND d.LNGDISTKOD = f.LNGDISTKOD
        INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
        INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
        LEFT JOIN dbo.TBLURUNGRUP g
          ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
        WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
          AND f.TRHISLEMTARIHI >= DATEADD(day, -395, GETDATE())
          AND f.TRHISLEMTARIHI <  DATEADD(day, -365, GETDATE())
          AND LTRIM(RTRIM(m.TXTSEHIR)) = ts.sehir
          AND COALESCE(g.TXTAD, u.TXTAD) = tg.grup
      ), 0) AS onceki
    FROM top_sehir ts
    CROSS JOIN top_grup tg
    ORDER BY ts.ciro DESC, tg.ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 100, timeoutMs: 120_000 });

  // Pivot by sehir
  const bySehir: Map<string, KomutaHeatmapRow> = new Map();
  for (const r of out.rows) {
    const sehir = String(r.sehir ?? "");
    const grup = String(r.grup ?? "");
    const son = Number(r.son ?? 0);
    const onceki = Number(r.onceki ?? 0);
    const yoy = onceki > 0 ? ((son - onceki) / onceki) * 100 : null;
    if (!bySehir.has(sehir)) {
      bySehir.set(sehir, {
        sehir,
        noktaSayisi: Number(r.noktaSayisi ?? 0),
        cells: [],
        rowAvgPct: null,
      });
    }
    bySehir.get(sehir)!.cells.push({
      sehir,
      grup,
      yoyPct: yoy,
      bucket: heatmapBucket(yoy),
    });
  }
  // Row averages
  for (const row of bySehir.values()) {
    const valid = row.cells.filter((c) => c.yoyPct != null);
    row.rowAvgPct =
      valid.length > 0
        ? valid.reduce((a, c) => a + (c.yoyPct ?? 0), 0) / valid.length
        : null;
  }
  return [...bySehir.values()];
}

// ---------------------------------------------------------------------------
// Top Satış Temsilcileri (Bölge Müdürü yerine)
// ---------------------------------------------------------------------------

async function fetchTopReps(): Promise<KomutaRep[]> {
  const sql = `
    SELECT TOP 8
      st.TXTSTAD AS ad,
      d.TXTAD    AS distributor,
      ISNULL(SUM(f.DBLNETTUTAR), 0) AS ciro,
      COUNT(*)   AS fatura
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLSATISTEMSILCISI st ON st.LNGSTKOD = f.LNGSTKOD
    LEFT JOIN dbo.TBLDIST d ON d.LNGKOD = st.LNGDISTKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      AND st.TXTSTAD IS NOT NULL
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
// Marka Portföyü · 2 Yıllık Yörünge
// ---------------------------------------------------------------------------

async function fetchPortfolio(): Promise<KomutaPortfolioRow[]> {
  const sql = `
    WITH top10 AS (
      SELECT TOP 10
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        AND COALESCE(g.TXTAD, u.TXTAD) IS NOT NULL
      GROUP BY COALESCE(g.TXTAD, u.TXTAD)
      ORDER BY ciro DESC
    ),
    raw AS (
      SELECT
        COALESCE(g.TXTAD, u.TXTAD) AS grup,
        f.TRHISLEMTARIHI            AS tarih,
        d.DBLNETFIYAT * d.DBLMIKTAR AS satir
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -800, GETDATE())
    )
    SELECT
      t.grup,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -30, GETDATE())   THEN raw.satir ELSE 0 END) AS bu,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -395, GETDATE())  AND raw.tarih < DATEADD(day, -365, GETDATE()) THEN raw.satir ELSE 0 END) AS one_y,
      SUM(CASE WHEN raw.tarih >= DATEADD(day, -760, GETDATE())  AND raw.tarih < DATEADD(day, -730, GETDATE()) THEN raw.satir ELSE 0 END) AS two_y
    FROM top10 t
    LEFT JOIN raw ON raw.grup = t.grup
    GROUP BY t.grup, t.ciro
    ORDER BY t.ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 15, timeoutMs: 90_000 });
  return out.rows.map((r) => {
    const bu = Number(r.bu ?? 0);
    const oneY = Number(r.one_y ?? 0);
    const twoY = Number(r.two_y ?? 0);
    return {
      grup: String(r.grup ?? ""),
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
  const sortedCities = snap.cities
    .filter((c) => c.deltaPct != null)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0));
  const topCity = sortedCities[0];
  const bottomCity = sortedCities[sortedCities.length - 1];

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
    `Bugün: ${new Date().toLocaleDateString("tr-TR")}.`,
    `Toplam ciro: ${ciroKpi ? formatCompact(ciroKpi.value) + " ₺" : "?"} (YoY ${ciroKpi?.delta != null ? `%${ciroKpi.delta.toFixed(1)}` : "?"}).`,
    `Birim hacim: ${hacimKpi ? hacimKpi.value.toLocaleString("tr-TR") : "?"} adet.`,
    `Top 3 ürün grubu: ${topGroups}.`,
    `Top 3 temsilci: ${topReps}.`,
    `En çok büyüyen şehir: ${topCity ? `${topCity.sehir} (%${topCity.deltaPct?.toFixed(1)})` : "veri yok"}.`,
    `En çok küçülen şehir: ${bottomCity ? `${bottomCity.sehir} (%${bottomCity.deltaPct?.toFixed(1)})` : "veri yok"}.`,
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
    s.cities.length === 0 &&
    s.matrix.length === 0 &&
    s.reps.length === 0 &&
    s.portfolio.length === 0
  );
}

export async function getKomutaSnapshot(
  options: { forceRefresh?: boolean } = {},
): Promise<KomutaSnapshot> {
  const cached = await withCache<KomutaSnapshot>(
    CACHE_DOMAIN,
    "default",
    async () => {
      // Tüm sorgular paraleldir; iletim süresi max(her bir sorgu) olur.
      const [kpis, cities, channels, monthlyTrend, upcomingEvent, matrix, heatmap, reps, portfolio] =
        await Promise.all([
          fetchKpis().catch((e) => {
            console.error("[komuta kpis]", e);
            return [] as KomutaKpiCard[];
          }),
          fetchCities().catch((e) => {
            console.error("[komuta cities]", e);
            return [] as KomutaCityRow[];
          }),
          fetchChannels().catch((e) => {
            console.error("[komuta channels]", e);
            return [] as KomutaChannelSlice[];
          }),
          fetchMonthlyTrend().catch((e) => {
            console.error("[komuta trend]", e);
            return [] as KomutaMonthlyBar[];
          }),
          fetchUpcomingEvent().catch(() => null),
          fetchMatrix().catch((e) => {
            console.error("[komuta matrix]", e);
            return [] as KomutaMatrixRow[];
          }),
          fetchHeatmap().catch((e) => {
            console.error("[komuta heatmap]", e);
            return [] as KomutaHeatmapRow[];
          }),
          fetchTopReps().catch((e) => {
            console.error("[komuta reps]", e);
            return [] as KomutaRep[];
          }),
          fetchPortfolio().catch((e) => {
            console.error("[komuta portfolio]", e);
            return [] as KomutaPortfolioRow[];
          }),
        ]);

      const partial: Omit<KomutaSnapshot, "brief"> = {
        generatedAt: new Date().toISOString(),
        kpis,
        cities,
        channels,
        monthlyTrend,
        upcomingEvent,
        matrix,
        heatmap,
        reps,
        portfolio,
      };
      const brief = await fetchBrief(partial);
      return { ...partial, brief };
    },
    { forceRefresh: options.forceRefresh },
  );
  // Eğer cache'ten dönen snapshot temel olarak boşsa (tüm SQL'ler initial
  // attempt'te başarısız olmuş ve yanlışlıkla cache'lenmiş), bir kez daha
  // dene — bu sefer bypass ile.
  if (isEmptySnapshot(cached.value) && !options.forceRefresh) {
    console.warn("[komuta] cached snapshot is empty, retrying with refresh");
    return getKomutaSnapshot({ forceRefresh: true });
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
