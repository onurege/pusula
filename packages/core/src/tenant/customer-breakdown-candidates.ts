/**
 * Küratörlü müşteri kırılımı ADAY listesi — Insider konfigüratörünün admin
 * panelde "hangi tabloya geçeyim?" sorusuna verdiği sabit cevap kümesi
 * (Faz A Dalga 2, Database D2).
 *
 * Neden ayrı dosya (ve neden `identifier.ts`'in içine gömülmedi): burada
 * yalnız SQL güvenliği (regex + allowlist) değil, kullanıcıya gösterilecek
 * İNSAN OKUNABİLİR meta (ad/açıklama) da var — `identifier.ts` SQL enjeksiyon
 * savunmasının TEK sorumluluğuna sahip kalmalı (Sandi Metz: bir sınıf/dosya
 * bir sebeple değişir). Her adayın `table`/`joinColumn`/`labelColumn` üçlüsü
 * yine de `resolveCustomerBreakdown()`'dan geçirilmeden SQL'e gitmez —
 * bu liste yalnız "gösterilecek seçenekler", tek başına güven kaynağı değil.
 */
import type { CustomerBreakdownDimension } from "./types";

export type CustomerBreakdownCandidate = CustomerBreakdownDimension & {
  /** İstemcinin `POST .../preview` ve `POST .../customer-breakdown`'a
   *  geçireceği kararlı anahtar — UI dropdown value'su. */
  id: string;
  /** Admin panelde gösterilecek kısa ad. */
  displayName: string;
  /** Bu adayın hangi Univera kurgusuna karşılık geldiğini açıklayan not. */
  description: string;
};

/**
 * Bugün kanıtlı üç lookup tablosu (bkz. `identifier.ts` CUSTOMER_BREAKDOWN_*
 * allowlist'i — bu listedeki her `table`/`joinColumn` değeri o allowlist'in
 * bir alt kümesidir). Yeni bir aday eklemek için ÖNCE `identifier.ts`'e,
 * SONRA buraya eklenmeli — aksi halde `resolveCustomerBreakdown()` reddeder.
 */
export const CUSTOMER_BREAKDOWN_CANDIDATES: readonly CustomerBreakdownCandidate[] = [
  {
    id: "grup-kirilim",
    displayName: "Müşteri Grup Kırılımı",
    description:
      "Müşteri üst kırılımını TBLMUSTERI.TXTGRUPKIRILIMKOD → TBLMUSTERIGRUPKIRILIM " +
      "tablosundan alır. Çoğu kurulumun varsayılanı.",
    table: "TBLMUSTERIGRUPKIRILIM",
    joinColumn: "TXTGRUPKIRILIMKOD",
    labelColumn: "TXTAD",
  },
  {
    id: "grup",
    displayName: "Müşteri Grubu",
    description:
      "Müşteri kırılımını TBLMUSTERI.TXTGRUPKOD → TBLMUSTERIGRUP tablosundan alır " +
      "(ör. kanal ayrımı).",
    table: "TBLMUSTERIGRUP",
    joinColumn: "TXTGRUPKOD",
    labelColumn: "TXTAD",
  },
  {
    id: "ek-grup",
    displayName: "Müşteri Ek Grubu",
    description:
      "Müşteri kırılımını TBLMUSTERI.TXTEKGRUPKOD → TBLMUSTERIEKGRUP tablosundan alır. " +
      "Yalnızca doğrudan (\"direct\") bağlı kurulumlarda (bkz. config `customerEkGrupLink`) " +
      "anlamlı — köprü tabloyla (m2m) bağlı kurulumlarda bu FK boş olabilir; kaydetmeden " +
      "ÖNCE önizleme/eşleşme oranı ile doğrulayın.",
    table: "TBLMUSTERIEKGRUP",
    joinColumn: "TXTEKGRUPKOD",
    labelColumn: "TXTAD",
  },
] as const;

/** id → aday lookup; bulunamazsa `undefined` (çağıran 400/404'e çevirir). */
export function findCustomerBreakdownCandidate(id: string): CustomerBreakdownCandidate | undefined {
  return CUSTOMER_BREAKDOWN_CANDIDATES.find((c) => c.id === id);
}
