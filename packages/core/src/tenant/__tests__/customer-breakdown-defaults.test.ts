import { afterEach, describe, expect, it } from "vitest";
import { WIETNAUER_CONFIG } from "../configs/wietnauer.js";
import { PERNOD_CONFIG } from "../configs/pernod.js";
import { clearTenantCache, getCustomerBreakdownMeta, getMappingConfig, getTenantConfig } from "../index.js";

/**
 * Davranış-koruma testi (Faz 0 DEĞİŞMEZ KURAL): config-driven müşteri kırılımı
 * boyutu, BUGÜNKÜ hardcoded `TBLMUSTERIGRUPKIRILIM` / `TXTGRUPKIRILIMKOD` /
 * `TXTAD` eşlemesiyle birebir aynı sonucu üretmeli — sıfır regresyon.
 *
 * Bu değerler komuta.ts / wietnauer-*.ts'te Faz A öncesi doğrudan SQL'e
 * yazılıydı (md34); artık `tenant/configs/*.ts`'ten okunuyor. Test, o
 * göçün hiçbir tenant'ta değer kaydırmadığını kanıtlar.
 */
const EXPECTED_DEFAULT = {
  table: "TBLMUSTERIGRUPKIRILIM",
  joinColumn: "TXTGRUPKIRILIMKOD",
  labelColumn: "TXTAD",
};

describe("varsayılan customerBreakdown — eski hardcoded değerlerle birebir aynı", () => {
  afterEach(() => clearTenantCache());

  it("Wietnauer config default'u eski hardcoded değerle eşleşir", () => {
    expect(WIETNAUER_CONFIG.dimensions.customerBreakdown).toEqual(EXPECTED_DEFAULT);
  });

  it("Pernod config default'u da aynı (komuta.ts tenant-bağımsız hardcoded'du)", () => {
    expect(PERNOD_CONFIG.dimensions.customerBreakdown).toEqual(EXPECTED_DEFAULT);
  });

  it("override yokken getMappingConfig() == getTenantConfig() (davranış korunur)", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    expect(getMappingConfig()).toEqual(getTenantConfig());
  });

  it("override yokken getCustomerBreakdownMeta() doğrulanmış default'u döner", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).toEqual(EXPECTED_DEFAULT);
  });
});

// NOT (QA veto fix — Faz A Dalga 1): burada daha önce bir "SQL fragment
// smoke test" vardı — `EXPECTED_DEFAULT` sabitinden İKİ string türetip
// birbirine eşitliyordu, `komuta.ts`/`wietnauer-*.ts`'teki GERÇEK sink
// kodunu hiç ÇAĞIRMIYORDU (totolojik, 0/8 gerçek kapsam). Yerini
// `tenant/__tests__/customer-breakdown-sql.test.ts` aldı: o dosya artık
// sink'lerin KENDİLERİNİN çağırdığı `customerBreakdownJoin` /
// `customerBreakdownLabelExpr` / `customerBreakdownCodeExpr` /
// `customerBreakdownFacetSql` / `customerBreakdownFilterClause`
// (`tenant/customer-breakdown-sql.ts`) fonksiyonlarını doğrudan test eder —
// 8 sink çağrı noktasının hepsi bu paylaşılan üreticilerden geçer.
