import { describe, expect, it } from "vitest";
import {
  CUSTOMER_BREAKDOWN_JOIN_COLUMNS,
  CUSTOMER_BREAKDOWN_LABEL_COLUMNS,
  CUSTOMER_BREAKDOWN_TABLES,
  PRODUCT_BREAKDOWN_JOIN_COLUMNS,
  PRODUCT_BREAKDOWN_LABEL_COLUMNS,
  PRODUCT_BREAKDOWN_TABLES,
  REGION_BREAKDOWN_JOIN_COLUMNS,
  REGION_BREAKDOWN_LABEL_COLUMNS,
  REGION_BREAKDOWN_TABLES,
  resolveCustomerBreakdown,
  resolveIdentifier,
  resolveProductBreakdown,
  resolveRegionBreakdown,
} from "../identifier.js";

/**
 * Faz 0 C1 CRITICAL — identifier SQL injection savunması.
 *
 * `resolveIdentifier` konfigüratörün tek güvenlik sözleşme noktası: SQL'e
 * interpolate edilen HER tablo/kolon adı buradan geçmeli. Bu testler o
 * sözleşmenin (a) geçerli değerleri kabul ettiğini, (b) enjeksiyon
 * denemelerini SQL'e ulaşmadan reddettiğini kanıtlar.
 */
describe("resolveIdentifier", () => {
  it("küratörlü allowlist'teki geçerli bir değeri aynen döner", () => {
    expect(resolveIdentifier("TBLMUSTERIGRUPKIRILIM", CUSTOMER_BREAKDOWN_TABLES, "table")).toBe(
      "TBLMUSTERIGRUPKIRILIM",
    );
  });

  it("UNION SELECT tabanlı enjeksiyon payload'ını THROW eder", () => {
    const payload = "TXTGRUP; UNION SELECT TXTPASSWORD FROM TBLKULLANICI--";
    expect(() => resolveIdentifier(payload, CUSTOMER_BREAKDOWN_JOIN_COLUMNS, "joinColumn")).toThrow();
  });

  it("regex'i geçse bile allowlist dışındaki değeri THROW eder (küratörsüz tablo adı)", () => {
    // Format geçerli (yalnız harf) ama curator listesinde YOK — allowlist
    // katmanı regex'ten bağımsız çalışmalı.
    expect(() => resolveIdentifier("TBLKULLANICI", CUSTOMER_BREAKDOWN_TABLES, "table")).toThrow();
  });

  it("özel karakter içeren identifier'ı (köşeli parantez kaçışı denemesi) THROW eder", () => {
    expect(() => resolveIdentifier("TBLMUSTERIGRUPKIRILIM]; DROP TABLE X --", CUSTOMER_BREAKDOWN_TABLES, "table")).toThrow();
  });

  it("boşluk/yorum-satırı içeren identifier'ı THROW eder", () => {
    expect(() => resolveIdentifier("TBLMUSTERIGRUPKIRILIM -- ", CUSTOMER_BREAKDOWN_TABLES, "table")).toThrow();
  });
});

describe("resolveCustomerBreakdown", () => {
  it("geçerli varsayılan (Wietnauer/Pernod default) boyutu doğrulanmış olarak döner", () => {
    const meta = resolveCustomerBreakdown({
      table: "TBLMUSTERIGRUPKIRILIM",
      joinColumn: "TXTGRUPKIRILIMKOD",
      labelColumn: "TXTAD",
    });
    expect(meta).toEqual({
      table: "TBLMUSTERIGRUPKIRILIM",
      joinColumn: "TXTGRUPKIRILIMKOD",
      labelColumn: "TXTAD",
    });
  });

  it("küratörlü alternatif (TBLMUSTERIGRUP ailesi) de geçer", () => {
    const meta = resolveCustomerBreakdown({
      table: "TBLMUSTERIGRUP",
      joinColumn: "TXTGRUPKOD",
      labelColumn: "TXTAD",
    });
    expect(meta.table).toBe("TBLMUSTERIGRUP");
  });

  it("herhangi bir alanı allowlist dışıysa TÜM boyutu THROW eder — kısmi geçiş yok", () => {
    expect(() =>
      resolveCustomerBreakdown({
        table: "TBLMUSTERIGRUPKIRILIM",
        joinColumn: "TXTGRUP; UNION SELECT TXTPASSWORD FROM TBLKULLANICI--",
        labelColumn: "TXTAD",
      }),
    ).toThrow();
  });

  it("labelColumn allowlist dışıysa THROW eder", () => {
    expect(() =>
      resolveCustomerBreakdown({
        table: "TBLMUSTERIGRUPKIRILIM",
        joinColumn: "TXTGRUPKIRILIMKOD",
        labelColumn: "TXTPASSWORD",
      }),
    ).toThrow();
  });

  it("CUSTOMER_BREAKDOWN_LABEL_COLUMNS bugün yalnız TXTAD içerir (Univera kuralı)", () => {
    expect(CUSTOMER_BREAKDOWN_LABEL_COLUMNS).toEqual(["TXTAD"]);
  });
});

/**
 * Faz B — ürün/marka kırılımı boyutu. Bugün `komuta.ts`/`wietnauer-{marka,
 * segment,aktivasyon,stok,metrics,iskonto}.ts`'in SQL'e interpolate ettiği
 * `tenant.brandTable`/`brandJoinColumn` çiftinin AYNI C1 güvenlik sözleşmesi.
 */
