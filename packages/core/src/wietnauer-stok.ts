/**
 * Wietnauer Dashboard #8 — Stok Tükenme & Miktar Bazlı Devir.
 *
 * Wietnauer canlı DB'sinde doğrudan depo stok snapshot tabloları boş olduğu
 * için stok bakiyesi, aktif fatura ve onaylı depo hareket detaylarındaki
 * `LNGSTOKTIP` işaretiyle türetilir. Satış hızı ise son 90 gün fatura satış
 * miktarıdır.
 */
import { withCache } from "./cache.js";
import { runReadOnly } from "./db.js";
import { currentDate, demoDate, sqlNow } from "./now.js";
import { getTenantConfig } from "./tenant/index.js";

const CACHE_DOMAIN = "wietnauer-stok";
const CACHE_VERSION = "v5";
const WINDOW_DAYS = 90;
const DEMAND_WINDOW_DAYS = 180;
const DEFAULT_LEAD_TIME_DAYS = 14;
const SERVICE_LEVEL_Z = 1.65;
/** Net stok / toplam hareket oranı bu eşiğin altındaysa "düşük güven". */
const LOW_CONFIDENCE_RATIO = 0.02;
const TREND_FACTOR_MIN = 0.5;
const TREND_FACTOR_MAX = 2;

export type StockRiskTier = "critical" | "risk" | "watch" | "healthy" | "unknown";

export type DemandPattern = "smooth" | "intermittent" | "erratic" | "lumpy" | "unknown";

export type StockConfidence = "high" | "medium" | "low";

export type LeadTimeSource = "dist-table" | "default";

export type StockDataQuality =
  | "ok"
  | "no-demand"
  | "no-stock-signal"
  | "negative-stock"
  | "turnover-unreliable";

export type WietnauerStockSkuRow = {
  /** TBLURUN.LNGKOD */
  skuId: number;
  skuCode: string;
  skuName: string;
  brand: string | null;
  category: string | null;
  /** TBLDIST.LNGKOD — hangi distribütörün stok/satış bakiyesi. */
  distId: number;
  distName: string;
  /** TBLDISTEKGRUP.TXTAD — 5 bölge (MARMARA/EGE/ANADOLU/AKDENİZ/GÜNEYDOĞU). */
  region: string | null;
  onHandQty: number;
  soldQty90d: number;
  avgDailyQty: number;
  soldQty180d: number;
  demandDays180: number;
  avgDemandInterval: number | null;
  demandCv2: number | null;
  demandPattern: DemandPattern;
  crostonDailyQty: number;
  trendFactor: number;
  seasonalityFactor: number;
  seasonalityReason: string | null;
  forecastDailyQty: number;
  daysLeft: number | null;
  estimatedStockoutDate: string | null;
  turnover90d: number | null;
  stockStartQty: number;
  stockEndQty: number;
  avgStockQty: number;
  openOrderQty: number;
  inventoryPositionQty: number;
  projectedDaysLeft: number | null;
  projectedStockoutDate: string | null;
  lastInboundDate: string | null;
  lastInboundDays: number | null;
  leadTimeDays: number;
  leadTimeSource: LeadTimeSource;
  safetyStockQty: number;
  reorderPointQty: number;
  reorderGapQty: number;
  stockConfidence: StockConfidence;
  stockConfidenceScore: number;
  /**
   * Net stok / toplam hareket hacmi oranı (%). Düşük değer = "büyük akışların
   * küçük farkı" → tek eksik hareket işareti çevirebilir → kırılgan sinyal.
   */
  netSignalPct: number | null;
  /**
   * Düşük güven bayrağı: net stok toplam hareketin < %2'si iken true.
   * Bu durumda daysLeft/riskTier ölçüm gürültüsü olabilir; UI "düşük güven"
   * rozeti gösterir.
   */
  lowConfidence: boolean;
  riskTier: StockRiskTier;
  dataQuality: StockDataQuality;
};

/**
 * Dist dropdown'u için özet satır. Filter uygulanmasa da her seferinde tam
 * liste döner ki UI dropdown'u tutarlı görünsün.
 */
export type WietnauerStockDistributorSummary = {
  distId: number;
  distName: string;
  region: string | null;
  skuCount: number;
  criticalCount: number;
  riskCount: number;
  watchCount: number;
  healthyCount: number;
  unknownCount: number;
  totalOnHandQty: number;
  totalSoldQty90d: number;
};

export type WietnauerStockBrandSummary = {
  brand: string;
  skuCount: number;
  criticalCount: number;
  riskCount: number;
  watchCount: number;
  healthyCount: number;
  unknownCount: number;
  totalOnHandQty: number;
  totalSoldQty90d: number;
  avgDaysLeft: number | null;
};

