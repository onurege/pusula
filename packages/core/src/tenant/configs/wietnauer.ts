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

  // Wietnauer sadece V3 dashboard yapısını kullanır: login/kök V3'e iner,
  // V1/V2 sürüm geçişi gizli, arayüz light-only.
  ui: {
    defaultLanding: "/v3",
    hideVersionToggle: true,
    forceLightTheme: true,
  },

  sqliteFileName: "wietnauer.sqlite",

  // MSSQL credentials — `.env`'de W_MSSQL_SERVER, W_MSSQL_DATABASE,
  // W_MSSQL_USER, W_MSSQL_PASSWORD kolonlarından okunur.
  mssqlEnvPrefix: "W_MSSQL_",

  // Alkol distribütörü ama 9LE çarpanı Pernod'a özel. Wietnauer'da hacim
  // birimi farklı olabilir — kullanıcıyla teyit edilene kadar gizli tut.
  // Toggle gizli, sadece TL gösterilir.
  volume: {
    key: "9le",
    short: "70cl",
    longLabel: "Hacim (70cl eşdeğer)",
    hint: "Hacim = Σ(miktar × TBLURUN.DBLLITRE). DBLLITRE = kapasite_cl/70 (70cl→1, 75cl→1.071).",
    showInToggle: false, // Faz 2'de açılacak (birim toggle omurgası)
    divisor: 1, // DBLLITRE zaten 70cl-eşdeğeri → bölme yok (Pernod'da 9)
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

  // Wietnauer: bölge TBLDISTEKGRUP'ta (MARMARA/EGE/ANADOLU...) — Pernod'un
  // tersine. TBLDISTGRUP burada bayi grubudur.
  distRegionTable: "TBLDISTEKGRUP",
  distRegionColumn: "TXTEKGRUP",

  // Wietnauer perakende format bağı: müşteri-master doğrudan FK
  // (TBLMUSTERI.TXTEKGRUPKOD → TBLMUSTERIEKGRUP.TXTKOD). Eski "m2m" köprü
  // (TBLSBMUSTERIEKGRUPBAGLANTI) bu DB'de BOŞ → panel boş dönüyordu (md33).
  // Direct link 15.483 müşteri-grup satırı döndürür (TEKEL/BÜFE/MARKET/BAR…).
  customerEkGrupLink: "direct",

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
