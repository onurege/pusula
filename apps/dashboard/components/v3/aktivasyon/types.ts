/**
 * Aktivasyon dashboard snapshot tipi — packages/core/src/wietnauer-aktivasyon.ts
 * şemasıyla aynalı. Endpoint `unknown` döndüğü için page.tsx'te type guard
 * olarak kullanılır.
 */
export type ActiveSegment = {
  segment: string;
  musteriSayi: number;
  payPct: number;
};

export type ActiveCustomers90d = {
  toplam: number;
  oncekiToplam: number;
  degisimPct: number;
  segments: ActiveSegment[];
};

export type SilentCustomer = {
  id: number;
  unvan: string;
  sehir: string | null;
  sonSatisTarihi: string | null;
  sessizGun: number;
  oncekiCiro: number;
  sonMarka: string | null;
};

export type StrategicBrandSilence = {
  marka: string;
  toplamMusteri: number;
  sessizMusteri: number;
  sessizPct: number;
};

export type RiskTierBucket = {
  tier: string;
  musteriSayi: number;
  payPct: number;
};

export type RecoveryTarget = {
  id: number;
  unvan: string;
  sehir: string | null;
  cirot90: number;
  sessizGun: number;
  riskTier: string | null;
};

export type AktivasyonSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  active: ActiveCustomers90d;
  silent: SilentCustomer[];
  strategicSilence: StrategicBrandSilence[];
  riskTiers: RiskTierBucket[];
  recovery: RecoveryTarget[];
};

/** Risk tier renkleri — brief'te tanımlanan palet. */
export const RISK_TIER_COLORS: Record<string, string> = {
  critical: "#F7C1C1",
  risk: "#FAC775",
  watch: "#D3D1C7",
  healthy: "#9FE1CB",
  unknown: "#E6E4DC",
};

export const RISK_TIER_LABELS: Record<string, string> = {
  critical: "Kritik",
  risk: "Risk",
  watch: "Takip",
  healthy: "Sağlıklı",
  unknown: "Bilinmiyor",
};

export const RISK_TIER_LABELS_EN: Record<string, string> = {
  critical: "Critical",
  risk: "Risk",
  watch: "Watch",
  healthy: "Healthy",
  unknown: "Unknown",
};

/**
 * Madde 13 — "visit-order" risk modeli (Wietnauer) 4 tier'ı, kötüden iyiye.
 * Composite'in (yukarıdaki) YERİNE geçer — aynı panelde ikisi bir arada
 * gösterilmez, `RiskTierPanel` `riskModel` prop'una göre birini seçer.
 */
export const VISIT_ORDER_TIER_ORDER = ["red", "orange", "yellow", "green"] as const;

/** Nokta rengiyle AYNI palet (bkz. components/sales-map.tsx COLOR_VO_*). */
export const VISIT_ORDER_TIER_COLORS: Record<string, string> = {
  red: "#F7C1C1",
  orange: "#FAC775",
  yellow: "#F5E6A0",
  green: "#9FE1CB",
};

export const VISIT_ORDER_TIER_LABELS: Record<string, string> = {
  red: "🔴 En Riskli",
  orange: "🟠 Riskli",
  yellow: "🟡 İzlenmeli",
  green: "🟢 Sağlıklı",
};

export const VISIT_ORDER_TIER_LABELS_EN: Record<string, string> = {
  red: "🔴 Most at risk",
  orange: "🟠 At risk",
  yellow: "🟡 Watch",
  green: "🟢 Healthy",
};

/** Guide — her tier'ın NEYE göre olduğu (madde 13b). */
export const VISIT_ORDER_TIER_GUIDE: Record<string, string> = {
  red: "Ziyaret YOK + sipariş YOK",
  orange: "Ziyaret YOK, sipariş VAR",
  yellow: "Ziyaret VAR, sipariş YOK",
  green: "Ziyaret VAR + sipariş VAR",
};

export const VISIT_ORDER_TIER_GUIDE_EN: Record<string, string> = {
  red: "Visit NO + order NO",
  orange: "Visit NO, order YES",
  yellow: "Visit YES, order NO",
  green: "Visit YES + order YES",
};
