/**
 * Dashboard #4 — Marka & SKU Performansı için lokal tip declaration'ları.
 * Backend `getWietnauerMarkaSnapshot` çıktısı `getWietnauerMarka<T>()` ile
 * `unknown` döndüğü için sayfa tarafında tipi burada bağlıyoruz. Core paketi
 * import etmeden, sadece UI ile uyumlu sade tipler.
 */

export type MarkaPortfolioRow = {
  marka: string;
  markaKod: string;
  ciro: number;
  musteriSayi: number;
  faturaSayisi: number;
  payPct: number;
  rank: number;
  isStratejik: boolean;
  isOther?: boolean;
  isTotal?: boolean;
};

export type TopSkuRow = {
  urunKod: number;
  ad: string;
  marka: string;
  ciro: number;
  miktar: number;
  musteriSayi: number;
  payPct: number;
  rank: number;
  isStratejik: boolean;
  isOther?: boolean;
  isTotal?: boolean;
};

export type BrandPenetrationRow = {
  marka: string;
  markaKod: string;
  musteriSayi: number;
  aktifMusteriToplam: number;
  penetrasyonPct: number;
  rank: number;
  isStratejik: boolean;
  isOther?: boolean;
  isTotal?: boolean;
};

export type StratBrandTopSku = {
  urunKod: number;
  ad: string;
  ciro: number;
};

export type StrategicBrandDetail = {
  marka: string;
  markaKod: string;
  ciro: number;
  musteriSayi: number;
  faturaSayisi: number;
  topSkus: StratBrandTopSku[];
  hasData: boolean;
};

export type BrandWindowComparisonRow = {
  marka: string;
  markaKod: string;
  ciro30: number;
  ciro90: number;
  ciroYtd: number;
  son30Pay90Pct: number;
  son30PayYtdPct: number;
  rank: number;
  isStratejik: boolean;
};

export type WietnauerMarkaSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  toplamCiro30: number;
  aktifMusteriToplam: number;
  portfolio: MarkaPortfolioRow[];
  topSkus: TopSkuRow[];
  penetration: BrandPenetrationRow[];
  strategic: StrategicBrandDetail[];
  windowComparison: BrandWindowComparisonRow[];
};