export type WietnauerStockSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  windowDays: typeof WINDOW_DAYS;
  /**
   * Aktif dist filtresi. `null` → tüm distribütörler (portföy görünümü).
   * Verilirse `items`/`critical`/`totals`/`brandSummary` bu dist bağlamına göre
   * filtrelenmiş halde döner.
   */
  distFilter: {
    distId: number;
    distName: string;
    region: string | null;
  } | null;
  /** Dropdown için — her zaman tam liste, filter uygulansa da uygulanmasa da. */
  distributors: WietnauerStockDistributorSummary[];
  totals: {
    activeSkuCount: number;
    soldSkuCount90d: number;
    positiveStockSkuCount: number;
    criticalSkuCount: number;
    riskSkuCount: number;
    watchSkuCount: number;
    healthySkuCount: number;
    unknownSkuCount: number;
    negativeStockSkuCount: number;
    noDemandSkuCount: number;
    turnoverComputableSkuCount: number;
    lowConfidenceSkuCount: number;
    lowConfidenceRatePct: number;
    incomingOrderSkuCount: number;
    totalIncomingQty: number;
    leadTimeConfiguredSkuCount: number;
  };
  /** İlk bakış listesi: en önce bitecek SKU'lar. */
  critical: WietnauerStockSkuRow[];
  /** Risk sıralı SKU listesi; UI için 200 satırla sınırlandırılır. */
  items: WietnauerStockSkuRow[];
  brandSummary: WietnauerStockBrandSummary[];
  quality: {
    stockSignalSkuCount: number;
    zeroStockSkuCount: number;
    negativeStockSkuCount: number;
    turnoverUnreliableSkuCount: number;
    incomingOrderSkuCount: number;
    leadTimeConfiguredSkuCount: number;
    snapshotTablesEmpty: boolean;
  };
};

type RawStockRow = Record<string, unknown>;

