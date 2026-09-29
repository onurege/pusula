import { BreakdownSection, type BreakdownDimensionConfig } from "./BreakdownSection";

/**
 * B) Ürün Kırılımı Eşlemesi — `product-breakdown` servisiyle konuşur
 * (`packages/core/src/tenant/product-breakdown-config-service.ts`, ebeveyn
 * tablo `TBLURUN`). Davranış/render mantığı `BreakdownSection`'da paylaşılır —
 * bkz. o dosyanın dosya-üstü yorumu.
 */
const PRODUCT_BREAKDOWN_CONFIG: BreakdownDimensionConfig = {
  sectionId: "product-breakdown",
  endpointBase: "product-breakdown",
  title: "B. Ürün Kırılımı Eşlemesi",
  subtitle:
    "Kartlardan bir aday seç — canlı önizleme (örnek değerler + eşleşme " +
    "oranı) geldikten sonra kaydedebilirsin. Farklı bir aday görmek " +
    "önceki önizlemeyi değiştirmez, yalnız yenisini gösterir.",
  currentSourceHint: "Bu eşleme, sipariş/fatura kalemlerindeki ürün bazlı KPI ve grafiklerde kullanılır.",
  resetConfirmText: "Ürün kırılımı varsayılana döndürülsün mü?",
  parentEntityLabel: "aktif ürün",
};

export function ProductBreakdownSection() {
  return <BreakdownSection config={PRODUCT_BREAKDOWN_CONFIG} />;
}
