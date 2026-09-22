import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTenantFromDefinition,
  clearTenantCache,
  getTenantConfig,
  isTenantFullyMissing,
  resolveActiveTenantId,
} from "../index.js";
import { saveTenantDefinition, type TenantDefinition } from "../tenant-definition-store.js";
import { WIETNAUER_CONFIG } from "../configs/wietnauer.js";

/**
 * Faz A Dalga 1 — additive fallback (`getTenantConfig()`, `tenant/index.ts`)
 * + `buildTenantFromDefinition` Panorama-default türetmesi.
 *
 * Bu dosya `process.env.TENANT`'ı mutasyona uğratır — vitest her test
 * dosyasını izole bir worker'da çalıştırır (`vitest.config.ts` default
 * `isolate: true`), bu yüzden diğer test dosyalarını ETKİLEMEZ (aynı deseni
 * `mapping-override-e2e.test.ts` zaten kullanıyor).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FIXTURE_TENANT = "vitest-panorama-acme";
const FIXTURE_FILE = path.join(REPO_ROOT, "data", `tenant-def.${FIXTURE_TENANT}.json`);

const ORIGINAL_TENANT_ENV = process.env.TENANT;

function restoreTenantEnv(): void {
  // `process.env.X = undefined` JS'te "undefined" STRING'ine coerce olur —
  // orijinal değer tanımsızsa `delete` kullanmak zorunludur (aksi halde bir
  // sonraki test `TENANT="undefined"` görür, sessiz bir test-kirliliği).
  if (ORIGINAL_TENANT_ENV === undefined) delete process.env.TENANT;
  else process.env.TENANT = ORIGINAL_TENANT_ENV;
}

function cleanupFixtureFile(): void {
  try {
    fs.unlinkSync(FIXTURE_FILE);
  } catch {
    /* zaten yok */
  }
}

afterEach(() => {
  cleanupFixtureFile();
  restoreTenantEnv();
  clearTenantCache();
});

