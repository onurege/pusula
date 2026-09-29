// Cockpit periyot seçenekleri — SERVER-GÜVENLİ (no "use client").
// Hem server (app/komuta/page.tsx başlık/KPI etiketi) hem client
// (KomutaPeriyotDropdown) buradan tüketir. RSC kuralı: bir client modülünden
// export edilen fonksiyon server'dan ÇAĞRILAMAZ; bu yüzden tek-kaynak burada
// (yönerge içermeyen düz modül) durur.
import { t as translate, type Locale } from "@/lib/i18n";

export const PERIYOT_KEYS: { kod: string; key: string; trDefault: string }[] = [
  { kod: "30g", key: "komuta.periyot.30g", trDefault: "Son 30 Gün" },
  { kod: "p3", key: "komuta.periyot.p3", trDefault: "Son 3 Ay" },
  { kod: "p6", key: "komuta.periyot.p6", trDefault: "Son 6 Ay" },
  { kod: "p12", key: "komuta.periyot.p12", trDefault: "Son 12 Ay" },
  { kod: "ytd", key: "komuta.periyot.ytd", trDefault: "Bu Yıl" },
];

/** Seçili periyodun okunur etiketi — sözlükle senkron tek kaynak.
 *  Bilinmeyen kod → p12 etiketi. */
export function periyotLabel(periyot: string | null | undefined, locale: Locale): string {
  const o =
    PERIYOT_KEYS.find((x) => x.kod === periyot) ?? PERIYOT_KEYS.find((x) => x.kod === "p12")!;
  return translate(locale, o.key, o.trDefault);
}
