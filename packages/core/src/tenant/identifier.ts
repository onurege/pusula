/**
 * Merkezi SQL identifier doğrulayıcı — Insider konfigüratörünün tek güvenlik
 * sözleşme noktası (Faz 0 C1 CRITICAL, A1 HIGH).
 *
 * Bugün `brandTable`/`distRegionTable` gibi tenant-config alanları SQL'e
 * doğrudan interpolate ediliyor; güvenli çünkü değerler derleme-zamanı TS
 * union'ından geliyor (kullanıcı hiçbir zaman bu string'i seçemiyor).
 * Konfigüratör bu alanları runtime kullanıcı-girdisi yapınca aynı
 * interpolasyon `UNION SELECT TXTPASSWORD FROM TBLKULLANICI` tarzı bir
 * enjeksiyona açılır — `escSql` yalnız DEĞER kaçışı yapar, identifier
 * (tablo/kolon adı) parametrelenemez. Tek savunma: SQL'e ulaşmadan ÖNCE
 * regex + küratörlü allowlist ile doğrulamak.
 *
 * Bu modül o doğrulamayı TEK yerde toplar — `getBrandTableMeta()` (komuta.ts)
 * gibi her dosyada ayrı kopyalanan guard deseninin (Faz 0 A1 "shotgun
 * surgery") yerini alır. Faz A yalnız müşteri kırılımı boyutunu bu sözleşmeye
 * bağlar; dist/marka Faz B'de taşınır.
 *
 * NOT: Canlı şema doğrulaması (`sys.tables`/`sys.columns`'a karşı) Faz 0
 * güvenlik veto şartı #1'in TAM karşılığı — Dalga 2'de eklenecek (bu dalgada
 * yalnız statik allowlist + regex; endpoint henüz yok, override yazılamıyor).
 */

/** Bare SQL identifier — harf/rakam/alt-çizgi dışında hiçbir şey (köşeli
 *  parantez, nokta, boşluk, tırnak dahil) kabul edilmez. */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

/** Tüm Insider tabloları bu şemada yaşar — konfigüratörde şema seçilemez. */
export const SQL_SCHEMA = "dbo";

/**
 * `value`'yu regex + `allowlist` ile doğrular; ikisinden biri tutmazsa THROW
 * eder (fail-closed — sessiz varsayılana düşmek, curator'ın bir hatasını
 * gizler ve C1'in gerçek savunması burada bittiği için kabul edilemez).
 *
 * @param kind  Hata mesajında hangi alanın başarısız olduğunu gösterir
 *              (örn. "customerBreakdown.table") — audit/log'da izlenebilirlik.
 */