function getBrandAndCategoryMeta() {
  const tenant = getTenantConfig();
  const brandTable = tenant.brandTable;
  const brandJoinCol = tenant.brandJoinColumn;
  if (!["TBLURUNEKGRUP", "TBLURUNGRUP"].includes(brandTable))
    throw new Error(`Geçersiz brandTable: ${brandTable}`);
  if (!["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"].includes(brandJoinCol))
    throw new Error(`Geçersiz brandJoinColumn: ${brandJoinCol}`);

  const categoryTable = brandTable === "TBLURUNGRUP" ? "TBLURUNEKGRUP" : "TBLURUNGRUP";
  const categoryJoinCol =
    brandJoinCol === "TXTURUNGRUPKOD" ? "TXTURUNEKGRUPKOD" : "TXTURUNGRUPKOD";
  return { brandTable, brandJoinCol, categoryTable, categoryJoinCol };
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dateOnly(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIsoDate: string | null, toDate: Date): number | null {
  if (!fromIsoDate) return null;
  const from = new Date(`${fromIsoDate}T12:00:00`);
  if (Number.isNaN(from.getTime())) return null;
  return Math.max(0, Math.floor((toDate.getTime() - from.getTime()) / 86_400_000));
}

function riskTierFor(daysLeft: number | null, forecastDailyQty: number, onHandQty: number): StockRiskTier {
  if (forecastDailyQty <= 0 || onHandQty <= 0 || daysLeft == null) return "unknown";
  if (daysLeft <= 7) return "critical";
  if (daysLeft <= 14) return "risk";
  if (daysLeft <= 30) return "watch";
  return "healthy";
}

function dataQualityFor(
  onHandQty: number,
  avgDailyQty: number,
  stockSignalQty: number,
  turnover90d: number | null,
): StockDataQuality {
  if (onHandQty < 0) return "negative-stock";
  if (stockSignalQty === 0) return "no-stock-signal";
  if (avgDailyQty <= 0) return "no-demand";
  if (turnover90d == null) return "turnover-unreliable";
  return "ok";
}

function demandPatternFor(adi: number | null, cv2: number | null): DemandPattern {
  if (adi == null || cv2 == null) return "unknown";
  if (adi < 1.32 && cv2 < 0.49) return "smooth";
  if (adi >= 1.32 && cv2 < 0.49) return "intermittent";
  if (adi < 1.32 && cv2 >= 0.49) return "erratic";
  return "lumpy";
}

function estimateStockoutDate(daysLeft: number | null): string | null {
  if (daysLeft == null || !Number.isFinite(daysLeft) || daysLeft < 0) return null;
  const d = currentDate();
  d.setDate(d.getDate() + Math.ceil(daysLeft));
  return d.toISOString().slice(0, 10);
}

function overlapsWindow(baseDate: Date, startIso: string, endIso: string, horizonDays: number): boolean {
  const horizonEnd = new Date(baseDate);
  horizonEnd.setDate(horizonEnd.getDate() + horizonDays);
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T23:59:59`);
  return start <= horizonEnd && end >= baseDate;
}

function isSummerCoastRegion(region: string | null): boolean {
  const normalized = (region ?? "").toLocaleUpperCase("tr");
  return normalized.includes("EGE") || normalized.includes("AKDEN");
}

function seasonalityFor(region: string | null): { factor: number; reason: string | null } {
  const now = currentDate();
  const month = now.getMonth() + 1;
  const ramadanWindows = [
    { start: "2025-03-01", end: "2025-03-29" },
    { start: "2026-02-18", end: "2026-03-19" },
    { start: "2027-02-07", end: "2027-03-08" },
  ];

  if (ramadanWindows.some((w) => overlapsWindow(now, w.start, w.end, 30))) {
    return { factor: 0.55, reason: "Ramazan" };
  }
  if (month === 12 || overlapsWindow(now, `${now.getFullYear()}-12-15`, `${now.getFullYear() + 1}-01-05`, 30)) {
    return { factor: 1.5, reason: "Aralık / yılbaşı" };
  }
  if (month >= 6 && month <= 9 && isSummerCoastRegion(region)) {
    return { factor: 1.4, reason: "Yaz + kıyı bölge" };
  }
  return { factor: 1, reason: null };
}

function riskOrder(tier: StockRiskTier): number {
  return {
    critical: 0,
    risk: 1,
    watch: 2,
    healthy: 3,
    unknown: 4,
  }[tier];
}

function trendFactorFor(last30: number, previous30: number): number {
  if (previous30 > 0) return round(clamp(last30 / previous30, TREND_FACTOR_MIN, TREND_FACTOR_MAX), 2);
  if (last30 > 0) return TREND_FACTOR_MAX;
  return 1;
}

function stockConfidenceFor(args: {
  dataQuality: StockDataQuality;
  lowConfidence: boolean;
  demandPattern: DemandPattern;
  lastInboundDays: number | null;
  netSignalRatio: number | null;
}): { score: number; label: StockConfidence } {
  let score = 100;
  if (args.dataQuality === "negative-stock") score -= 45;
  else if (args.dataQuality === "turnover-unreliable") score -= 30;
  else if (args.dataQuality === "no-demand") score -= 25;
  else if (args.dataQuality === "no-stock-signal") score -= 35;

  if (args.lowConfidence) score -= 30;
  if (args.demandPattern === "lumpy") score -= 25;
  else if (args.demandPattern === "erratic") score -= 18;
  else if (args.demandPattern === "intermittent") score -= 10;
  else if (args.demandPattern === "unknown") score -= 15;

  if (args.lastInboundDays == null) score -= 15;
  else if (args.lastInboundDays > 180) score -= 20;
  else if (args.lastInboundDays > 90) score -= 10;

  if (args.netSignalRatio != null && args.netSignalRatio >= 0.08) score += 5;
  const finalScore = round(clamp(score, 0, 100), 0);
  return {
    score: finalScore,
    label: finalScore >= 75 ? "high" : finalScore >= 50 ? "medium" : "low",
  };
}

function mapStockRow(row: RawStockRow): WietnauerStockSkuRow {
  const onHandQty = num(row.on_hand_qty);
  const soldQty90d = num(row.sold_qty_90d);
  const soldQty180d = num(row.sold_qty_180d);
  const demandDays180 = num(row.demand_days_180);
  const soldQty30d = num(row.sold_qty_30d);
  const soldQtyPrev30d = num(row.sold_qty_prev_30d);
  const stockStartQty = num(row.stock_start_qty);
  const stockEndQty = num(row.stock_end_qty);
  const stockSignalQty = num(row.stock_signal_qty);
  const openOrderQty = Math.max(0, num(row.open_order_qty));
  const inventoryPositionQty = onHandQty + openOrderQty;
  const leadTimeRaw = num(row.lead_time_days);
  const leadTimeDays = leadTimeRaw > 0 ? round(clamp(leadTimeRaw, 1, 60), 0) : DEFAULT_LEAD_TIME_DAYS;
  const leadTimeSource: LeadTimeSource = leadTimeRaw > 0 ? "dist-table" : "default";
  const avgDailyQty = soldQty90d / WINDOW_DAYS;
  const avgDemandInterval =
    demandDays180 > 0 ? DEMAND_WINDOW_DAYS / demandDays180 : null;
  const monthlyDemand = [
    num(row.month_0_qty),
    num(row.month_1_qty),
    num(row.month_2_qty),
    num(row.month_3_qty),
    num(row.month_4_qty),
    num(row.month_5_qty),
  ];
  const monthlyMean = monthlyDemand.reduce((sum, value) => sum + value, 0) / monthlyDemand.length;
  const monthlyStd = stddev(monthlyDemand);
  const demandCv2 = monthlyMean > 0 ? (monthlyStd / monthlyMean) ** 2 : null;
  const demandPattern = demandPatternFor(avgDemandInterval, demandCv2);
  const crostonDailyQty =
    demandDays180 > 0 && avgDemandInterval != null
      ? (soldQty180d / demandDays180) / avgDemandInterval
      : 0;
  const trendFactor = trendFactorFor(soldQty30d, soldQtyPrev30d);
  const seasonality = seasonalityFor(text(row.region));
  const forecastDailyQty = crostonDailyQty * trendFactor * seasonality.factor;
  const avgStockQty = (stockStartQty + stockEndQty) / 2;
  const daysLeft = forecastDailyQty > 0 && onHandQty > 0 ? onHandQty / forecastDailyQty : null;
  const projectedDaysLeft =
    forecastDailyQty > 0 && inventoryPositionQty > 0 ? inventoryPositionQty / forecastDailyQty : null;
  const turnover90d = avgStockQty > 0 ? soldQty90d / avgStockQty : null;
  const riskTier = riskTierFor(daysLeft, forecastDailyQty, onHandQty);
  // Kırılganlık: net stok toplam hareket hacminin ne kadarı? %2 altı → net,
  // bir yıllık dev akışın binde-birlik kalıntısı; tek eksik giriş işareti
  // çevirir. LOW_CONFIDENCE_RATIO eşiği canlı doğrulamayla (13 kritikten 11'i
  // <%2 çıktı) kalibre edildi.
  const netSignalRatio = stockSignalQty > 0 ? Math.abs(onHandQty) / stockSignalQty : null;
  const netSignalPct = netSignalRatio == null ? null : round(netSignalRatio * 100, 2);
  // Yalnızca stok-bazlı risk taşıyan (critical/risk) satırlar için anlamlı;
  // unknown zaten gösterilmiyor, healthy'de kırılganlık aksiyon değiştirmez.
  const lowConfidence =
    netSignalRatio != null &&
    netSignalRatio < LOW_CONFIDENCE_RATIO &&
    (riskTier === "critical" || riskTier === "risk");
  const dailyDemandStd = monthlyStd / 30;
  const safetyStockQty = SERVICE_LEVEL_Z * dailyDemandStd * Math.sqrt(leadTimeDays);
  const reorderPointQty = forecastDailyQty * leadTimeDays + safetyStockQty;
  const reorderGapQty = Math.max(0, reorderPointQty - inventoryPositionQty);
  const lastInboundDate = dateOnly(row.last_inbound_date);
  const lastInboundDays = daysBetween(lastInboundDate, currentDate());
  const dataQuality = dataQualityFor(onHandQty, forecastDailyQty, stockSignalQty, turnover90d);
  const confidence = stockConfidenceFor({
    dataQuality,
    lowConfidence,
    demandPattern,
    lastInboundDays,
    netSignalRatio,
  });

  return {
    skuId: num(row.sku_id),
    skuCode: String(row.sku_code ?? ""),
    skuName: String(row.sku_name ?? ""),
    brand: text(row.brand),
    category: text(row.category),
    distId: num(row.dist_id),
    distName: String(row.dist_name ?? ""),
    region: text(row.region),
    onHandQty: round(onHandQty),
    soldQty90d: round(soldQty90d),
    avgDailyQty: round(avgDailyQty, 3),
    soldQty180d: round(soldQty180d),
    demandDays180,
    avgDemandInterval: avgDemandInterval == null ? null : round(avgDemandInterval, 2),
    demandCv2: demandCv2 == null ? null : round(demandCv2, 3),
    demandPattern,
    crostonDailyQty: round(crostonDailyQty, 3),
    trendFactor,
    seasonalityFactor: seasonality.factor,
    seasonalityReason: seasonality.reason,
    forecastDailyQty: round(forecastDailyQty, 3),
    daysLeft: daysLeft == null ? null : round(daysLeft, 1),
    estimatedStockoutDate: estimateStockoutDate(daysLeft),
    turnover90d: turnover90d == null ? null : round(turnover90d, 3),
    stockStartQty: round(stockStartQty),
    stockEndQty: round(stockEndQty),
    avgStockQty: round(avgStockQty),
    openOrderQty: round(openOrderQty),
    inventoryPositionQty: round(inventoryPositionQty),
    projectedDaysLeft: projectedDaysLeft == null ? null : round(projectedDaysLeft, 1),
    projectedStockoutDate: estimateStockoutDate(projectedDaysLeft),
    lastInboundDate,
    lastInboundDays,
    leadTimeDays,
    leadTimeSource,
    safetyStockQty: round(safetyStockQty),
    reorderPointQty: round(reorderPointQty),
    reorderGapQty: round(reorderGapQty),
    stockConfidence: confidence.label,
    stockConfidenceScore: confidence.score,
    netSignalPct,
    lowConfidence,
    riskTier,
    dataQuality,
  };
}

async function fetchStockRows(distIdFilter: number | null): Promise<WietnauerStockSkuRow[]> {
  const { brandTable, brandJoinCol, categoryTable, categoryJoinCol } = getBrandAndCategoryMeta();
  // Bölge etiketi tenant'a göre TERS: Pernod TBLDISTGRUP(TXTGRUP), Wietnauer
  // TBLDISTEKGRUP(TXTEKGRUP). (komuta/saha ile aynı desen.)
  const distRegionTable = getTenantConfig().distRegionTable ?? "TBLDISTGRUP";
  const distRegionColumn = getTenantConfig().distRegionColumn ?? "TXTGRUP";
  // Dist filter için WHERE fragment'ları — SQL injection risksiz (parametre int).
  const stockDistFilter = distIdFilter != null
    ? `AND ((f.LNGDISTKOD = ${distIdFilter}) OR (h.LNGDISTKOD = ${distIdFilter}))`
    : "";
  const salesDistFilter = distIdFilter != null
    ? `AND f.LNGDISTKOD = ${distIdFilter}`
    : "";
  const openOrderDistFilter = distIdFilter != null
    ? `AND LNGDISTKOD = ${distIdFilter}`
    : "";
  const sql = `
    WITH stock_movements AS (
      SELECT
        d.LNGURUNKOD AS sku_id,
        COALESCE(f.LNGDISTKOD, h.LNGDISTKOD) AS dist_id,
        CASE
          WHEN f.LNGBELGEKOD IS NOT NULL THEN f.TRHISLEMTARIHI
          ELSE h.TRHISLEMTARIHI
        END AS movement_date,
        CAST(d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1) * d.LNGSTOKTIP AS DECIMAL(18, 4)) AS signed_qty
      FROM dbo.TBLMSDBELGEDETAY d
      LEFT JOIN dbo.TBLMSDFATURA f
        ON f.LNGYIL = d.LNGYIL
       AND f.LNGBELGEKOD = d.LNGFATURAKOD
       AND f.LNGDISTKOD = d.LNGDISTKOD
       AND f.BYTDURUM = 0
      LEFT JOIN dbo.TBLMSDDEPOHAREKET h
        ON h.LNGYIL = d.LNGYIL
       AND h.LNGBELGEKOD = d.LNGDEPOHAREKETKOD
       AND h.LNGDISTKOD = d.LNGDISTKOD
       AND h.BYTDURUM = 0
       AND h.BYTONAY = 1
      WHERE d.LNGSTOKTIP IN (-1, 1)
        ${stockDistFilter}
        AND (
          (f.LNGBELGEKOD IS NOT NULL AND f.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()}))
          OR
          (h.LNGBELGEKOD IS NOT NULL AND h.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()}))
        )
    ),
    stock AS (
      SELECT
        sku_id,
        dist_id,
        SUM(CASE WHEN movement_date < DATEADD(day, -${WINDOW_DAYS}, ${sqlNow()}) THEN signed_qty ELSE 0 END) AS stock_start_qty,
        SUM(signed_qty) AS stock_end_qty,
        SUM(ABS(signed_qty)) AS stock_signal_qty,
        MAX(CASE WHEN signed_qty > 0 THEN movement_date ELSE NULL END) AS last_inbound_date
      FROM stock_movements
      WHERE dist_id IS NOT NULL
      GROUP BY sku_id, dist_id
    ),
    open_orders AS (
      SELECT
        LNGURUNKOD AS sku_id,
        LNGDISTKOD AS dist_id,
        SUM(DBLACIKSIP) AS open_order_qty
      FROM dbo.TBLRPAACIKSIPARIS
      WHERE DBLACIKSIP > 0
        ${openOrderDistFilter}
      GROUP BY LNGURUNKOD, LNGDISTKOD
    ),
    lead_times AS (
      SELECT
        LNGDISTKOD AS dist_id,
        AVG(CAST(NULLIF(LNGTEDARIKSURE, 0) AS DECIMAL(18, 4))) AS lead_time_days
      FROM dbo.TBLRPABAYITEDARIKSURE
      WHERE LNGTEDARIKSURE > 0
      GROUP BY LNGDISTKOD
    ),
    sales AS (
      SELECT
        d.LNGURUNKOD AS sku_id,
        f.LNGDISTKOD AS dist_id,
        SUM(CASE
          WHEN f.TRHISLEMTARIHI >= DATEADD(day, -${WINDOW_DAYS}, ${sqlNow()})
          THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1)
          ELSE 0
        END) AS sold_qty_90d,
        SUM(d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1)) AS sold_qty_180d,
        COUNT(DISTINCT CAST(f.TRHISLEMTARIHI AS DATE)) AS demand_days_180,
        SUM(CASE
          WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
          THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1)
          ELSE 0
        END) AS sold_qty_30d,
        SUM(CASE
          WHEN f.TRHISLEMTARIHI >= DATEADD(day, -60, ${sqlNow()})
           AND f.TRHISLEMTARIHI < DATEADD(day, -30, ${sqlNow()})
          THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1)
          ELSE 0
        END) AS sold_qty_prev_30d,
        SUM(CASE WHEN DATEDIFF(month, DATEFROMPARTS(YEAR(f.TRHISLEMTARIHI), MONTH(f.TRHISLEMTARIHI), 1), DATEFROMPARTS(YEAR(${sqlNow()}), MONTH(${sqlNow()}), 1)) = 0 THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1) ELSE 0 END) AS month_0_qty,
        SUM(CASE WHEN DATEDIFF(month, DATEFROMPARTS(YEAR(f.TRHISLEMTARIHI), MONTH(f.TRHISLEMTARIHI), 1), DATEFROMPARTS(YEAR(${sqlNow()}), MONTH(${sqlNow()}), 1)) = 1 THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1) ELSE 0 END) AS month_1_qty,
        SUM(CASE WHEN DATEDIFF(month, DATEFROMPARTS(YEAR(f.TRHISLEMTARIHI), MONTH(f.TRHISLEMTARIHI), 1), DATEFROMPARTS(YEAR(${sqlNow()}), MONTH(${sqlNow()}), 1)) = 2 THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1) ELSE 0 END) AS month_2_qty,
        SUM(CASE WHEN DATEDIFF(month, DATEFROMPARTS(YEAR(f.TRHISLEMTARIHI), MONTH(f.TRHISLEMTARIHI), 1), DATEFROMPARTS(YEAR(${sqlNow()}), MONTH(${sqlNow()}), 1)) = 3 THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1) ELSE 0 END) AS month_3_qty,
        SUM(CASE WHEN DATEDIFF(month, DATEFROMPARTS(YEAR(f.TRHISLEMTARIHI), MONTH(f.TRHISLEMTARIHI), 1), DATEFROMPARTS(YEAR(${sqlNow()}), MONTH(${sqlNow()}), 1)) = 4 THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1) ELSE 0 END) AS month_4_qty,
        SUM(CASE WHEN DATEDIFF(month, DATEFROMPARTS(YEAR(f.TRHISLEMTARIHI), MONTH(f.TRHISLEMTARIHI), 1), DATEFROMPARTS(YEAR(${sqlNow()}), MONTH(${sqlNow()}), 1)) = 5 THEN d.DBLMIKTAR * ISNULL(d.DBLCEVRIM, 1) ELSE 0 END) AS month_5_qty
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0
        AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -${DEMAND_WINDOW_DAYS}, ${sqlNow()})
        AND f.TRHISLEMTARIHI < DATEADD(day, 1, ${sqlNow()})
        ${salesDistFilter}
      GROUP BY d.LNGURUNKOD, f.LNGDISTKOD
    ),
    combos AS (
      -- Aktif SKU × hareket görmüş dist kombinasyonları. Stok veya satış'ın
      -- olduğu her (sku, dist) çifti için 1 satır — dist bilgisini kaybetmemek
      -- için TBLURUN'a doğrudan JOIN yerine hareketten türetiyoruz.
      SELECT sku_id, dist_id FROM stock
      UNION
      SELECT sku_id, dist_id FROM sales
      UNION
      SELECT sku_id, dist_id FROM open_orders
    )
    SELECT
      cb.sku_id,
      cb.dist_id,
      u.TXTKOD AS sku_code,
      u.TXTAD AS sku_name,
      b.TXTAD AS brand,
      c.TXTAD AS category,
      dst.TXTAD AS dist_name,
      dg.TXTAD AS region,
      ISNULL(st.stock_start_qty, 0) AS stock_start_qty,
      ISNULL(st.stock_end_qty, 0) AS stock_end_qty,
      ISNULL(st.stock_signal_qty, 0) AS stock_signal_qty,
      ISNULL(oo.open_order_qty, 0) AS open_order_qty,
      lt.lead_time_days,
      st.last_inbound_date,
      ISNULL(s.sold_qty_90d, 0) AS sold_qty_90d,
      ISNULL(s.sold_qty_180d, 0) AS sold_qty_180d,
      ISNULL(s.demand_days_180, 0) AS demand_days_180,
      ISNULL(s.sold_qty_30d, 0) AS sold_qty_30d,
      ISNULL(s.sold_qty_prev_30d, 0) AS sold_qty_prev_30d,
      ISNULL(s.month_0_qty, 0) AS month_0_qty,
      ISNULL(s.month_1_qty, 0) AS month_1_qty,
      ISNULL(s.month_2_qty, 0) AS month_2_qty,
      ISNULL(s.month_3_qty, 0) AS month_3_qty,
      ISNULL(s.month_4_qty, 0) AS month_4_qty,
      ISNULL(s.month_5_qty, 0) AS month_5_qty,
      ISNULL(st.stock_end_qty, 0) AS on_hand_qty
    FROM combos cb
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = cb.sku_id AND u.BYTDURUM = 0
    INNER JOIN dbo.TBLDIST dst ON dst.LNGKOD = cb.dist_id
    LEFT JOIN dbo.${distRegionTable} dg ON dg.TXTKOD = dst.${distRegionColumn}
    LEFT JOIN stock st ON st.sku_id = cb.sku_id AND st.dist_id = cb.dist_id
    LEFT JOIN sales s ON s.sku_id = cb.sku_id AND s.dist_id = cb.dist_id
    LEFT JOIN open_orders oo ON oo.sku_id = cb.sku_id AND oo.dist_id = cb.dist_id
    LEFT JOIN lead_times lt ON lt.dist_id = cb.dist_id
    LEFT JOIN dbo.${brandTable} b ON b.TXTKOD = u.${brandJoinCol}
    LEFT JOIN dbo.${categoryTable} c ON c.TXTKOD = u.${categoryJoinCol}
    ORDER BY
      CASE
        WHEN ISNULL(s.sold_qty_90d, 0) > 0 AND ISNULL(st.stock_end_qty, 0) > 0
          THEN ISNULL(st.stock_end_qty, 0) / NULLIF(ISNULL(s.sold_qty_90d, 0) / ${WINDOW_DAYS}.0, 0)
        ELSE 999999
      END ASC,
      ISNULL(s.sold_qty_90d, 0) DESC
  `;

  // Dist × SKU cartesian dolayısıyla yüksek satır sayısı: 287 SKU × ~21 dist
  // = ~6000. Filter yoksa bile taşımıyor.
  const result = await runReadOnly(sql, { limit: 20000, timeoutMs: 180_000 });
  return result.rows.map(mapStockRow).sort((a, b) => {
    const tierDelta = riskOrder(a.riskTier) - riskOrder(b.riskTier);
    if (tierDelta !== 0) return tierDelta;
    const aDays = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const bDays = b.daysLeft ?? Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    return b.soldQty90d - a.soldQty90d;
  });
}

/**
 * Dropdown için tüm distribütörlerin özet listesi. Filter uygulansa da tam
 * liste döner — UI dropdown'u tutarlı görünsün. Aggregate hesabı runtime'da
 * `allRows` üzerinden yapılır; ayrı bir SQL sorgusuna gerek yok.
 */
function buildDistributorSummary(
  allRows: WietnauerStockSkuRow[],
): WietnauerStockDistributorSummary[] {
  const byDist = new Map<number, WietnauerStockSkuRow[]>();
  for (const row of allRows) {
    const arr = byDist.get(row.distId);
    if (arr) arr.push(row);
    else byDist.set(row.distId, [row]);
  }
  return [...byDist.entries()]
    .map(([distId, items]) => ({
      distId,
      distName: items[0]?.distName ?? "",
      region: items[0]?.region ?? null,
      skuCount: items.length,
      criticalCount: items.filter((r) => r.riskTier === "critical").length,
      riskCount: items.filter((r) => r.riskTier === "risk").length,
      watchCount: items.filter((r) => r.riskTier === "watch").length,
      healthyCount: items.filter((r) => r.riskTier === "healthy").length,
      unknownCount: items.filter((r) => r.riskTier === "unknown").length,
      totalOnHandQty: round(items.reduce((sum, r) => sum + r.onHandQty, 0)),
      totalSoldQty90d: round(items.reduce((sum, r) => sum + r.soldQty90d, 0)),
    }))
    .sort((a, b) => {
      // Kritik/riskli yüksek olan üstte; eşitse ciro proxysi soldQty90d
      const riskDelta = b.criticalCount + b.riskCount - (a.criticalCount + a.riskCount);
      if (riskDelta !== 0) return riskDelta;
      return b.totalSoldQty90d - a.totalSoldQty90d;
    });
}

async function snapshotTablesEmpty(): Promise<boolean> {
  const sql = `
    SELECT
      (SELECT COUNT(*) FROM dbo.TBLDISTGUNLUKSTOK) AS dist_daily_stock,
      (SELECT COUNT(*) FROM dbo.TBLENTDEPOSTOKDURUM) AS ent_depo_stock,
      (SELECT COUNT(*) FROM dbo.TBLSTOKBARDEPOSTOK) AS barcode_depo_stock
  `;
  const result = await runReadOnly(sql, { limit: 1, timeoutMs: 30_000 });
  const row = result.rows[0] ?? {};
  return (
    num(row.dist_daily_stock) === 0 &&
    num(row.ent_depo_stock) === 0 &&
    num(row.barcode_depo_stock) === 0
  );
}

function buildTotals(rows: WietnauerStockSkuRow[]): WietnauerStockSnapshot["totals"] {
  return {
    activeSkuCount: rows.length,
    soldSkuCount90d: rows.filter((r) => r.soldQty90d > 0).length,
    positiveStockSkuCount: rows.filter((r) => r.onHandQty > 0).length,
    criticalSkuCount: rows.filter((r) => r.riskTier === "critical").length,
    riskSkuCount: rows.filter((r) => r.riskTier === "risk").length,
    watchSkuCount: rows.filter((r) => r.riskTier === "watch").length,
    healthySkuCount: rows.filter((r) => r.riskTier === "healthy").length,
    unknownSkuCount: rows.filter((r) => r.riskTier === "unknown").length,
    negativeStockSkuCount: rows.filter((r) => r.onHandQty < 0).length,
    noDemandSkuCount: rows.filter((r) => r.soldQty90d <= 0).length,
    turnoverComputableSkuCount: rows.filter((r) => r.turnover90d != null).length,
    lowConfidenceSkuCount: rows.filter((r) => r.lowConfidence).length,
    lowConfidenceRatePct:
      rows.length > 0 ? round((rows.filter((r) => r.lowConfidence).length / rows.length) * 100, 1) : 0,
    incomingOrderSkuCount: rows.filter((r) => r.openOrderQty > 0).length,
    totalIncomingQty: round(rows.reduce((sum, r) => sum + r.openOrderQty, 0)),
    leadTimeConfiguredSkuCount: rows.filter((r) => r.leadTimeSource === "dist-table").length,
  };
}

function buildBrandSummary(rows: WietnauerStockSkuRow[]): WietnauerStockBrandSummary[] {
  const byBrand = new Map<string, WietnauerStockSkuRow[]>();
  for (const row of rows) {
    const key = row.brand ?? "Marka tanımsız";
    byBrand.set(key, [...(byBrand.get(key) ?? []), row]);
  }

  return [...byBrand.entries()]
    .map(([brand, items]) => {
      const days = items
        .map((item) => item.daysLeft)
        .filter((value): value is number => value != null && Number.isFinite(value));
      return {
        brand,
        skuCount: items.length,
        criticalCount: items.filter((r) => r.riskTier === "critical").length,
        riskCount: items.filter((r) => r.riskTier === "risk").length,
        watchCount: items.filter((r) => r.riskTier === "watch").length,
        healthyCount: items.filter((r) => r.riskTier === "healthy").length,
        unknownCount: items.filter((r) => r.riskTier === "unknown").length,
        totalOnHandQty: round(items.reduce((sum, item) => sum + item.onHandQty, 0)),
        totalSoldQty90d: round(items.reduce((sum, item) => sum + item.soldQty90d, 0)),
        avgDaysLeft:
          days.length > 0 ? round(days.reduce((sum, value) => sum + value, 0) / days.length, 1) : null,
      };
    })
    .sort((a, b) => {
      const riskDelta = b.criticalCount + b.riskCount - (a.criticalCount + a.riskCount);
      if (riskDelta !== 0) return riskDelta;
      return b.totalSoldQty90d - a.totalSoldQty90d;
    });
  // md40: tüm markalar gösterilir (eski slice(0,20) kaldırıldı).
}

function buildQuality(
  rows: WietnauerStockSkuRow[],
  emptySnapshotTables: boolean,
): WietnauerStockSnapshot["quality"] {
  return {
    stockSignalSkuCount: rows.filter((r) => r.dataQuality !== "no-stock-signal").length,
    zeroStockSkuCount: rows.filter((r) => r.onHandQty === 0).length,
    negativeStockSkuCount: rows.filter((r) => r.onHandQty < 0).length,
    turnoverUnreliableSkuCount: rows.filter((r) => r.soldQty90d > 0 && r.turnover90d == null).length,
    incomingOrderSkuCount: rows.filter((r) => r.openOrderQty > 0).length,
    leadTimeConfiguredSkuCount: rows.filter((r) => r.leadTimeSource === "dist-table").length,
    snapshotTablesEmpty: emptySnapshotTables,
  };
}

export async function getWietnauerStokSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    /** null/undefined → tüm distribütör toplamı; int → o dist'in kırılımı. */
    distId?: number | null;
    /**
     * Yetki kapsamı: null/undefined → tüm distribütörler (merkez). Dizi →
     * yalnızca bu dist'ler görünür (dist kullanıcı). Dropdown + veri + drill-down
     * bu kümeyle sınırlanır; kapsam dışı distId göz ardı edilir.
     */
    allowedDistKods?: number[] | null;
  } = {},
): Promise<WietnauerStockSnapshot> {
  void options.strategicBrands;

  // Cache stratejisi: full dataset ("all") tek sefer çekilir, dist filter'ı
  // runtime'da uygulanır. Bu sayede aynı dataset tüm dropdown seçimlerini
  // besliyor, MSSQL'e 21 ayrı sorgu gitmiyor.
  const cacheKey = `${CACHE_VERSION}-${WINDOW_DAYS}g-all`;
  const result = await withCache<{
    allRows: WietnauerStockSkuRow[];
    emptySnapshotTables: boolean;
    generatedAt: string;
  }>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      const [rows, emptySnapshotTables] = await Promise.all([
        fetchStockRows(null),
        snapshotTablesEmpty(),
      ]);
      return {
        allRows: rows,
        emptySnapshotTables,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const { allRows: rawRows, emptySnapshotTables, generatedAt } = result.value;

  // 1) Yetki kapsamı — dist kullanıcı için önce izinli dist'lere daralt.
  //    Böylece dropdown, veri ve drill-down hepsi kapsam içinde kalır.
  const allowed = options.allowedDistKods;
  const scopedRows =
    allowed && allowed.length > 0
      ? rawRows.filter((r) => allowed.includes(r.distId))
      : allowed && allowed.length === 0
        ? [] // izinli dist yok → hiçbir şey görme (güvenli varsayılan)
        : rawRows;

  const distributors = buildDistributorSummary(scopedRows);

  // 2) Drill-down distId — yalnızca kapsam içindeyse uygulanır.
  const requestedDistId = options.distId ?? null;
  const distId =
    requestedDistId != null && distributors.some((d) => d.distId === requestedDistId)
      ? requestedDistId
      : null;
  const filteredRows = distId != null
    ? scopedRows.filter((r) => r.distId === distId)
    : scopedRows;

  const distFilter = distId != null
    ? (() => {
        const summary = distributors.find((d) => d.distId === distId);
        return summary
          ? { distId: summary.distId, distName: summary.distName, region: summary.region }
          : null;
      })()
    : null;

  return {
    generatedAt,
    demoDate: demoDate(),
    windowDays: WINDOW_DAYS,
    distFilter,
    distributors,
    totals: buildTotals(filteredRows),
    critical: filteredRows
      .filter((r) => r.riskTier === "critical" || r.riskTier === "risk")
      .slice(0, 30),
    items: filteredRows.slice(0, 200),
    brandSummary: buildBrandSummary(filteredRows),
    quality: buildQuality(filteredRows, emptySnapshotTables),
  };
}
