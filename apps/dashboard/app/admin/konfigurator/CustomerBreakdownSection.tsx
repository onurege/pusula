import { BreakdownSection, type BreakdownDimensionConfig } from "./BreakdownSection";

/**
 * A) Müşteri Kırılımı Eşlemesi — aktif kaynağı gösterir, küratörlü adaylar
 * arasından seçim yapılınca canlı önizler (örnek değer + eşleşme oranı + tip
 * uyum bayrağı), kaydeder ya da varsayılana döner. Davranış/render mantığı
 * `BreakdownSection`'da paylaşılır — bkz. o dosyanın dosya-üstü yorumu.
 */
const CUSTOMER_BREAKDOWN_CONFIG: BreakdownDimensionConfig = {
  sectionId: "customer-breakdown",
  endpointBase: "customer-breakdown",
  title: "A. Müşteri Kırılımı Eşlemesi",
  subtitle:
    "Kartlardan bir aday seç — canlı önizleme (örnek değerler + eşleşme " +
    "oranı) geldikten sonra kaydedebilirsin. Farklı bir aday görmek " +
    "önceki önizlemeyi değiştirmez, yalnız yenisini gösterir.",
  resetConfirmText: "Müşteri kırılımı varsayılana döndürülsün mü?",
  parentEntityLabel: "aktif müşteri",
};

export function CustomerBreakdownSection() {
  return <BreakdownSection config={CUSTOMER_BREAKDOWN_CONFIG} />;
}