describe("resolveProductBreakdown", () => {
  it("Pernod default'unu (TBLURUNEKGRUP ailesi) doğrulanmış olarak döner", () => {
    const meta = resolveProductBreakdown({
      table: "TBLURUNEKGRUP",
      joinColumn: "TXTURUNEKGRUPKOD",
      labelColumn: "TXTAD",
    });
    expect(meta).toEqual({ table: "TBLURUNEKGRUP", joinColumn: "TXTURUNEKGRUPKOD", labelColumn: "TXTAD" });
  });

  it("Wietnauer default'unu (TBLURUNGRUP ailesi — Pernod ile TERS) da doğrular", () => {
    const meta = resolveProductBreakdown({
      table: "TBLURUNGRUP",
      joinColumn: "TXTURUNGRUPKOD",
      labelColumn: "TXTAD",
    });
    expect(meta.table).toBe("TBLURUNGRUP");
  });

  it("UNION SELECT tabanlı enjeksiyon payload'ını THROW eder", () => {
    expect(() =>
      resolveProductBreakdown({
        table: "TBLURUNEKGRUP",
        joinColumn: "TXTURUNEKGRUPKOD; UNION SELECT TXTPASSWORD FROM TBLKULLANICI--",
        labelColumn: "TXTAD",
      }),
    ).toThrow();
  });

  it("regex'i geçse bile allowlist dışındaki tabloyu THROW eder", () => {
    expect(() =>
      resolveProductBreakdown({ table: "TBLKULLANICI", joinColumn: "TXTURUNEKGRUPKOD", labelColumn: "TXTAD" }),
    ).toThrow(/allowlist/i);
  });

  it("PRODUCT_BREAKDOWN_TABLES/JOIN_COLUMNS/LABEL_COLUMNS bugünkü küratörlü çiftlerle eşleşir", () => {
    expect(PRODUCT_BREAKDOWN_TABLES).toEqual(["TBLURUNEKGRUP", "TBLURUNGRUP"]);
    expect(PRODUCT_BREAKDOWN_JOIN_COLUMNS).toEqual(["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"]);
    expect(PRODUCT_BREAKDOWN_LABEL_COLUMNS).toEqual(["TXTAD"]);
  });
});

/**
 * Faz B — bölge kırılımı boyutu. Bugün `komuta.ts`/`wietnauer-{saha,stok}.ts`'in
 * SQL'e interpolate ettiği `tenant.distRegionTable`/`distRegionColumn` çiftinin
 * AYNI C1 güvenlik sözleşmesi.
 */
describe("resolveRegionBreakdown", () => {
  it("Pernod default'unu (TBLDISTGRUP ailesi) doğrulanmış olarak döner", () => {
    const meta = resolveRegionBreakdown({ table: "TBLDISTGRUP", joinColumn: "TXTGRUP", labelColumn: "TXTAD" });
    expect(meta).toEqual({ table: "TBLDISTGRUP", joinColumn: "TXTGRUP", labelColumn: "TXTAD" });
  });

  it("Wietnauer default'unu (TBLDISTEKGRUP ailesi — Pernod ile TERS) da doğrular", () => {
    const meta = resolveRegionBreakdown({ table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" });
    expect(meta.table).toBe("TBLDISTEKGRUP");
  });

  it("çapraz-aile (yanlış table/joinColumn eşleşmesi) allowlist'i geçse de kabul edilir — eşleşme kontrolü match-rate'in işi", () => {
    // resolveRegionBreakdown yalnız HER ALANIN kendi allowlist'inde olduğunu
    // doğrular, table↔joinColumn'un "doğru" tenant çiftini oluşturduğunu
    // DEĞİL (bu, canlı şema/match-rate katmanının sorumluluğu — bkz.
    // `schema-check.ts` `computeMatchRate`).
    expect(() =>
      resolveRegionBreakdown({ table: "TBLDISTGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" }),
    ).not.toThrow();
  });

  it("UNION SELECT tabanlı enjeksiyon payload'ını THROW eder", () => {
    expect(() =>
      resolveRegionBreakdown({
        table: "TXTGRUP; UNION SELECT TXTPASSWORD FROM TBLKULLANICI--",
        joinColumn: "TXTGRUP",
        labelColumn: "TXTAD",
      }),
    ).toThrow();
  });

  it("regex'i geçse bile allowlist dışındaki tabloyu THROW eder", () => {
    expect(() =>
      resolveRegionBreakdown({ table: "TBLKULLANICI", joinColumn: "TXTGRUP", labelColumn: "TXTAD" }),
    ).toThrow(/allowlist/i);
  });

  it("REGION_BREAKDOWN_TABLES/JOIN_COLUMNS/LABEL_COLUMNS bugünkü küratörlü çiftlerle eşleşir", () => {
    expect(REGION_BREAKDOWN_TABLES).toEqual(["TBLDISTGRUP", "TBLDISTEKGRUP"]);
    expect(REGION_BREAKDOWN_JOIN_COLUMNS).toEqual(["TXTGRUP", "TXTEKGRUP"]);
    expect(REGION_BREAKDOWN_LABEL_COLUMNS).toEqual(["TXTAD"]);
  });
});
