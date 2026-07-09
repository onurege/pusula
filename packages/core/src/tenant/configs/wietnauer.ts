import type { TenantConfig } from "../types.js";

/**
 * Wietnauer Türkiye — Pernod gibi Univera ERP'sini kullanan alkol/içecek
 * dağıtıcısı. Pernod'dan ayrı bir DB (`WEITNAUER_TEST`) üzerinde çalışır;
 * şema aynı Univera ama veri tamamen farklı.
 *
 * Stratejik markaları (Jagermeister, Edrington, Beluga vb.) Pusula'ya
 * iletti — bunlar Wietnauer DB'sinde `TBLURUNEKGRUP.TXTAD` ile birebir
 * eşleşmeli. probe-wietnauer.ts ile teyit edilir.
 *
 * Veri kaynağı:
 *   - MSSQL: env `W_MSSQL_*` (aynı Univera sunucusu)
 *   - SQLite mirror: `data/wietnauer.sqlite`
 *
 * `TENANT=wietnauer` env var ile aktive edilir.
 */
export const WIETNAUER_CONFIG: TenantConfig = {
  id: "wietnauer",
  displayName: "Wietnauer Türkiye",
  industry: "alcohol",
  logoMark: "WT",
  productName: "Enroute Pusula",

  sqliteFileName: "wietnauer.sqlite",

  // MSSQL credentials — `.env`'de W_MSSQL_SERVER, W_MSSQL_DATABASE,
  // W_MSSQL_USER, W_MSSQL_PASSWORD kolonlarından okunur.
  mssqlEnvPrefix: "W_MSSQL_",

  // Alkol distribütörü ama 9LE çarpanı Pernod'a özel. Wietnauer'da hacim
  // birimi farklı olabilir — kullanıcıyla teyit edilene kadar gizli tut.
  // Toggle gizli, sadece TL gösterilir.
  volume: {
    key: "9le",
    short: "9L",
    longLabel: "9-Litre Eşdeğer",
    hint: "Hacim birimi henüz teyit edilmedi — TBLURUNEKSAHA çarpanı kontrol edilmeli.",
    showInToggle: false,
  },
  tax: {
    key: "otv",
    label: "OTV net",
    showInToggle: true, // alkol sektörü
  },
  currencySymbol: "₺",

  labels: {
    morningHeadline: "Bu Sabah Wietnauer'da Ne Oluyor",
    channelTypeTitle: "Müşteri Tipi · Son 12 Ay",
    channelTypeSource:
      "Müşteri tipi segmentasyonu: TBLMUSTERIEKSAHA × TBLEKSAHASECENEK lookup. Perakende / On Trade / Otel / Tali Bayi dağılımı.",
    mapEmptyDataSource:
      "Henüz hiç senkronizasyon yapılmamış. Sağ üstteki Verileri yenile butonuna tıklayarak WIETNAUER_TEST'ten müşteri listesini SQLite'a kopyalayın.",
    kpiSourceNote: "TBLMSDFATURA + TBLMSDBELGEDETAY",
    volumeMultiplierHint:
      "Hacim çarpanı: TBLURUNEKSAHA — Wietnauer ürün kataloğunda hangi sahanın hacim olduğu kontrol edilmeli.",
  },

  // Wietnauer marka yapısı: TBLURUNGRUP (JAGERMEISTER, BELUGA, MACALLAN,
  // HIGHLAND PARK, FAMOUS GROUSE, vb.). TBLURUNEKGRUP kategori taşır
  // (VISKI, VODKA, CIN, LIKÖR). Bu Pernod ile TAM TERS bir kurgu — Univera
  // standart hiyerarşi tutmaz, her dağıtıcı kendi yapısını kurar.
  brandTable: "TBLURUNGRUP",
  brandJoinColumn: "TXTURUNGRUPKOD",

  // Wietnauer talebi: Jagermeister, Edrington, Beluga.
  // "Edrington" tek marka değil — Edrington Group portföyü. Wietnauer DB'sinde
  // ayrı markalar olarak duruyor (Macallan, Highland Park, Famous Grouse,
  // Glenrothes, Brugal). Hepsi stratejik etiketle.
  // Bütün liste TBLURUNGRUP.TXTAD ile birebir eşleşmeli (case-insensitive).
  strategicBrands: [
    "JAGERMEISTER",
    "BELUGA",
    "MACALLAN",
    "HIGHLAND PARK",
    "FAMOUS GROUSE",
    "GLENROTHES",
    "BRUGAL",
  ],
};
