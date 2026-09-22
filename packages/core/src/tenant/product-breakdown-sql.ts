/**
 * Ürün/marka kırılımı SQL fragment üreticileri — komuta.ts /
 * wietnauer-{marka,segment,aktivasyon,stok,metrics,iskonto}.ts sink'lerindeki
 * INLINE `dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}` deseninin TEK ortak
 * yerde toplanmış hâli (bkz. `customer-breakdown-sql.ts` — AYNI kalıp, ayrı
 * dosya: bu boyutun ebeveyn tablosu `TBLURUN`/alias `u`, müşteri kırılımının
 * `TBLMUSTERI`/alias `m` — iki ailenin fragment'larını TEK dosyada karıştırmak
 * "hangi alias hangi boyuta ait" karışıklığı yaratırdı).
 *
 * DAVRANIŞ KORUNUR: her fonksiyonun varsayılan alias'larla ürettiği metin,
 * refactor ÖNCESİ hardcoded `${brandTable}`/`${joinCol}` template literal'iyle
 * KARAKTER BAZINDA aynıdır (bkz. `tenant/__tests__/product-breakdown-sql.test.ts`).
 */
import type { ProductBreakdownMeta } from "./identifier";

/** `dbo.<table>` — JOIN'siz, standalone FROM/subquery kullanımı için (ör.
 *  wietnauer-aktivasyon.ts `strat` CTE: `FROM dbo.${brandTable} WHERE ...`). */
export function productBreakdownTableSql(meta: ProductBreakdownMeta): string {
  return `dbo.${meta.table}`;
}

/**
 * Marka lookup JOIN'i — `TBLURUN` (varsayılan alias `u`) üzerinden marka
 * tablosuna (varsayılan alias `b`) bağlanır. komuta.ts/wietnauer-*.ts'teki
 * (7 dosya, 14+ çağrı noktası) neredeyse hepsinin BİREBİR aynı çağırdığı
 * desen — `joinType` yalnız wietnauer-stok.ts'te "LEFT" (diğerleri "INNER").
 */
export function productBreakdownJoin(
  meta: ProductBreakdownMeta,
  opts: { joinType?: "INNER" | "LEFT"; parentAlias?: string; lookupAlias?: string } = {},
): string {
  const { joinType = "INNER", parentAlias = "u", lookupAlias = "b" } = opts;
  return `${joinType} JOIN dbo.${meta.table} ${lookupAlias} ON ${lookupAlias}.TXTKOD = ${parentAlias}.${meta.joinColumn}`;
}

/** Marka adı ifadesi — `<lookupAlias>.<labelColumn> AS <asAlias>` (ör. `b.TXTAD AS marka`). */
export function productBreakdownLabelExpr(meta: ProductBreakdownMeta, asAlias: string, lookupAlias = "b"): string {
  return `${lookupAlias}.${meta.labelColumn} AS ${asAlias}`;
}

/** Marka KODU ifadesi — lookup PK'sı, Univera kuralı gereği daima `TXTKOD`
 *  (ör. `b.TXTKOD AS marka_kod`). */
export function productBreakdownCodeExpr(asAlias: string, lookupAlias = "b"): string {
  return `${lookupAlias}.TXTKOD AS ${asAlias}`;
}
