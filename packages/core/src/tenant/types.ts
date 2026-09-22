/**
 * Tenant configuration — Insider codebase'i hangi müşteriye/sektöre özelleştir.
 *
 * Tek tipi N müşteriye satabilmek için ürün-özel string'ler, birimler ve
 * UI label'ları bu config'e konsolide edilir. Pernod default; FMCG demo
 * config'i Şölen/Nestle/Haribo gibi prospect sunumları için.
 *
 * Yeni müşteri eklemek = `configs/` altına yeni dosya + index.ts'te
 * import. Codebase değişmez.
 */

export type Industry = "alcohol" | "fmcg";

/**
 * Müşteri kırılımı boyutu — TBLMUSTERI üzerindeki bir lookup-kod kolonunu
 * (`joinColumn`) bir lookup tablosuna (`table`) bağlar; o tablonun okunabilir
 * adı `labelColumn`'da tutulur (Univera kuralı: lookup tabloları TXTKOD (PK) +
 * TXTAD (ad) çiftini taşır — bu ikisi arasındaki JOIN anahtarı sabit "TXTKOD",
 * config'e girmez).
 *
 * Örnek (Wietnauer default): TBLMUSTERI.TXTGRUPKIRILIMKOD →
 * TBLMUSTERIGRUPKIRILIM.TXTKOD, ad TBLMUSTERIGRUPKIRILIM.TXTAD.
 */
export type CustomerBreakdownDimension = {
  /** Lookup tablosu — `dbo.` şeması sabit, `resolveIdentifier()` doğrular. */
  table: string;
  /** TBLMUSTERI üzerindeki FK kolonu — lookup tablosunun TXTKOD'una bağlanır. */
  joinColumn: string;
  /** Lookup tablosunun okunabilir ad kolonu (genelde "TXTAD"). */
  labelColumn: string;
};

/**
 * Ürün/marka kırılımı boyutu — TBLURUN üzerindeki bir lookup-kod kolonunu
 * (`joinColumn`) bir lookup tablosuna (`table`) bağlar; Univera kuralı
 * (TXTKOD PK + TXTAD ad) burada da geçerli — bkz. `CustomerBreakdownDimension`
 * dokümantasyonu. Faz B öncesi bu değerler `TenantConfig.brandTable` /
 * `brandJoinColumn` alanlarında hardcoded union olarak yaşıyordu (aşağıda
 * hâlâ dururlar — default kaynağı ve geriye-uyum için); okuma yolu artık
 * buradan (config-driven boyut) geçer.
 *
 * Örnek (Pernod default): TBLURUN.TXTURUNEKGRUPKOD → TBLURUNEKGRUP.TXTKOD,
 * ad TBLURUNEKGRUP.TXTAD (Chivas Regal, Ballantine's, …).
 */
export type ProductBreakdownDimension = {
  table: string;
  joinColumn: string;
  labelColumn: string;
};

/**
 * Distribütör → bölge kırılımı boyutu — TBLDIST üzerindeki bir lookup-kod
 * kolonunu (`joinColumn`) bir lookup tablosuna (`table`) bağlar; aynı
 * Univera TXTKOD/TXTAD kuralı. Faz B öncesi `TenantConfig.distRegionTable` /
 * `distRegionColumn` alanlarında hardcoded union olarak yaşıyordu (aşağıda
 * hâlâ dururlar — default kaynağı ve geriye-uyum için).
 *
 * Örnek (Pernod default): TBLDIST.TXTGRUP → TBLDISTGRUP.TXTKOD, ad
 * TBLDISTGRUP.TXTAD (AKDENIZ, EGE, MARMARA, …).
 */
export type RegionBreakdownDimension = {
  table: string;
  joinColumn: string;
  labelColumn: string;
};

/** Config-driven boyutların tenant başına eşleme kümesi. */
export type TenantDimensions = {
  customerBreakdown: CustomerBreakdownDimension;
  productBreakdown: ProductBreakdownDimension;
  regionBreakdown: RegionBreakdownDimension;
};

