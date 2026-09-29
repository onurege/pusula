import { afterEach, describe, expect, it } from "vitest";
import { WIETNAUER_CONFIG } from "../configs/wietnauer.js";
import { PERNOD_CONFIG } from "../configs/pernod.js";
import { FMCG_DEMO_CONFIG } from "../configs/fmcg-demo.js";
import {
  clearTenantCache,
  getMappingConfig,
  getProductBreakdownMeta,
  getRegionBreakdownMeta,
  getTenantConfig,
} from "../index.js";

/**
 * Davranış-koruma testi (Faz 0 DEĞİŞMEZ KURAL) — Faz B: config-driven ürün/
 * marka + bölge kırılımı boyutları, BUGÜNKÜ hardcoded `tenant.brandTable`/
 * `brandJoinColumn` ve `tenant.distRegionTable`/`distRegionColumn` (bkz.
 * `tenant/types.ts`, `tenant/configs/*.ts`) ile birebir aynı sonucu üretmeli
 * — sıfır regresyon. `customer-breakdown-defaults.test.ts` ile AYNI kalıp.
 */
const PERNOD_PRODUCT_DEFAULT = { table: "TBLURUNEKGRUP", joinColumn: "TXTURUNEKGRUPKOD", labelColumn: "TXTAD" };
const WIETNAUER_PRODUCT_DEFAULT = { table: "TBLURUNGRUP", joinColumn: "TXTURUNGRUPKOD", labelColumn: "TXTAD" };
const PERNOD_REGION_DEFAULT = { table: "TBLDISTGRUP", joinColumn: "TXTGRUP", labelColumn: "TXTAD" };
const WIETNAUER_REGION_DEFAULT = { table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" };

describe("varsayılan productBreakdown/regionBreakdown — eski hardcoded değerlerle birebir aynı", () => {
  afterEach(() => clearTenantCache());

  it("Pernod: dimensions.productBreakdown == eski brandTable/brandJoinColumn", () => {
    expect(PERNOD_CONFIG.dimensions.productBreakdown).toEqual(PERNOD_PRODUCT_DEFAULT);
    expect(PERNOD_CONFIG.brandTable).toBe(PERNOD_PRODUCT_DEFAULT.table);
    expect(PERNOD_CONFIG.brandJoinColumn).toBe(PERNOD_PRODUCT_DEFAULT.joinColumn);
  });

  it("Wietnauer: dimensions.productBreakdown == eski brandTable/brandJoinColumn (Pernod ile TERS aile)", () => {
    expect(WIETNAUER_CONFIG.dimensions.productBreakdown).toEqual(WIETNAUER_PRODUCT_DEFAULT);
    expect(WIETNAUER_CONFIG.brandTable).toBe(WIETNAUER_PRODUCT_DEFAULT.table);
    expect(WIETNAUER_CONFIG.brandJoinColumn).toBe(WIETNAUER_PRODUCT_DEFAULT.joinColumn);
  });

  it("FMCG demo: Pernod ile aynı katmanlama (dimensions.productBreakdown)", () => {
    expect(FMCG_DEMO_CONFIG.dimensions.productBreakdown).toEqual(PERNOD_PRODUCT_DEFAULT);
  });

  it("Pernod: dimensions.regionBreakdown == eski distRegionTable/distRegionColumn", () => {
    expect(PERNOD_CONFIG.dimensions.regionBreakdown).toEqual(PERNOD_REGION_DEFAULT);
    expect(PERNOD_CONFIG.distRegionTable).toBe(PERNOD_REGION_DEFAULT.table);
    expect(PERNOD_CONFIG.distRegionColumn).toBe(PERNOD_REGION_DEFAULT.joinColumn);
  });

  it("Wietnauer: dimensions.regionBreakdown == eski distRegionTable/distRegionColumn (Pernod ile TERS)", () => {
    expect(WIETNAUER_CONFIG.dimensions.regionBreakdown).toEqual(WIETNAUER_REGION_DEFAULT);
    expect(WIETNAUER_CONFIG.distRegionTable).toBe(WIETNAUER_REGION_DEFAULT.table);
    expect(WIETNAUER_CONFIG.distRegionColumn).toBe(WIETNAUER_REGION_DEFAULT.joinColumn);
  });

  it("FMCG demo: distRegionTable/Column tanımsızdı — sink fallback'inin (TBLDISTGRUP/TXTGRUP) BİREBİR aynısı", () => {
    expect(FMCG_DEMO_CONFIG.distRegionTable).toBeUndefined();
    expect(FMCG_DEMO_CONFIG.distRegionColumn).toBeUndefined();
    expect(FMCG_DEMO_CONFIG.dimensions.regionBreakdown).toEqual(PERNOD_REGION_DEFAULT);
  });

  it("override yokken getProductBreakdownMeta()/getRegionBreakdownMeta() doğrulanmış default'u döner (Wietnauer)", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    expect(getProductBreakdownMeta()).toEqual(WIETNAUER_PRODUCT_DEFAULT);
    expect(getRegionBreakdownMeta()).toEqual(WIETNAUER_REGION_DEFAULT);
  });

  it("override yokken getMappingConfig() == getTenantConfig() (davranış korunur, üç boyut da)", () => {
    process.env.TENANT = "pernod";
    clearTenantCache();
    expect(getMappingConfig()).toEqual(getTenantConfig());
  });
});
