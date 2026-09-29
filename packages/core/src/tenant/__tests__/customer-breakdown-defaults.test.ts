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
 *
 * FAZ A EK-SAHA GÜNCELLEMESİ (brief madde 3): Wietnauer'ın default
 * `customerBreakdown`'ı bu dalgada TEK-HOP'tan İKİ-HOP'a (`mode:
 * "eksaha-two-hop"`) geçti — artık `EXPECTED_DEFAULT` (tek-hop literal) ile
 * EŞLEŞMEZ, bu KASITLI bir davranış değişikliği (bkz. `configs/wietnauer.ts`
 * satır ~102 yorumu). Tek-hop baseline/geri-uyum kanıtı artık `PERNOD_CONFIG`
 * üzerinden yapılır (Pernod hâlâ tek-hop) — `EXPECTED_DEFAULT` de oradan
 * TÜRETİLİR (elle kopyalanmış bir literal değil). Wietnauer'ın YENİ
 * davranışı ayrıca `WIETNAUER_EKSAHA_DEFAULT` ile (doğrudan config'ten,
 * totolojik olmayan bağımsız `mode`/negatif eşitlik kontrolüyle) doğrulanır.
 */
const EXPECTED_DEFAULT = PERNOD_CONFIG.dimensions.customerBreakdown;
const WIETNAUER_EKSAHA_DEFAULT = WIETNAUER_CONFIG.dimensions.customerBreakdown;

describe("varsayılan customerBreakdown — tek-hop geri-uyum (Pernod) + Wietnauer iki-hop geçişi", () => {
  afterEach(() => clearTenantCache());

  it("Pernod config default'u eski hardcoded değerle eşleşir (tek-hop, geri-uyum kanıtı)", () => {
    expect(PERNOD_CONFIG.dimensions.customerBreakdown).toEqual(EXPECTED_DEFAULT);
    expect(EXPECTED_DEFAULT).toEqual({
      table: "TBLMUSTERIGRUPKIRILIM",
      joinColumn: "TXTGRUPKIRILIMKOD",
      labelColumn: "TXTAD",
    });
  });

  it("Wietnauer config default'u ARTIK tek-hop DEĞİL — iki-hop ek-saha kırılımı (Faz A brief madde 3)", () => {
    expect(WIETNAUER_EKSAHA_DEFAULT.mode).toBe("eksaha-two-hop");
    expect(WIETNAUER_EKSAHA_DEFAULT).not.toEqual(EXPECTED_DEFAULT);
  });

  it("override yokken getMappingConfig() == getTenantConfig() (davranış korunur, Pernod tek-hop)", () => {
    process.env.TENANT = "pernod";
    clearTenantCache();
    expect(getMappingConfig()).toEqual(getTenantConfig());
  });

  it("override yokken getCustomerBreakdownMeta() Pernod için doğrulanmış tek-hop default'u döner", () => {
    process.env.TENANT = "pernod";
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).toEqual(EXPECTED_DEFAULT);
  });

  it("override yokken getMappingConfig() == getTenantConfig() (davranış korunur, Wietnauer iki-hop)", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    expect(getMappingConfig()).toEqual(getTenantConfig());
  });

  it("override yokken getCustomerBreakdownMeta() Wietnauer için doğrulanmış iki-hop default'u döner", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).toEqual(WIETNAUER_EKSAHA_DEFAULT);
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
