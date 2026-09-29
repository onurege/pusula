/**
 * Dist-scope SQL WHERE fragment üretici — `reorder.ts` VE `peer-aggregate.ts`
 * arasında PAYLAŞILIR.
 *
 * Ayrı dosyaya çıkarılma sebebi: `peer-aggregate.ts` müşteri-bağımsız akran
 * agregatını üretir, `reorder.ts` onu TÜKETİR (walletGap/peerCrossSell için)
 * — bu fonksiyon `reorder.ts` içinde kalsaydı `peer-aggregate.ts → reorder.ts
 * → peer-aggregate.ts` DAİRESEL import oluşurdu (ESM'de teknik olarak
 * çalışabilir ama kırılgan/okunaksız). `reorder.ts` geriye-uyum için bunu
 * `distScopeClause` adıyla RE-EXPORT eder — mevcut `__tests__/reorder.test.ts`
 * bu isimle `../reorder.js`'den import ediyor, o yol bozulmaz.
 *
 * Semantik `auth.ts`'teki `distFilterClause` ile AYNI (bkz. oradaki yorum):
 *   - `distId` verilmişse (merkez drill-down / dist tek-dist scope) → o tek dist.
 *   - yoksa `allowedDistKods` null → filtre yok (merkez, filtresiz).
 *   - `allowedDistKods` boş dizi → izinli dist yok → `1=0` (hiçbir şey görme).
 */
export function distScopeClause(
  options: { allowedDistKods?: number[] | null; distId?: number | null },
  alias = "f.LNGDISTKOD",
): string {
  const effective =
    options.distId != null ? [options.distId] : (options.allowedDistKods ?? null);
  if (effective == null) return "";
  const ids = effective.filter((n) => Number.isInteger(n));
  if (ids.length === 0) return " AND 1=0";
  return ` AND ${alias} IN (${ids.join(",")})`;
}
