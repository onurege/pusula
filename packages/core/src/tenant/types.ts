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

  // -- Birim & vergi ----------------------------------------------------------

  volume: VolumeUnit;
  tax: TaxToggle;
  /** Para birimi sembolü — TR için "₺", ileride €/$ olabilir. */
  currencySymbol: string;

  // -- UI labels --------------------------------------------------------------

  labels: TenantLabels;
};