/**
 * Hacim birimi — TL'nin yanında ikinci bir KPI birimi (TL ↔ X toggle).
 *
 * Alkol sektöründe `9LE` (9-Litre-Equivalent) standart birimdir — Pernod'un
 * resmi ürün katsayısı (TBLURUNEKSAHA saha 26) ile çarpılır. FMCG'de
 * genellikle ağırlık (kg) veya adet (koli/karton) kullanılır.
 *
 * `showInToggle: false` ise UI'da ikinci birim hiç gösterilmez (sadece TL).
 */
export type VolumeUnit = {
  /** URL query param value — `?unit=9le` ya da `?unit=kg`. */
  key: string;
  /** Header/KPI label — "9L" / "kg" / "ad". Sayının yanında küçük yazılır. */
  short: string;
  /** Tooltip uzun adı — "9-Litre-Equivalent" / "Kilogram" / "Adet". */
  longLabel: string;
  /** Toggle tooltip metni — kullanıcı "Bu birim ne anlama geliyor?" sorusu. */
  hint: string;
  /** false ise Komuta UnitToggle gizlenir (sadece TL gösterilir). */
  showInToggle: boolean;
  /**
   * Hacim böleni: `Hacim = Σ(DBLMIKTAR × DBLLITRE / divisor)`.
   * Pernod 9LE → 9. Wietnauer'da DBLLITRE zaten 70cl-eşdeğeri
   * (70cl→1, 75cl→1.071) olduğundan → 1. Verilmezse 9 varsayılır (geri uyum).
   */
  divisor?: number;
};

/**
 * Vergi toggle — TL'nin "OTV dahil/hariç" sürümleri arası geçiş.
 *
 * Alkol/tütünde ÖTV (Özel Tüketim Vergisi) ciroyu maskeler; "OTV net" toggle'ı
 * vergi-arındırılmış net ciroyu gösterir. FMCG'de sadece KDV var ve genelde
 * dashboard'da görmek istenmez → `showInToggle: false`.
 */
export type TaxToggle = {
  key: string;
  /** "OTV net" / "KDV hariç" / "" */
  label: string;
  showInToggle: boolean;
};

/**
 * UI label'ları — sektöre/müşteriye özel başlıklar ve metinler.
 */
export type TenantLabels = {
  /** V2 landing heading — "Bu Sabah {X}'da Ne Oluyor". */
  morningHeadline: string;
  /** Müşteri tipi paneli başlığı — "Pernod Müşteri Tipi" / "Müşteri Tipi". */
  channelTypeTitle: string;
  /** Müşteri tipi paneli source note. */
  channelTypeSource: string;
  /** Map sayfası ilk-kez senkron uyarısı — "PERNOD'dan müşteri listesini...". */
  mapEmptyDataSource: string;
  /** KPI strip source description. */
  kpiSourceNote: string;
  /** Hacim çarpanı tooltip metni (9LE veya FMCG karşılığı). */
  volumeMultiplierHint: string;
};

/**
 * Aynı Insider kurulumunda login'de seçilebilen bir veritabanı. Aynı Panorama
 * şeması, aynı sunucu/kimlik — yalnız bağlantının `database` adı değişir
 * (Panorama'nın "şirket" seçicisinin karşılığı, ör. Reckitt Core / ESSHOME).
 */
export type TenantDatabase = {
  /** URL/JWT-güvenli kısa kimlik. Doğrulama: `^[a-z0-9][a-z0-9-]{0,30}$`. */
  id: string;
  /** Login dropdown'ında görünen ad ("Reckitt Core"). */
  label: string;
  /** MSSQL database adı — bağlantının YALNIZ `database` alanını override eder. */
  database: string;
};

