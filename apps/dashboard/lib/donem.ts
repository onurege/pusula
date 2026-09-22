// md2 — aktif dönemin insan-okur etiketi (sayfa açıklamalarında statik
// "son 30 gün" yerine kullanılır). Serbest aralık varsa tarihleri gösterir.
import type { Locale } from "./i18n";

const LABELS: Record<string, string> = {
  son30g: "son 30 gün",
  mtd: "bu ay",
  ytd: "bu yıl (YTD)",
  q1: "1. çeyrek",
  q2: "2. çeyrek",
  q3: "3. çeyrek",
};

const LABELS_EN: Record<string, string> = {
  son30g: "the last 30 days",
  mtd: "this month",
  ytd: "this year (YTD)",
  q1: "Q1",
  q2: "Q2",
  q3: "Q3",
};

/** Küçük-harf açıklama etiketi (cümle içinde: "…{etiket} net ciro üzerinden"). */
export function donemLabel(
  donem?: string | null,
  from?: string | null,
  to?: string | null,
  locale: Locale = "tr",
): string {
  if (from && to) return locale === "en" ? `the ${from} – ${to} range` : `${from} – ${to} aralığı`;
  const labels = locale === "en" ? LABELS_EN : LABELS;
  return labels[(donem ?? "").toLowerCase()] ?? labels.son30g;
}
