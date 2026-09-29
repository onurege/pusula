import { BreakdownSection, type BreakdownDimensionConfig } from "./BreakdownSection";

/**
 * C) Bölge (Dağıtım) Kırılımı Eşlemesi — `region-breakdown` servisiyle
 * konuşur (`packages/core/src/tenant/region-breakdown-config-service.ts`,
 * ebeveyn tablo `TBLDIST`). Davranış/render mantığı `BreakdownSection`'da
 * paylaşılır — bkz. o dosyanın dosya-üstü yorumu.
 */
const REGION_BREAKDOWN_CONFIG: BreakdownDimensionConfig = {
  sectionId: "region-breakdown",
  endpointBase: "region-breakdown",
  title: "C. Bölge (Dağıtım) Kırılımı Eşlemesi",
  subtitle:
    "Kartlardan bir aday seç — canlı önizleme (örnek değerler + eşleşme " +
    "oranı) geldikten sonra kaydedebilirsin. Farklı bir aday görmek " +
    "önceki önizlemeyi değiştirmez, yalnız yenisini gösterir.",
  currentSourceHint: "Bu eşleme, dağıtım/bölge bazlı KPI ve grafiklerde kullanılır.",
  resetConfirmText: "Bölge (dağıtım) kırılımı varsayılana döndürülsün mü?",
  parentEntityLabel: "aktif dağıtım kaydı",
};

export function RegionBreakdownSection() {
  return <BreakdownSection config={REGION_BREAKDOWN_CONFIG} />;
}