function makeDef(overrides: Partial<TenantDefinition> = {}): TenantDefinition {
  return {
    id: FIXTURE_TENANT,
    displayName: "Acme Panorama",
    industry: "fmcg",
    strategicBrands: ["Acme Cola"],
    labels: {
      morningHeadline: "Bu Sabah Acme'de Ne Oluyor",
      channelTypeTitle: "Müşteri Tipi",
      channelTypeSource: "kaynak",
      mapEmptyDataSource: "boş",
      kpiSourceNote: "not",
      volumeMultiplierHint: "hint",
    },
    tax: { key: "kdv", label: "KDV hariç", showInToggle: false },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("getTenantConfig() — additive fallback (Faz 0 tasarım kararı)", () => {
  it("REGISTRY-hit (wietnauer): store'a HİÇ bakmadan REGISTRY config'i referans-eşit döner — blast-radius sıfır", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    expect(getTenantConfig()).toBe(WIETNAUER_CONFIG);
  });

  it("TENANT boş/tanımsızken hâlâ Pernod default'a döner (mevcut davranış BİREBİR korunur)", () => {
    delete process.env.TENANT;
    clearTenantCache();
    expect(getTenantConfig().id).toBe("pernod");
  });

  it("REGISTRY-miss + tenant-definition store'da tanım VAR: buildTenantFromDefinition çıktısı döner", async () => {
    await saveTenantDefinition(makeDef());
    process.env.TENANT = FIXTURE_TENANT;
    clearTenantCache();
    const config = getTenantConfig();
    expect(config.id).toBe(FIXTURE_TENANT);
    expect(config.displayName).toBe("Acme Panorama");
    expect(config.productName).toBe("Insider");
  });

  it("REGISTRY-miss + store'da da YOK: THROW eder (Pernod-default'a sessizce düşmez — Faz 0 şart #6)", () => {
    process.env.TENANT = "vitest-hic-yok-boyle-bir-tenant";
    clearTenantCache();
    expect(() => getTenantConfig()).toThrow(/Bilinmeyen TENANT/);
  });
});

describe("buildTenantFromDefinition — Panorama-default türetme", () => {
  it("productName/currencySymbol/ui wietnauer.ts ile BİREBİR aynı (Faz 0 'wietnauer-eş' kararı)", () => {
    const config = buildTenantFromDefinition(makeDef());
    expect(config.productName).toBe(WIETNAUER_CONFIG.productName);
    expect(config.currencySymbol).toBe(WIETNAUER_CONFIG.currencySymbol);
    expect(config.ui).toEqual(WIETNAUER_CONFIG.ui);
  });

  it("sqliteFileName / mssqlEnvPrefix id'den türetilir (tire → alt çizgi)", () => {
    const config = buildTenantFromDefinition(makeDef());
    expect(config.sqliteFileName).toBe(`${FIXTURE_TENANT}.sqlite`);
    expect(config.mssqlEnvPrefix).toBe("VITEST_PANORAMA_ACME_MSSQL_");
  });

  it("logoMark verilmezse id'nin ilk 2 harfi (büyük) olur; verilirse override edilir", () => {
    expect(buildTenantFromDefinition(makeDef()).logoMark).toBe("VI");
    expect(buildTenantFromDefinition(makeDef({ logoMark: "AC" })).logoMark).toBe("AC");
  });

  it("labels/tax/strategicBrands/industry/displayName girdiden AYNEN geçer", () => {
    const def = makeDef();
    const config = buildTenantFromDefinition(def);
    expect(config.labels).toEqual(def.labels);
    expect(config.tax).toEqual(def.tax);
    expect(config.strategicBrands).toEqual(def.strategicBrands);
    expect(config.industry).toBe(def.industry);
    expect(config.displayName).toBe(def.displayName);
  });

  it("dimensions/brandTable/distRegionTable curator-allowlist'in İÇİNDE kalan Pernod-konvansiyonuna varsayılanlanır", () => {
    const config = buildTenantFromDefinition(makeDef());
    expect(config.brandTable).toBe("TBLURUNEKGRUP");
    expect(config.brandJoinColumn).toBe("TXTURUNEKGRUPKOD");
    expect(config.distRegionTable).toBe("TBLDISTGRUP");
    expect(config.dimensions.customerBreakdown).toEqual({
      table: "TBLMUSTERIGRUPKIRILIM",
      joinColumn: "TXTGRUPKIRILIMKOD",
      labelColumn: "TXTAD",
    });
  });

  it("volume toggle kapalı (Faz 0 'volume kapalı' kararı) — divisor 1", () => {
    const config = buildTenantFromDefinition(makeDef());
    expect(config.volume.showInToggle).toBe(false);
    expect(config.volume.divisor).toBe(1);
  });
});

describe("resolveActiveTenantId — THROW ETMEZ (getTenantConfig()'in aksine)", () => {
  it("TENANT boş/tanımsızken 'pernod' döner (getTenantConfig() ile AYNI default)", () => {
    delete process.env.TENANT;
    expect(resolveActiveTenantId()).toBe("pernod");
  });

  it("TENANT ayarlıyken (REGISTRY'de olsun olmasın) aynen o id'yi döner — store/REGISTRY'e bakmaz", () => {
    process.env.TENANT = "vitest-hic-yok-boyle-bir-tenant";
    expect(resolveActiveTenantId()).toBe("vitest-hic-yok-boyle-bir-tenant");
  });

  it("baştaki/sondaki boşluğu kırpar", () => {
    process.env.TENANT = "  wietnauer  ";
    expect(resolveActiveTenantId()).toBe("wietnauer");
  });
});

describe("isTenantFullyMissing — boot-çökme önleme kontrolü (setup modu bunu kullanır)", () => {
  it("REGISTRY-yönetimli tenant (wietnauer) için false (getTenantConfig() zaten throw etmez)", () => {
    process.env.TENANT = "wietnauer";
    expect(isTenantFullyMissing()).toBe(false);
  });

  it("REGISTRY-miss + store'da da YOK için true — TAM OLARAK getTenantConfig()'in throw ettiği durum", () => {
    process.env.TENANT = "vitest-hic-yok-boyle-bir-tenant";
    expect(isTenantFullyMissing()).toBe(true);
    expect(() => getTenantConfig()).toThrow(/Bilinmeyen TENANT/);
  });

  it("REGISTRY-miss + store'da tanım VARSA false (getTenantConfig() başarıyla döner)", async () => {
    await saveTenantDefinition(makeDef());
    process.env.TENANT = FIXTURE_TENANT;
    expect(isTenantFullyMissing()).toBe(false);
    expect(() => getTenantConfig()).not.toThrow();
  });

  it("kendisi ASLA throw etmez (fonksiyonun bütün amacı budur — guard olarak kullanılabilmesi)", () => {
    process.env.TENANT = "../../etc/passwd"; // geçersiz id — assertValidTenantId normalde throw eder
    expect(() => isTenantFullyMissing()).not.toThrow();
    expect(isTenantFullyMissing()).toBe(true);
  });
});