export type TenantConfig = {
  /** Tenant kimliği — env var ile seçilen değer, dosya adıyla eşleşir. */
  id: string;
  /** İsim sunumlarda görünür ("Pernod Ricard Türkiye"). */
  displayName: string;
  /** Endüstri — feature flag'ler bu alandan türeyebilir (örn. 9LE sadece alkol). */
  industry: Industry;
  /** Navbar köşesindeki 2-karakter logo — "EP" / "FM" / vb. */
  logoMark: string;
  /** Ürün adı — her zaman "Insider" ama tenant özelleştirmesi mümkün. */
  productName: string;

  // -- Veri kaynağı -----------------------------------------------------------

  /**
   * Bu tenant'a ait SQLite mirror dosyasının adı — `data/<sqliteFileName>`.
   * Tenant başına ayrı dosya olduğu için DB izolasyonu otomatik.
   */
  sqliteFileName: string;

  /**
   * MSSQL credential env var prefix'i — `<prefix>SERVER`, `<prefix>DATABASE`,
   * `<prefix>USER`, `<prefix>PASSWORD`, `<prefix>PORT`, `<prefix>ENCRYPT`,
   * `<prefix>TRUST_SERVER_CERT` okunur.
   *
   * Tanımsız bırakılırsa `"MSSQL_"` default (geriye uyumluluk — Pernod canlı
   * sistem). Wietnauer için `"W_MSSQL_"` — aynı Univera sunucusu, farklı DB.
   */
  mssqlEnvPrefix?: string;

  // -- Birim & vergi ----------------------------------------------------------

  volume: VolumeUnit;
  tax: TaxToggle;
  /** Para birimi sembolü — TR için "₺", ileride €/$ olabilir. */
  currencySymbol: string;

  // -- UI labels --------------------------------------------------------------

  labels: TenantLabels;

  // -- Marka kaynağı ----------------------------------------------------------

  /**
   * Tenant'ın "marka" katmanı hangi Univera tablosundan okunur. Univera
   * standart bir hiyerarşi tutmaz; her dağıtıcı kendi kurgusunu yapar:
   *   - Pernod: TBLURUNEKGRUP = marka (Chivas, Ballantine's), TBLURUNGRUP = kategori
   *   - Wietnauer: TBLURUNGRUP = marka (JAGERMEISTER, BELUGA), TBLURUNEKGRUP = kategori
   *
   * `brandTable` o tenant'ta marka isimlerini taşıyan tablo;
   * `brandJoinColumn` TBLURUN üzerinde o tabloya bağlanan FK sütunu.
   */
  brandTable: "TBLURUNEKGRUP" | "TBLURUNGRUP";
  brandJoinColumn: "TXTURUNEKGRUPKOD" | "TXTURUNGRUPKOD";

  /**
   * Distribütör → coğrafi bölge eşlemesi (komuta heatmap satırları). Univera'da
   * bu hiyerarşi tenant'a göre TERS kurulu:
   *   - Pernod:    TBLDISTGRUP (TXTGRUP)   = bölge   · TBLDISTEKGRUP = dist tipi
   *   - Wietnauer: TBLDISTEKGRUP (TXTEKGRUP) = bölge · TBLDISTGRUP  = bayi grubu
   * Tanımsızsa TBLDISTGRUP/TXTGRUP (Pernod default).
   */
  distRegionTable?: "TBLDISTGRUP" | "TBLDISTEKGRUP";
  distRegionColumn?: "TXTGRUP" | "TXTEKGRUP";

  /**
   * Müşteri → perakende format (ekGrup) bağı. Pernod'da doğrudan FK
   * (TBLMUSTERI.TXTEKGRUPKOD → TBLMUSTERIEKGRUP.TXTKOD); Wietnauer m2m köprü
   * (TBLSBMUSTERIEKGRUPBAGLANTI). Tanımsızsa "direct" (Pernod default).
   */
  customerEkGrupLink?: "direct" | "m2m";

  /**
   * Tenant'ın stratejik takip ettiği marka adları (`brandTable`.TXTAD ile
   * birebir eşleşir, case-insensitive). Wietnauer dashboards'unda özel zoom
   * panelleri bu liste üzerinden render edilir.
   */
  strategicBrands?: string[];

  /**
   * Login'de seçilebilen veritabanları (aynı şema/sunucu/kimlik, farklı
   * `database`). Tanımsız veya tek eleman → login'de seçici çıkmaz ve tüm
   * sorgular bugünkü tek-DB yolunu izler (regresyon-sıfır). Birden çok eleman →
   * login dropdown'ı + istek-bazlı DB yönlendirmesi (bkz. `request-context.ts`,
   * `resolveDatabaseName`). İlk eleman varsayılan sayılır (bağlam olmayan
   * warm/job yolları onu kullanır).
   */
  databases?: TenantDatabase[];

  // -- Config-driven boyutlar (Insider konfigüratör) --------------------------

  /**
   * Alan → tablo/kolon eşlemeleri — Insider konfigüratörünün admin panelden
   * kodsuz özelleştirebileceği boyutlar. Faz A yalnız `customerBreakdown`
   * taşıyordu; Faz B `productBreakdown` (bugünkü `brandTable`/
   * `brandJoinColumn`) ve `regionBreakdown`'ı (bugünkü `distRegionTable`/
   * `distRegionColumn`) ekledi. `brandTable`/`distRegionTable` alanları
   * yukarıda hâlâ dururlar (default DEĞER kaynağı + geriye-uyum) ama SQL'e
   * giden okuma yolu artık `tenant/index.ts` `getProductBreakdownMeta()` /
   * `getRegionBreakdownMeta()` üzerinden bu `dimensions` alanına gider —
   * böylece admin panel override'ı bu iki boyutta da çalışır.
   *
   * SQL'e interpolate edilmeden önce burada tutulan değerler DAİMA
   * `resolveIdentifier()`'dan (bkz. `tenant/identifier.ts`) geçmeli — regex
   * `^[A-Za-z0-9_]+$` + küratörlü allowlist. Bu, `distRegionTable` gibi
   * doğrulamasız-interpolasyon geçmişindeki hatayı (Faz 0 C1) tekrar etmemek
   * için zorunlu.
   *
   * Runtime override (`getMappingConfig()`, `tenant/index.ts`) bu default'un
   * ÜSTÜNE biner — şifreli dosya store'dan (`tenant/mapping-store.ts`) okunur.
   */
  dimensions: TenantDimensions;

  // -- UI davranışı (tenant-özel arayüz kısıtları) ----------------------------

  /**
   * Arayüz davranış flag'leri. Tanımsız bırakılırsa tüm sürümler/tema açık
   * (varsayılan çok-kiracılı davranış — Pernod böyle kalır). Tek-sürüm ürünler
   * (ör. Wietnauer sadece V3) için burada kısıtlanır.
   */
  ui?: {
    /**
     * Login sonrası ve kök `/` için varsayılan iniş yolu (ör. "/v3").
     * Tanımsızsa `/` mevcut V1 ana ekranını gösterir.
     */
    defaultLanding?: string;
    /** V1/V2/V3 sürüm geçiş butonunu gizle — kullanıcı tek sürümde kalır. */
    hideVersionToggle?: boolean;
    /** Dark mode'u kapat: tema "light"e sabitlenir, tema butonu gizlenir. */
    forceLightTheme?: boolean;
    /** Navbar'dan gizlenecek nav href'leri (ör. demo'da /reports, /schema). */
    hiddenNavHrefs?: string[];
    /**
     * Navbar logo rozeti için görsel yolu (public/ altında, ör.
     * "/brand/univera-symbol-white.svg"). Tanımlıysa `logoMark` metni yerine
     * bu görsel gösterilir. Tanımsızsa `logoMark` harfleri gösterilir.
     */
    logoSrc?: string;
  };

  /**
   * Sentetik/demo verili tenant (MSSQL'e bağlanmaz). `true` ise:
   *   - Kimlik doğrulama MSSQL yerine statik demo kullanıcısıyla yapılır
   *     (env DEMO_LOGIN_USER/DEMO_LOGIN_PASSWORD).
   *   - Komuta night-refresh + force-refresh devre dışı (MSSQL yok, veri
   *     pre-baked cache'te; refresh boş snapshot üretip seed'i ezerdi).
   *
   * Yalnızca sentetik verili tenant'ta `true`. Gerçek verili tenant'lar
   * (Pernod, Wietnauer) bu flag'i almaz → normal MSSQL auth + refresh.
   */
  demoData?: boolean;
};
