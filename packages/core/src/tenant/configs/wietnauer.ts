import type { TenantConfig } from "../types";

/**
 * Wietnauer Türkiye — Pernod gibi Univera ERP'sini kullanan alkol/içecek
 * dağıtıcısı. Pernod'dan ayrı bir DB (`WEITNAUER_TEST`) üzerinde çalışır;
 * şema aynı Univera ama veri tamamen farklı.
 *
 * Stratejik markaları (Jagermeister, Edrington, Beluga vb.) Insider'a
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
  productName: "Insider",

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

  // Alkol distribütörü, hacim birimi 70cl-eşdeğer (9LE DEĞİL — Pernod'a özel
  // çarpan). Faz 2'de kullanıcıyla teyit edildi: toggle açık, TL↔hacim geçişi
  // Cockpit/Satış/Yönetim panellerinde kullanılabilir.
  volume: {
    key: "9le",
    short: "70cl",
    longLabel: "Hacim (70cl eşdeğer)",
    hint: "Hacim = Σ(miktar × TBLURUN.DBLLITRE). DBLLITRE = kapasite_cl/70 (70cl→1, 75cl→1.071).",
    showInToggle: true, // Faz 2'de açıldı (birim toggle omurgası — brief madde 3)
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
    channelTypeTitle: "Müşteri Kırılımı",
    channelTypeSource:
      "Müşteri kırılımı: birleşik ek saha (TBLMUSTERIEKSAHA Saha 1+2 → TBLEKSAHASECENEK lookup, COALESCE). OFF/ON-TRADE segmentleri + (Tanımsız).",
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

  // Birleşik ek-saha müşteri kırılımı (brief madde 0/1 — Faz A Dalga 2):
  // TBLMUSTERI → TBLMUSTERIEKSAHA (köprü, LNGMUSTERIREF) → TBLEKSAHASECENEK
  // (lookup, LNGKOD = TRY_CONVERT(int, köprünün TXTEKSAHAACIKLAMA'sı)).
  // sahaKods: [1,2] — Saha1=OFF-TRADE SEGMENTASYON (11.605 müşteri),
  // Saha2=ON-TRADE SEGMENTASYON (2.705); COALESCE(saha1, saha2, "(Tanımsız)").
  // DB doğrulandı: 10 grup, 15.017 aktif müşteride %95 kapsam, ilk iki grup
  // "WHITE OUTLET" ailesi %88.3. Eski tek-hop TBLMUSTERIGRUPKIRILIM default'u
  // (Prestige/Premium/…) bu birleşik kırılımın YERİNİ alır — Cockpit/Yönetim/
  // Segment ekranları artık bunu kullanır (bkz. `customer-breakdown-sql.ts`).
  dimensions: {
    customerBreakdown: {
      mode: "eksaha-two-hop",
      sahaKods: [1, 2],
      bridgeTable: "TBLMUSTERIEKSAHA",
      bridgeMusteriRef: "LNGMUSTERIREF",
      bridgeSahaCol: "LNGEKSAHAKODU",
      bridgeCodeCol: "TXTEKSAHAACIKLAMA",
      lookupTable: "TBLEKSAHASECENEK",
      lookupSahaCol: "LNGTAKIPKOD",
      lookupKeyCol: "LNGKOD",
      labelColumn: "TXTACIKLAMA",
    },
    // Faz B — `brandTable`/`brandJoinColumn` (yukarıda) ile BİREBİR aynı
    // değerler; SQL'e giden okuma yolu artık buradan (config-driven boyut).
    productBreakdown: {
      table: "TBLURUNGRUP",
      joinColumn: "TXTURUNGRUPKOD",
      labelColumn: "TXTAD",
    },
    // Faz B — `distRegionTable`/`distRegionColumn` (yukarıda) ile BİREBİR
    // aynı değerler.
    regionBreakdown: {
      table: "TBLDISTEKGRUP",
      joinColumn: "TXTEKGRUP",
      labelColumn: "TXTAD",
    },
  },

  // Aktivasyon-risk (brief madde 13): gün/ciro tabanlı "composite" model
  // TERK edildi — 2-sinyal "visit-order" (ziyaret var/yok + sipariş var/yok).
  // HESAPLAMA `map.ts` `classifyRiskTier`'da yapılır (başka bir ajan/dalga);
  // burada yalnız kullanıcı-konfigüre varsayılanlar tanımlanır: öncelik
  // ziyarette (ONAYLI varsayılan — kullanıcı "order"a çevirebilir), risk
  // sayılan tier'lar kırmızı+turuncu (ziyaret yok+sipariş yok / ziyaret
  // yok+sipariş var) — sarı/yeşil risk sayılmaz. Pencere seçili döneme bağlı,
  // burada sabitlenmez.
  riskModel: "visit-order",
  riskConfig: {
    priority: "visit",
    riskTiers: ["red", "orange"],
  },
};
