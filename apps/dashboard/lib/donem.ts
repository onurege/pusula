// md2 — aktif dönemin insan-okur etiketi (sayfa açıklamalarında statik
// "son 30 gün" yerine kullanılır). Serbest aralık varsa tarihleri gösterir.

const LABELS: Record<string, string> = {
  son30g: "son 30 gün",
  mtd: "bu ay",
  ytd: "bu yıl (YTD)",
  q1: "1. çeyrek",
  q2: "2. çeyrek",
  q3: "3. çeyrek",
};

/** Küçük-harf açıklama etiketi (cümle içinde: "…{etiket} net ciro üzerinden"). */
export function donemLabel(
  donem?: string | null,
  from?: string | null,
  to?: string | null,
): string {
  if (from && to) return `${from} – ${to} aralığı`;
  return LABELS[(donem ?? "").toLowerCase()] ?? "son 30 gün";
}
