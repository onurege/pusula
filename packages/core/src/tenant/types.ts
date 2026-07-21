/**
 * Tenant configuration — Pusula codebase'i hangi müşteriye/sektöre özelleştir.
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

export type TenantConfig = {
  /** Tenant kimliği — env var ile seçilen değer, dosya adıyla eşleşir. */
  id: string;
  /** İsim sunumlarda görünür ("Pernod Ricard Türkiye"). */
  displayName: string;
  /** Endüstri — feature flag'ler bu alandan türeyebilir (örn. 9LE sadece alkol). */
  industry: Industry;
  /** Navbar köşesindeki 2-karakter logo — "EP" / "FM" / vb. */
  logoMark: string;
  /** Ürün adı — her zaman "Enroute Pusula" ama tenant özelleştirmesi mümkün. */
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
   * Tenant'ın stratejik takip ettiği marka adları (`brandTable`.TXTAD ile
   * birebir eşleşir, case-insensitive). Wietnauer dashboards'unda özel zoom
   * panelleri bu liste üzerinden render edilir.
   */
  strategicBrands?: string[];

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
