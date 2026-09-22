/**
 * Küratörlü ürün kırılımı ADAY listesi — konfigüratörün admin panelde
 * "ürün üst kırılımınız hangi tabloda?" sorusuna verdiği sabit cevap kümesi
 * (`customer-breakdown-candidates.ts` ile AYNI kalıp — bkz. o dosyanın
 * "neden ayrı dosya" gerekçesi, burada da geçerli).
 *
 * Ürünün üst kırılımını hangi lookup tablosunun taşıdığı kurulumdan kuruluma
 * değişir (bazı kurulumlarda TBLURUNEKGRUP, bazılarında TBLURUNGRUP; diğeri o
 * kurulumda kategori katmanını taşır). İkisi de aday listesindedir —
 * konfigüratör hangisinin doğru olduğuna admin'in canlı önizleme/eşleşme oranı
 * ile karar vermesini sağlar.
 */
import type { ProductBreakdownDimension } from "./types";

export type ProductBreakdownCandidate = ProductBreakdownDimension & {
  /** İstemcinin `POST .../preview` ve `POST .../product-breakdown`'a
   *  geçireceği kararlı anahtar — UI dropdown value'su. */
  id: string;
  /** Admin panelde gösterilecek kısa ad. */
  displayName: string;
  /** Bu adayın hangi tablo/kolon kurgusuna karşılık geldiğini açıklayan not. */
  description: string;
};

/**
 * Bugün kanıtlı iki lookup tablosu (bkz. `identifier.ts` PRODUCT_BREAKDOWN_*
 * allowlist'i — bu listedeki her `table`/`joinColumn` değeri o allowlist'in
 * bir alt kümesidir). Yeni bir aday eklemek için ÖNCE `identifier.ts`'e,
 * SONRA buraya eklenmeli — aksi halde `resolveProductBreakdown()` reddeder.
 */
export const PRODUCT_BREAKDOWN_CANDIDATES: readonly ProductBreakdownCandidate[] = [
  {
    id: "urun-ek-grup",
    displayName: "Ürün Ek Grubu (TBLURUNEKGRUP)",
    description:
      "Ürünün üst kırılımını TBLURUN.TXTURUNEKGRUPKOD → TBLURUNEKGRUP tablosundan alır. " +
      "Bazı kurulumlarda üst kırılım burada, kategori katmanı TBLURUNGRUP'tadır.",
    table: "TBLURUNEKGRUP",
    joinColumn: "TXTURUNEKGRUPKOD",
    labelColumn: "TXTAD",
  },
  {
    id: "urun-grup",
    displayName: "Ürün Grubu (TBLURUNGRUP)",
    description:
      "Ürünün üst kırılımını TBLURUN.TXTURUNGRUPKOD → TBLURUNGRUP tablosundan alır. " +
      "Diğer kurulumlarda bu tablo kategori katmanını taşıyabilir; iki tablo ters " +
      "kurgulanmış olabilir. Kaydetmeden önce önizleme/eşleşme oranı ile doğru üst " +
      "kırılım adlarının hangi tabloda olduğunu doğrulayın.",
    table: "TBLURUNGRUP",
    joinColumn: "TXTURUNGRUPKOD",
    labelColumn: "TXTAD",
  },
] as const;

/** id → aday lookup; bulunamazsa `undefined` (çağıran 400/404'e çevirir). */
export function findProductBreakdownCandidate(id: string): ProductBreakdownCandidate | undefined {
  return PRODUCT_BREAKDOWN_CANDIDATES.find((c) => c.id === id);
}
