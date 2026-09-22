import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `../audit-log.js` mock'lanır — `customer-breakdown-config-service.test.ts`
 * ile AYNI desen: audit yazımının GERÇEKTEN çağrıldığını/doğru alanlarla
 * çağrıldığını gözlemlemek için, gerçek `data/config-audit.log`'a
 * dokunmadan.
 */
vi.mock("../audit-log.js", () => ({ recordConfigAudit: vi.fn().mockResolvedValue(undefined) }));

import { recordConfigAudit } from "../audit-log.js";
import { clearTenantCache, getTenantConfig } from "../index.js";
import { getTenantDefinition, type TenantDefinitionInput } from "../tenant-definition-store.js";
import {
  getActiveTenantDefinitionMeta,
  isActiveTenantId,
  resetTenantDefinitionOverride,
  saveTenantDefinitionOverride,
  TenantValidationError,
  validateTenantDefinitionInput,
} from "../tenant-config-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FIXTURE_TENANT = "vitest-onboard-acme";
const FIXTURE_FILE = path.join(REPO_ROOT, "data", `tenant-def.${FIXTURE_TENANT}.json`);

const ORIGINAL_TENANT_ENV = process.env.TENANT;

function restoreTenantEnv(): void {
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
  vi.clearAllMocks();
});

function makeValidInput(overrides: Partial<TenantDefinitionInput> = {}): TenantDefinitionInput {
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
    ...overrides,
  };
}

describe("validateTenantDefinitionInput", () => {
  it("geçerli girdiyi aynen döner (throw etmez)", () => {
    const input = makeValidInput();
    expect(validateTenantDefinitionInput(input)).toBe(input);
  });

  it("REGISTRY'de zaten kayıtlı id (\"wietnauer\") için THROW eder — ölü yazım önlenir", () => {
    expect(() => validateTenantDefinitionInput(makeValidInput({ id: "wietnauer" }))).toThrow(TenantValidationError);
  });

  it("geçersiz (path-traversal) id için THROW eder", () => {
    expect(() => validateTenantDefinitionInput(makeValidInput({ id: "../../etc/passwd" }))).toThrow(
      TenantValidationError,
    );
  });

  it("boş displayName için THROW eder", () => {
    expect(() => validateTenantDefinitionInput(makeValidInput({ displayName: "" }))).toThrow(TenantValidationError);
  });

  it("geçersiz industry için THROW eder", () => {
    expect(() =>
      validateTenantDefinitionInput(makeValidInput({ industry: "tobacco" as never })),
    ).toThrow(TenantValidationError);
  });

  it("boş strategicBrands dizisi için THROW eder", () => {
    expect(() => validateTenantDefinitionInput(makeValidInput({ strategicBrands: [] }))).toThrow(
      TenantValidationError,
    );
  });

  it("eksik labels alanı için THROW eder (tüm 6 alan zorunlu)", () => {
    const input = makeValidInput();
    const badLabels = { ...input.labels, morningHeadline: "" };
    expect(() => validateTenantDefinitionInput({ ...input, labels: badLabels })).toThrow(TenantValidationError);
  });

  it("birden fazla sorunu TEK hatada toplar (issues dizisi > 1)", () => {
    try {
      validateTenantDefinitionInput(makeValidInput({ displayName: "", strategicBrands: [] }));
      throw new Error("beklenen throw gerçekleşmedi");
    } catch (err) {
      expect(err).toBeInstanceOf(TenantValidationError);
      expect((err as TenantValidationError).issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("saveTenantDefinitionOverride (doğrula → yaz → clearTenantCache → audit)", () => {
  it("geçerli girdiyi diske yazar + buildTenantFromDefinition çıktısını döner", async () => {
    const config = await saveTenantDefinitionOverride({ actor: "vitest-admin", input: makeValidInput() });
    expect(config.id).toBe(FIXTURE_TENANT);
    expect(config.productName).toBe("Insider");
    expect(getTenantDefinition(FIXTURE_TENANT)?.displayName).toBe("Acme Panorama");
  });

  it("ilk yazımda audit action \"create-tenant\"; ikinci (var olan tanımın üstüne) yazımda \"update-tenant\"", async () => {
    await saveTenantDefinitionOverride({ actor: "vitest-admin", input: makeValidInput() });
    expect(recordConfigAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId: FIXTURE_TENANT, action: "create-tenant", field: "tenant-definition" }),
    );

    await saveTenantDefinitionOverride({
      actor: "vitest-admin",
      input: makeValidInput({ displayName: "Acme Panorama v2" }),
    });
    expect(recordConfigAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId: FIXTURE_TENANT, action: "update-tenant", field: "tenant-definition" }),
    );
  });

  it("geçersiz girdi (REGISTRY id çakışması) DİSKE YAZILMADAN reddedilir — audit ÇAĞRILMAZ", async () => {
    await expect(
      saveTenantDefinitionOverride({ actor: "vitest-admin", input: makeValidInput({ id: "pernod" }) }),
    ).rejects.toThrow(TenantValidationError);
    expect(recordConfigAudit).not.toHaveBeenCalled();
    // "pernod" REGISTRY id'si zaten dosya sistemi ile ilişkili değil ama
    // fixture dosyamız da hiç yazılmamış olmalı:
    expect(fs.existsSync(FIXTURE_FILE)).toBe(false);
  });

  it("geçersiz girdi (boş displayName) DİSKE YAZILMADAN reddedilir", async () => {
    await expect(
      saveTenantDefinitionOverride({ actor: "vitest-admin", input: makeValidInput({ displayName: "" }) }),
    ).rejects.toThrow(TenantValidationError);
    expect(fs.existsSync(FIXTURE_FILE)).toBe(false);
    expect(recordConfigAudit).not.toHaveBeenCalled();
  });

  it("kaydettikten sonra TENANT bu id'ye çevrilirse getTenantConfig() taze tanımı görür (clearTenantCache çalıştı)", async () => {
    await saveTenantDefinitionOverride({ actor: "vitest-admin", input: makeValidInput() });
    process.env.TENANT = FIXTURE_TENANT;
    clearTenantCache();
    expect(getTenantConfig().displayName).toBe("Acme Panorama");
  });
});

describe("resetTenantDefinitionOverride", () => {
  it("var olan tanımı kaldırır + audit action \"reset\" yazar", async () => {
    await saveTenantDefinitionOverride({ actor: "vitest-admin", input: makeValidInput() });
    await resetTenantDefinitionOverride({ id: FIXTURE_TENANT, actor: "vitest-admin" });
    expect(getTenantDefinition(FIXTURE_TENANT)).toBeNull();
    expect(recordConfigAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId: FIXTURE_TENANT, action: "reset", field: "tenant-definition" }),
    );
  });

  it("geçersiz id için THROW eder, audit ÇAĞRILMAZ", async () => {
    await expect(
      resetTenantDefinitionOverride({ id: "../../etc/passwd", actor: "vitest-admin" }),
    ).rejects.toThrow();
    expect(recordConfigAudit).not.toHaveBeenCalled();
  });
});

