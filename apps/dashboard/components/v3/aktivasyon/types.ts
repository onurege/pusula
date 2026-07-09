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
