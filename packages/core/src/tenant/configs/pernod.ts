import type { TenantConfig } from "../types";

/**
 * Pernod Ricard Türkiye — Pusula'nın orijinal müşterisi.
 *
 * `process.env.TENANT` boşsa bu config default olarak kullanılır → mevcut
 * üretim davranışı tam aynı kalır. Yeni tenant'lar eklendikçe burası
 * dokunulmaz (canlı sistem güvende).
 *
 * 9LE (9-Liter-Equivalent) — alkol sektörünün standart hacim birimi.
 * TBLURUNEKSAHA saha 26 "9 LT Değer" çarpanı ile hesaplanır.
 *
 * OTV (Özel Tüketim Vergisi) — alkol/tütüne özel; brüt ciroyu maskeler.
 * "OTV net" toggle'ı vergi-arındırılmış cironun gerçek operasyonel görünürlüğü.
 */
export const PERNOD_CONFIG: TenantConfig = {
  id: "pernod",
  displayName: "Pernod Ricard Türkiye",
  industry: "alcohol",
  logoMark: "EP",
  productName: "Enroute Pusula",

  // Mevcut DB dosyası — değişmez. Yeni tenant'lar ayrı dosyaya yazar.
  sqliteFileName: "local.sqlite",

  volume: {
    key: "9le",
    short: "9L",
    longLabel: "9-Litre Eşdeğer",
    hint: "Tüm değerler 9-Litre-Equivalent hacim bazında (Pernod resmi katsayı: TBLURUNEKSAHA saha 26)",
    showInToggle: true,
  },
  tax: {
    key: "otv",
    label: "OTV net",
    showInToggle: true,
  },
  currencySymbol: "₺",

  labels: {
    morningHeadline: "Bu Sabah Pernod'da Ne Oluyor",
    channelTypeTitle: "Müşteri Tipi · Son 12 Ay",
    channelTypeSource:
      "Müşteri tipi segmentasyonu: Perakende / On Trade / Otel / Tali Bayi / OPA dağılımı, son 12 ay.",
    mapEmptyDataSource:
      "Henüz hiç senkronizasyon yapılmamış. Sağ üstteki Verileri yenile butonuna tıklayarak PERNOD'dan müşteri listesini SQLite'a kopyalayın.",
    kpiSourceNote: "TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUNEKSAHA (9L için)",
    volumeMultiplierHint:
      '9L çarpanı: TBLURUNEKSAHA saha 26 "9 LT Değer" (Pernod\'un resmi katsayısı; 701 ürün için dolu)',
  },
};
