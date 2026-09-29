/**
 * Bölge kırılımı SQL fragment üreticileri — komuta.ts / wietnauer-{saha,
 * stok}.ts sink'lerindeki INLINE `dbo.${distRegionTable} dg ON dg.TXTKOD =
 * d.${distRegionColumn}` deseninin TEK ortak yerde toplanmış hâli (bkz.
 * `customer-breakdown-sql.ts`/`product-breakdown-sql.ts` — AYNI kalıp, ayrı
 * dosya: bu boyutun ebeveyn tablosu `TBLDIST`, alias sink'e göre değişir —
 * `d` (komuta.ts/wietnauer-saha.ts) ya da `dst` (wietnauer-stok.ts)).
 *
 * DAVRANIŞ KORUNUR: `parentAlias`/`lookupAlias`/`joinType` parametreleri her
 * sink'in KENDİ bugünkü alias'ını üretecek şekilde çağrılır — üretilen metin
 * refactor ÖNCESİ hardcoded literal'le KARAKTER BAZINDA aynıdır (bkz.
 * `tenant/__tests__/region-breakdown-sql.test.ts`).
 */
import type { RegionBreakdownMeta } from "./identifier";

/**
 * Bölge lookup JOIN'i — `TBLDIST` (ebeveyn alias, sink'e göre `d`/`dst`)
 * üzerinden bölge tablosuna (lookup alias, sink'e göre `dg`/`g`) bağlanır.
 * `parentAlias`/`lookupAlias` ZORUNLU — üç sink üçü de farklı alias çifti
 * kullanıyor, tek bir varsayılan "doğru" olmazdı (bkz. dosya üstü not).
 */
export function regionBreakdownJoin(
  meta: RegionBreakdownMeta,
  parentAlias: string,
  lookupAlias: string,
  joinType: "INNER" | "LEFT" = "LEFT",
): string {
  return `${joinType} JOIN dbo.${meta.table} ${lookupAlias} ON ${lookupAlias}.TXTKOD = ${parentAlias}.${meta.joinColumn}`;
}

/** Bölge adı ifadesi — `<lookupAlias>.<labelColumn> AS <asAlias>` (ör. `dg.TXTAD AS bolge`). */
export function regionBreakdownLabelExpr(meta: RegionBreakdownMeta, lookupAlias: string, asAlias: string): string {
  return `${lookupAlias}.${meta.labelColumn} AS ${asAlias}`;
}

/** Bölge KODU ifadesi — lookup PK'sı, Univera kuralı gereği daima `TXTKOD`
 *  (ör. `dg.TXTKOD AS bolgeKod`). */
export function regionBreakdownCodeExpr(lookupAlias: string, asAlias: string): string {
  return `${lookupAlias}.TXTKOD AS ${asAlias}`;
}
