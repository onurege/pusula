/**
 * Küratörlü bölge kırılımı ADAY listesi — konfigüratörün admin panelde
 * "bölge kırılımınız hangi tabloda?" sorusuna verdiği sabit cevap kümesi
 * (`customer-breakdown-candidates.ts` ile AYNI kalıp).
 *
 * Dağıtım kaydının coğrafi bölge eşlemesini hangi lookup tablosunun taşıdığı
 * kurulumdan kuruluma değişir (bazı kurulumlarda TBLDISTGRUP bölge / TBLDISTEKGRUP
 * dağıtıcı tipi; bazılarında tersi). İkisi de aday listesindedir.
 */
import type { RegionBreakdownDimension } from "./types";

export type RegionBreakdownCandidate = RegionBreakdownDimension & {
  /** İstemcinin `POST .../preview` ve `POST .../region-breakdown`'a
   *  geçireceği kararlı anahtar — UI dropdown value'su. */
  id: string;
  /** Admin panelde gösterilecek kısa ad. */
  displayName: string;
  /** Bu adayın hangi tablo/kolon kurgusuna karşılık geldiğini açıklayan not. */
  description: string;
};

/**
 * Bugün kanıtlı iki lookup tablosu (bkz. `identifier.ts` REGION_BREAKDOWN_*
 * allowlist'i). Yeni bir aday eklemek için ÖNCE `identifier.ts`'e, SONRA
 * buraya eklenmeli — aksi halde `resolveRegionBreakdown()` reddeder.
 */
export const REGION_BREAKDOWN_CANDIDATES: readonly RegionBreakdownCandidate[] = [
  {
    id: "dist-grup",
    displayName: "Dağıtım Grubu (TBLDISTGRUP)",
    description:
      "Bölge kırılımını TBLDIST.TXTGRUP → TBLDISTGRUP tablosundan alır (örn. coğrafi " +
      "bölge adları). Bazı kurulumlarda bu tablo dağıtıcı tipini taşır.",
    table: "TBLDISTGRUP",
    joinColumn: "TXTGRUP",
    labelColumn: "TXTAD",
  },
  {
    id: "dist-ek-grup",
    displayName: "Dağıtım Ek Grubu (TBLDISTEKGRUP)",
    description:
      "Bölge kırılımını TBLDIST.TXTEKGRUP → TBLDISTEKGRUP tablosundan alır. Diğer " +
      "kurulumlarda bu tablo ikincil gruplamayı taşıyabilir; iki tablo ters kurgulanmış " +
      "olabilir. Kaydetmeden önce önizleme/eşleşme oranı ile doğru bölge adlarının hangi " +
      "tabloda olduğunu doğrulayın.",
    table: "TBLDISTEKGRUP",
    joinColumn: "TXTEKGRUP",
    labelColumn: "TXTAD",
  },
] as const;

/** id → aday lookup; bulunamazsa `undefined` (çağıran 400/404'e çevirir). */
export function findRegionBreakdownCandidate(id: string): RegionBreakdownCandidate | undefined {
  return REGION_BREAKDOWN_CANDIDATES.find((c) => c.id === id);
}
