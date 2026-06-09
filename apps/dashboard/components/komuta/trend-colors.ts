/**
 * Ortak trend (YoY/MoM delta) renk paleti — TÜM dashboard'da kullanılır.
 *
 * Renkler globals.css'teki --color-trend-* CSS variables'a referans verir.
 * Bu sayede:
 *   1. Tek noktadan ton ayarlama
 *   2. Dark mode otomatik (CSS variables zaten override'lı)
 *   3. Treemap, harita polygon, scatter bubble, city insights — hepsi
 *      aynı pastel paletteyi paylaşır (renk patlaması olmaz)
 *
 * SVG fill / paint için ham hex'e ihtiyaç olduğunda `TREND_HEX` map'i kullan
 * (CSS var'lar bazı recharts paint context'inde resolve olmuyor).
 */

export type TrendBucket =
  | "pos-strong" // +%15+
  | "pos-soft" //  +%5..+%15
  | "neutral" //   ±%5
  | "neg-soft" //  -%5..-%15
  | "neg-strong"; // -%15-

/** Pastel hex değerleri — Tailwind 300-400 ton. globals.css'tekilerle birebir. */
export const TREND_HEX: Record<TrendBucket, string> = {
  "pos-strong": "#4ade80", // green-400
  "pos-soft": "#a3e635",   // lime-400
  neutral: "#d6d3d1",       // stone-300
  "neg-soft": "#fb923c",    // orange-400
  "neg-strong": "#f87171",  // red-400
};

/** CSS var versiyonu — komuta-css.ts gibi CSS string'lerinde kullanılır. */
export const TREND_VAR: Record<TrendBucket, string> = {
  "pos-strong": "var(--color-trend-pos-strong)",
  "pos-soft": "var(--color-trend-pos-soft)",
  neutral: "var(--color-trend-neutral)",
  "neg-soft": "var(--color-trend-neg-soft)",
  "neg-strong": "var(--color-trend-neg-strong)",
};

/** YoY %'yi bucket'a çevir. null deltaPct → "neutral". */
export function trendBucket(deltaPct: number | null | undefined): TrendBucket {
  if (deltaPct == null) return "neutral";
  if (deltaPct >= 15) return "pos-strong";
  if (deltaPct >= 5) return "pos-soft";
  if (deltaPct >= -5) return "neutral";
  if (deltaPct >= -15) return "neg-soft";
  return "neg-strong";
}

/** Ham hex (SVG, canvas, recharts paint için) */
export function trendColor(deltaPct: number | null | undefined): string {
  return TREND_HEX[trendBucket(deltaPct)];
}

/** CSS var referansı (HTML style için) */
export function trendCssVar(deltaPct: number | null | undefined): string {
  return TREND_VAR[trendBucket(deltaPct)];
}

/** Legend için sabit sıralı tüm renk swatch'ları */
export const TREND_LEGEND: Array<{ bucket: TrendBucket; label: string; hex: string }> = [
  { bucket: "pos-strong", label: "+%15+", hex: TREND_HEX["pos-strong"] },
  { bucket: "pos-soft", label: "+%5..+%15", hex: TREND_HEX["pos-soft"] },
  { bucket: "neutral", label: "±%5", hex: TREND_HEX.neutral },
  { bucket: "neg-soft", label: "-%5..-%15", hex: TREND_HEX["neg-soft"] },
  { bucket: "neg-strong", label: "-%15-", hex: TREND_HEX["neg-strong"] },
];
