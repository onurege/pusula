import { describe, expect, it } from "vitest";
import {
  productBreakdownCodeExpr,
  productBreakdownJoin,
  productBreakdownLabelExpr,
  productBreakdownTableSql,
} from "../product-breakdown-sql.js";
import { PERNOD_CONFIG } from "../configs/pernod.js";
import { WIETNAUER_CONFIG } from "../configs/wietnauer.js";

/**
 * `productBreakdownJoin`/`Label`/`Code`/`TableSql` — sink'lerin (komuta.ts,
 * wietnauer-{marka,segment,aktivasyon,stok,metrics,iskonto}.ts) GERÇEKTEN
 * çağırdığı üreticiler. DAVRANIŞ KORUNUR: varsayılan alias'larla (`u`/`b`)
 * üretilen metin, refactor ÖNCESİ hardcoded `INNER JOIN dbo.${brandTable} b
 * ON b.TXTKOD = u.${joinCol}` template literal'iyle KARAKTER BAZINDA aynıdır.
 */
const PERNOD_META = PERNOD_CONFIG.dimensions.productBreakdown; // TBLURUNEKGRUP / TXTURUNEKGRUPKOD
const WIETNAUER_META = WIETNAUER_CONFIG.dimensions.productBreakdown; // TBLURUNGRUP / TXTURUNGRUPKOD

describe("productBreakdownJoin — komuta.ts/wietnauer-*.ts ortak marka JOIN'i", () => {
  it("Pernod default'uyla refactor-öncesi hardcoded JOIN ile birebir eşleşir (varsayılan alias u/b, INNER)", () => {
    expect(productBreakdownJoin(PERNOD_META)).toBe("INNER JOIN dbo.TBLURUNEKGRUP b ON b.TXTKOD = u.TXTURUNEKGRUPKOD");
  });

  it("Wietnauer default'uyla (TERS aile) da doğru tablo/kolonu üretir", () => {
    expect(productBreakdownJoin(WIETNAUER_META)).toBe(
      "INNER JOIN dbo.TBLURUNGRUP b ON b.TXTKOD = u.TXTURUNGRUPKOD",
    );
  });

  it("wietnauer-stok.ts fetchStockRows LEFT JOIN varyantını üretir", () => {
    expect(productBreakdownJoin(PERNOD_META, { joinType: "LEFT" })).toBe(
      "LEFT JOIN dbo.TBLURUNEKGRUP b ON b.TXTKOD = u.TXTURUNEKGRUPKOD",
    );
  });
});

describe("productBreakdownLabelExpr / productBreakdownCodeExpr", () => {
  it("marka adı ifadesi (`b.TXTAD AS marka`) ile birebir eşleşir", () => {
    expect(productBreakdownLabelExpr(PERNOD_META, "marka")).toBe("b.TXTAD AS marka");
  });

  it("marka kodu ifadesi (`b.TXTKOD AS marka_kod`) ile birebir eşleşir", () => {
    expect(productBreakdownCodeExpr("marka_kod")).toBe("b.TXTKOD AS marka_kod");
  });
});

describe("productBreakdownTableSql — wietnauer-aktivasyon.ts `strat` CTE FROM'u", () => {
  it("`dbo.<table>` üretir (JOIN'siz standalone kullanım)", () => {
    expect(productBreakdownTableSql(WIETNAUER_META)).toBe("dbo.TBLURUNGRUP");
  });
});
