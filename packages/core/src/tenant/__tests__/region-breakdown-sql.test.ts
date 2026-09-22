import { describe, expect, it } from "vitest";
import { regionBreakdownCodeExpr, regionBreakdownJoin, regionBreakdownLabelExpr } from "../region-breakdown-sql.js";
import { PERNOD_CONFIG } from "../configs/pernod.js";
import { WIETNAUER_CONFIG } from "../configs/wietnauer.js";

/**
 * `regionBreakdownJoin`/`Label`/`Code` — sink'lerin (komuta.ts fetchHeatmap,
 * wietnauer-saha.ts fetchDistributorComparison, wietnauer-stok.ts
 * fetchStockRows) GERÇEKTEN çağırdığı üreticiler. DAVRANIŞ KORUNUR: her
 * sink'in KENDİ alias çiftiyle üretilen metin, refactor ÖNCESİ hardcoded
 * literal'le KARAKTER BAZINDA aynıdır.
 */
const PERNOD_META = PERNOD_CONFIG.dimensions.regionBreakdown; // TBLDISTGRUP / TXTGRUP
const WIETNAUER_META = WIETNAUER_CONFIG.dimensions.regionBreakdown; // TBLDISTEKGRUP / TXTEKGRUP

describe("regionBreakdownJoin", () => {
  it("komuta.ts fetchHeatmap dist_grup CTE ile birebir eşleşir (d→dg, INNER)", () => {
    expect(regionBreakdownJoin(PERNOD_META, "d", "dg", "INNER")).toBe(
      "INNER JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = d.TXTGRUP",
    );
  });

  it("wietnauer-saha.ts fetchDistributorComparison ile birebir eşleşir (d→g, LEFT)", () => {
    expect(regionBreakdownJoin(WIETNAUER_META, "d", "g", "LEFT")).toBe(
      "LEFT JOIN dbo.TBLDISTEKGRUP g ON g.TXTKOD = d.TXTEKGRUP",
    );
  });

  it("wietnauer-stok.ts fetchStockRows ile birebir eşleşir (dst→dg, LEFT)", () => {
    expect(regionBreakdownJoin(PERNOD_META, "dst", "dg", "LEFT")).toBe(
      "LEFT JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = dst.TXTGRUP",
    );
  });
});

describe("regionBreakdownLabelExpr / regionBreakdownCodeExpr", () => {
  it("bölge adı ifadesi (`dg.TXTAD AS bolge`) ile birebir eşleşir", () => {
    expect(regionBreakdownLabelExpr(PERNOD_META, "dg", "bolge")).toBe("dg.TXTAD AS bolge");
  });

  it("bölge kodu ifadesi (`dg.TXTKOD AS bolgeKod`) ile birebir eşleşir", () => {
    expect(regionBreakdownCodeExpr("dg", "bolgeKod")).toBe("dg.TXTKOD AS bolgeKod");
  });
});
