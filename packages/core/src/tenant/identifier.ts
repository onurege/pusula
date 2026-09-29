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

/**
 * Ek-saha köprü tablosu (`TBLMUSTERIEKSAHA`) — `mode: "eksaha-two-hop"`'un
 * TEK tanınan köprüsü. Curator yeni bir köprü eklemek isterse önce bu listeye
 * eklemeli (aksi halde `resolveCustomerBreakdown` THROW eder — fail-closed).
 */
export const EKSAHA_BRIDGE_TABLES = ["TBLMUSTERIEKSAHA"] as const;
export const EKSAHA_BRIDGE_MUSTERI_REF_COLUMNS = ["LNGMUSTERIREF"] as const;
export const EKSAHA_BRIDGE_SAHA_COLUMNS = ["LNGEKSAHAKODU"] as const;
export const EKSAHA_BRIDGE_CODE_COLUMNS = ["TXTEKSAHAACIKLAMA"] as const;

/** Ek-saha lookup tablosu (`TBLEKSAHASECENEK`) — saha kodu → okunabilir ad. */
export const EKSAHA_LOOKUP_TABLES = ["TBLEKSAHASECENEK"] as const;
export const EKSAHA_LOOKUP_SAHA_COLUMNS = ["LNGTAKIPKOD"] as const;
export const EKSAHA_LOOKUP_KEY_COLUMNS = ["LNGKOD"] as const;
export const EKSAHA_LABEL_COLUMNS = ["TXTACIKLAMA"] as const;

/**
 * Müşteri kırılımı boyutu — iki mod:
 *   - TEK-HOP (mode yok veya `"single-hop"`): bugünkü davranış, `TBLMUSTERI`
 *     üzerindeki bir FK kolonunu tek bir lookup tablosuna bağlar (Pernod,
 *     fmcg-demo — GERİ UYUM ŞART, bu union'ın varsayılan dalı).
 *   - İKİ-HOP (`mode: "eksaha-two-hop"`): Wietnauer ek-saha birleşik kırılımı
 *     — `TBLMUSTERI` → `TBLMUSTERIEKSAHA` (köprü, iki saha kodu) →
 *     `TBLEKSAHASECENEK` (lookup); COALESCE(saha1, saha2, "(Tanımsız)") ile
 *     tek bir etikete indirgenir (bkz. `customer-breakdown-sql.ts`).
 */
export type CustomerBreakdownMeta =
  | {
      mode?: "single-hop";
      table: string;
      joinColumn: string;
      labelColumn: string;
    }
  | {
      mode: "eksaha-two-hop";
      /** [saha1, saha2] — TAM İKİ tam sayı (ör. [1,2] = OFF-TRADE/ON-TRADE). */
      sahaKods: number[];
      bridgeTable: string;
      bridgeMusteriRef: string;
      bridgeSahaCol: string;
      bridgeCodeCol: string;
      lookupTable: string;
      lookupSahaCol: string;
      lookupKeyCol: string;
      labelColumn: string;
    };

/**
 * `sahaKods`'u doğrular: tam olarak 2 elemanlı, ikisi de `Number.isInteger`
 * bir dizi olmalı — iki-hop SQL üreticileri (`customer-breakdown-sql.ts`)
 * dizinin TAM bu şekilde `sahaKods[0]`/`sahaKods[1]` (saha1/saha2) olduğunu
 * varsayar. Uymazsa THROW (fail-closed) — regex/allowlist'in sayısal
 * eşdeğeri, C1 sözleşmesinin bir parçası.
 */
function resolveSahaKods(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => Number.isInteger(v))) {
    throw new Error(
      `[identifier] Geçersiz customerBreakdown.sahaKods: "${JSON.stringify(value)}" — tam sayı içeren 2 elemanlı ([saha1, saha2]) bir dizi olmalı.`,
    );
  }
  return value as number[];
}