export function resolveIdentifier(
  value: string,
  allowlist: readonly string[],
  kind: string,
): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(
      `[identifier] Geçersiz ${kind}: "${value}" — yalnız harf/rakam/alt çizgi (^[A-Za-z0-9_]+$) kabul edilir.`,
    );
  }
  if (!allowlist.includes(value)) {
    throw new Error(
      `[identifier] Geçersiz ${kind}: "${value}" küratörlü allowlist dışında. İzinli değerler: ${allowlist.join(", ")}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Müşteri kırılımı boyutu — küratörlü allowlist
// ---------------------------------------------------------------------------
//
// Univera'da bu ailede bugün üç lookup tablosu kanıtlı kullanımda (bkz.
// komuta.ts, wietnauer-segment.ts, wietnauer-iskonto.ts):
// TBLMUSTERIGRUPKIRILIM (Prestige/Premium/…), TBLMUSTERIGRUP (OFF/ON TRADE)
// ve TBLMUSTERIEKGRUP (perakende format — Bakkal/Market/Tekel/…, "direct"
// link tenant'larında TBLMUSTERI.TXTEKGRUPKOD üzerinden). Üçü de aynı
// Univera kuralını izler: TXTKOD (PK) + TXTAD (ad) çifti. (Konfigüratörün
// küratörlü aday listesi — bkz. `customer-breakdown-candidates.ts`.)

export const CUSTOMER_BREAKDOWN_TABLES = [
  "TBLMUSTERIGRUPKIRILIM",
  "TBLMUSTERIGRUP",
  "TBLMUSTERIEKGRUP",
] as const;

export const CUSTOMER_BREAKDOWN_JOIN_COLUMNS = [
  "TXTGRUPKIRILIMKOD",
  "TXTGRUPKOD",
  "TXTEKGRUPKOD",
] as const;

export const CUSTOMER_BREAKDOWN_LABEL_COLUMNS = ["TXTAD"] as const;

export type CustomerBreakdownMeta = {
  table: string;
  joinColumn: string;
  labelColumn: string;
};

/**
 * Tenant config'inden gelen müşteri kırılımı boyutunu doğrular. Sonucu SQL'e
 * interpolate eden HER fetcher bu fonksiyondan geçmeli (bkz. `tenant/index.ts`
 * `getCustomerBreakdownMeta()`) — sink'e doğrulanmamış identifier ulaşmaz.
 */
export function resolveCustomerBreakdown(dim: {
  table: string;
  joinColumn: string;
  labelColumn: string;
}): CustomerBreakdownMeta {
  return {
    table: resolveIdentifier(dim.table, CUSTOMER_BREAKDOWN_TABLES, "customerBreakdown.table"),
    joinColumn: resolveIdentifier(
      dim.joinColumn,
      CUSTOMER_BREAKDOWN_JOIN_COLUMNS,
      "customerBreakdown.joinColumn",
    ),
    labelColumn: resolveIdentifier(
      dim.labelColumn,
      CUSTOMER_BREAKDOWN_LABEL_COLUMNS,
      "customerBreakdown.labelColumn",
    ),
  };
}

// ---------------------------------------------------------------------------
// Ürün/marka kırılımı boyutu — küratörlü allowlist (Faz B)
// ---------------------------------------------------------------------------
//
// Univera'da "marka" katmanı hangi tabloda yaşar tenant'a göre TERS kurulu
// (bkz. `tenant/types.ts` `brandTable`/`brandJoinColumn` dokümantasyonu):
// Pernod'da TBLURUNEKGRUP = marka, TBLURUNGRUP = kategori; Wietnauer'da tam
// tersi. Bugün komuta.ts + wietnauer-{marka,segment,aktivasyon,stok,metrics,
// iskonto}.ts'te (7 dosya, 14+ çağrı noktası) `tenant.brandTable` doğrudan
// SQL'e interpolate ediliyor — her dosya kendi kopyasında aynı
// `["TBLURUNEKGRUP","TBLURUNGRUP"].includes(...)` guard'ını tekrarlıyor
// (Faz 0 A1 "shotgun surgery"). Bu boyut o guard'ı TEK yerde toplar.

export const PRODUCT_BREAKDOWN_TABLES = ["TBLURUNEKGRUP", "TBLURUNGRUP"] as const;

export const PRODUCT_BREAKDOWN_JOIN_COLUMNS = ["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"] as const;

export const PRODUCT_BREAKDOWN_LABEL_COLUMNS = ["TXTAD"] as const;

export type ProductBreakdownMeta = {
  table: string;
  joinColumn: string;
  labelColumn: string;
};

/**
 * Tenant config'inden gelen ürün/marka kırılımı boyutunu doğrular. Sonucu
 * SQL'e interpolate eden HER fetcher bu fonksiyondan geçmeli (bkz.
 * `tenant/index.ts` `getProductBreakdownMeta()`) — sink'e doğrulanmamış
 * identifier ulaşmaz.
 */
export function resolveProductBreakdown(dim: {
  table: string;
  joinColumn: string;
  labelColumn: string;
}): ProductBreakdownMeta {
  return {
    table: resolveIdentifier(dim.table, PRODUCT_BREAKDOWN_TABLES, "productBreakdown.table"),
    joinColumn: resolveIdentifier(dim.joinColumn, PRODUCT_BREAKDOWN_JOIN_COLUMNS, "productBreakdown.joinColumn"),
    labelColumn: resolveIdentifier(dim.labelColumn, PRODUCT_BREAKDOWN_LABEL_COLUMNS, "productBreakdown.labelColumn"),
  };
}

// ---------------------------------------------------------------------------
// Bölge kırılımı boyutu — küratörlü allowlist (Faz B)
// ---------------------------------------------------------------------------
//
// TBLDIST üzerindeki bir FK kolonu (`joinColumn`) bir lookup tablosuna
// (`table`) bağlanır — yine TXTKOD (PK) + TXTAD (ad) Univera kuralı. Bugün
// komuta.ts + wietnauer-{saha,stok}.ts'te `tenant.distRegionTable ??
// "TBLDISTGRUP"` / `tenant.distRegionColumn ?? "TXTGRUP"` doğrudan SQL'e
// interpolate ediliyor (hiç guard'sız — bu allowlist Faz 0 C1'in bu boyut
// için ilk savunması).

export const REGION_BREAKDOWN_TABLES = ["TBLDISTGRUP", "TBLDISTEKGRUP"] as const;

export const REGION_BREAKDOWN_JOIN_COLUMNS = ["TXTGRUP", "TXTEKGRUP"] as const;

export const REGION_BREAKDOWN_LABEL_COLUMNS = ["TXTAD"] as const;

export type RegionBreakdownMeta = {
  table: string;
  joinColumn: string;
  labelColumn: string;
};

/**
 * Tenant config'inden gelen bölge kırılımı boyutunu doğrular. Sonucu SQL'e
 * interpolate eden HER fetcher bu fonksiyondan geçmeli (bkz. `tenant/index.ts`
 * `getRegionBreakdownMeta()`) — sink'e doğrulanmamış identifier ulaşmaz.
 */
export function resolveRegionBreakdown(dim: {
  table: string;
  joinColumn: string;
  labelColumn: string;
}): RegionBreakdownMeta {
  return {
    table: resolveIdentifier(dim.table, REGION_BREAKDOWN_TABLES, "regionBreakdown.table"),
    joinColumn: resolveIdentifier(dim.joinColumn, REGION_BREAKDOWN_JOIN_COLUMNS, "regionBreakdown.joinColumn"),
    labelColumn: resolveIdentifier(dim.labelColumn, REGION_BREAKDOWN_LABEL_COLUMNS, "regionBreakdown.labelColumn"),
  };
}
