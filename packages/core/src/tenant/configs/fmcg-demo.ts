import type { TenantConfig } from "../types";

/**
 * FMCG Demo — Şölen / Nestle / Haribo gibi prospect'lere sunum için karma
 * demo tenant'ı.
 *
 * Bu config gerçek bir müşteriye değil, demo SQLite (`fmcg-demo.sqlite`)
 * üzerinden çalışır → `tools/seed-fmcg-demo.ts` ile karma FMCG dummy data
 * üretilir (çikolata + bisküvi + kahve + temizlik + atıştırmalık karma).
 *
 * Sunum sırasında prospect'in sektörüne göre `displayName` ve `logoMark`
 * elle güncellenebilir; ürün katmanları zaten karma olduğu için her FMCG
 * markasına makul gelir.
 *
 * Birim:
 *   - 9LE yok (alkol-özel)
 *   - Hacim toggle FMCG'de "adet/koli" — bu config "kg" kullanıyor ama
 *     `showInToggle: false` (demo karmaşık olmasın; sadece TL)
 *
 * Vergi:
 *   - OTV yok; KDV var ama dashboard'da toggle gereksiz → `showInToggle: false`
 */
export const FMCG_DEMO_CONFIG: TenantConfig = {
  id: "fmcg-demo",
  displayName: "FMCG Demo · Pusula",
  industry: "fmcg",
  logoMark: "FM",
  productName: "Enroute Pusula",

  // Demo data ayrı dosyaya yazılır — Pernod canlı verisi etkilenmez.
  sqliteFileName: "fmcg-demo.sqlite",

  volume: {
    key: "adet",
    short: "ad",
    longLabel: "Adet (koli)",
    hint: "Tüm değerler koli adedi bazında. Demo data'da SKU başına ortalama koli içeriği rastgele atanmıştır.",
    // Demo karmaşık olmasın diye toggle gizli — sadece TL gösterilir.
    showInToggle: false,
  },
  tax: {
    key: "kdv",
    label: "KDV hariç",
    // FMCG'de KDV toggle'ı operasyonel değer katmıyor — gizli.
    showInToggle: false,
  },
  currencySymbol: "₺",

  // FMCG demo MSSQL'e bağlanmaz (synth data); ama tip uyumluluğu için
  // varsayılan değerler. Pernod ile aynı katmanlama: marka = ek grup.
  brandTable: "TBLURUNEKGRUP",
  brandJoinColumn: "TXTURUNEKGRUPKOD",

  labels: {
    morningHeadline: "Bu Sabah Sahada Ne Oluyor",
    channelTypeTitle: "Müşteri Tipi · Son 12 Ay",
    channelTypeSource:
      "Müşteri tipi segmentasyonu: zincir market / bakkal-büfe / horeca / okul-kantin / hipermarket dağılımı.",
    mapEmptyDataSource:
      "Henüz hiç senkronizasyon yapılmamış. Sağ üstteki Verileri yenile butonuna tıklayarak ERP'den müşteri listesini SQLite'a kopyalayın.",
    kpiSourceNote: "Satış fatura tabanlı · ciro + fatura sayısı + koli hacmi",
    volumeMultiplierHint:
      "Koli çarpanı: her SKU'nun raf birimi başına koli adedi (paket içeriği).",
  },
};