describe("isActiveTenantId — Security LOW sertleştirme (aktif tenant DIŞINDA id yazımı kapatılır)", () => {
  it("aktif tenant'ın (pernod, TENANT boş) id'siyle eşleşirse true", () => {
    delete process.env.TENANT;
    clearTenantCache();
    expect(isActiveTenantId("pernod")).toBe(true);
  });

  it("aktif tenant'tan FARKLI bir id için false", () => {
    delete process.env.TENANT;
    clearTenantCache();
    expect(isActiveTenantId("wietnauer")).toBe(false);
  });

  it("aktif tenant değişince (wietnauer) sonuç da değişir — canlı karşılaştırma, cache'lenmez", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    expect(isActiveTenantId("wietnauer")).toBe(true);
    expect(isActiveTenantId("pernod")).toBe(false);
  });
});

describe("getActiveTenantDefinitionMeta (server-otoriter — parametresiz, daima getTenantConfig().id)", () => {
  it("REGISTRY-yönetimli aktif tenant (wietnauer) için registryManaged=true, definition/config null", () => {
    process.env.TENANT = "wietnauer";
    clearTenantCache();
    const meta = getActiveTenantDefinitionMeta();
    expect(meta).toEqual({ tenantId: "wietnauer", registryManaged: true, definition: null, config: null });
  });

  it("store-yönetimli aktif tenant için definition/config dolu döner", async () => {
    await saveTenantDefinitionOverride({ actor: "vitest-admin", input: makeValidInput() });
    process.env.TENANT = FIXTURE_TENANT;
    clearTenantCache();
    const meta = getActiveTenantDefinitionMeta();
    expect(meta.registryManaged).toBe(false);
    expect(meta.definition?.id).toBe(FIXTURE_TENANT);
    expect(meta.config?.productName).toBe("Insider");
  });
});