/** Tek-hop üyesi — `resolveCustomerBreakdown` overload'larının dar dönüş tipi. */
export type SingleHopCustomerBreakdownMeta = Extract<CustomerBreakdownMeta, { mode?: "single-hop" }>;
/** İki-hop üyesi — `resolveCustomerBreakdown` overload'larının dar dönüş tipi. */
export type EksahaTwoHopCustomerBreakdownMeta = Extract<CustomerBreakdownMeta, { mode: "eksaha-two-hop" }>;

/**
 * Tenant config'inden gelen müşteri kırılımı boyutunu doğrular. Sonucu SQL'e
 * interpolate eden HER fetcher bu fonksiyondan geçmeli (bkz. `tenant/index.ts`
 * `getCustomerBreakdownMeta()`) — sink'e doğrulanmamış identifier ulaşmaz.
 *
 * Mode-branch: `mode` yok/`"single-hop"` bugünkü tek-hop allowlist'ten
 * geçer (Pernod/fmcg-demo — GERİ UYUM ŞART); `"eksaha-two-hop"` yeni köprü+
 * lookup allowlist'inden. Geçersiz bir override (regex/allowlist DIŞI, ya da
 * eksik/bozuk `sahaKods`) THROW eder — fail-closed (C1).
 *
 * 3 overload: girdi tek-hop/iki-hop literal'iyse dönüş tipi o üyeye DARALIR
 * (çağıran `.table`/`.bridgeTable` gibi alanlara narrowing YAPMADAN erişebilir
 * — mevcut çağıranların davranışı DEĞİŞMEDEN korunur); girdi zaten genel
 * `CustomerBreakdownMeta` union'ıysa (ör. `mapping-store.ts` runtime override
 * geçişi) dönüş de union kalır.
 */
export function resolveCustomerBreakdown(dim: SingleHopCustomerBreakdownMeta): SingleHopCustomerBreakdownMeta;
export function resolveCustomerBreakdown(dim: EksahaTwoHopCustomerBreakdownMeta): EksahaTwoHopCustomerBreakdownMeta;
export function resolveCustomerBreakdown(dim: CustomerBreakdownMeta): CustomerBreakdownMeta;
export function resolveCustomerBreakdown(dim: CustomerBreakdownMeta): CustomerBreakdownMeta {
  if (dim.mode === "eksaha-two-hop") {
    return {
      mode: "eksaha-two-hop",
      sahaKods: resolveSahaKods(dim.sahaKods),
      bridgeTable: resolveIdentifier(dim.bridgeTable, EKSAHA_BRIDGE_TABLES, "customerBreakdown.bridgeTable"),
      bridgeMusteriRef: resolveIdentifier(
        dim.bridgeMusteriRef,
        EKSAHA_BRIDGE_MUSTERI_REF_COLUMNS,
        "customerBreakdown.bridgeMusteriRef",
      ),
      bridgeSahaCol: resolveIdentifier(
        dim.bridgeSahaCol,
        EKSAHA_BRIDGE_SAHA_COLUMNS,
        "customerBreakdown.bridgeSahaCol",
      ),
      bridgeCodeCol: resolveIdentifier(
        dim.bridgeCodeCol,
        EKSAHA_BRIDGE_CODE_COLUMNS,
        "customerBreakdown.bridgeCodeCol",
      ),
      lookupTable: resolveIdentifier(dim.lookupTable, EKSAHA_LOOKUP_TABLES, "customerBreakdown.lookupTable"),
      lookupSahaCol: resolveIdentifier(
        dim.lookupSahaCol,
        EKSAHA_LOOKUP_SAHA_COLUMNS,
        "customerBreakdown.lookupSahaCol",
      ),
      lookupKeyCol: resolveIdentifier(dim.lookupKeyCol, EKSAHA_LOOKUP_KEY_COLUMNS, "customerBreakdown.lookupKeyCol"),
      labelColumn: resolveIdentifier(dim.labelColumn, EKSAHA_LABEL_COLUMNS, "customerBreakdown.labelColumn"),
    };
  }
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
