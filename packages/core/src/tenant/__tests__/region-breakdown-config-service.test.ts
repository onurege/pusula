import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `region-breakdown-config-service.test.ts` — `customer-breakdown-config-
 * service.test.ts` ile AYNI kalıp/mock deseni; tek fark: ebeveyn tablo
 * `TBLDIST` (müşteri kırılımının `TBLMUSTERI`'si yerine).
 */
vi.mock("../../cache.js", () => ({ cachedClear: vi.fn() }));
vi.mock("../audit-log.js", () => ({ recordConfigAudit: vi.fn().mockResolvedValue(undefined) }));

import { cachedClear } from "../../cache.js";
import { recordConfigAudit } from "../audit-log.js";
import { clearTenantCache, getMappingConfig, getRegionBreakdownMeta, getTenantConfig } from "../index.js";
import { getMappingOverride } from "../mapping-store.js";
import {
  LiveSchemaValidationError,
  previewRegionBreakdownCandidate,
  resetRegionBreakdownOverride,
  saveRegionBreakdownOverride,
} from "../region-breakdown-config-service.js";
import type { RunReadOnlyFn } from "../schema-check.js";

type FakeSchema = { tables: Set<string>; columnTypes: Map<string, string> };

function makeFakeRun(
  schema: FakeSchema,
  matchRate: { total: number; matched: number } = { total: 100, matched: 90 },
): RunReadOnlyFn {
  return async (query: string) => {
    if (query.includes("FROM sys.tables")) {
      const table = query.match(/t\.name = N'([^']*)'/)?.[1] ?? "";
      return { rows: schema.tables.has(table) ? [{ x: 1 }] : [] };
    }
    if (query.includes("FROM sys.columns")) {
      const table = query.match(/t\.name = N'([^']*)'/)?.[1] ?? "";
      const column = query.match(/c\.name = N'([^']*)'/)?.[1] ?? "";
      const dataType = schema.columnTypes.get(`${table}.${column}`);
      return { rows: dataType ? [{ dataType }] : [] };
    }
    if (query.includes("SELECT TOP")) {
      return { rows: [{ val: "MARMARA" }] };
    }
    if (query.includes("SUM(CASE WHEN")) {
      return { rows: [{ total: matchRate.total, matched: matchRate.matched }] };
    }
    throw new Error(`beklenmeyen sorgu: ${query}`);
  };
}

/** `TBLDISTEKGRUP` ailesinin canlı DB'de TAM VAR olduğu senaryo. */
const LIVE_SCHEMA_OK: FakeSchema = {
  tables: new Set(["TBLDISTEKGRUP"]),
  columnTypes: new Map([
    ["TBLDIST.TXTEKGRUP", "varchar"],
    ["TBLDISTEKGRUP.TXTKOD", "varchar"],
    ["TBLDISTEKGRUP.TXTAD", "varchar"],
  ]),
};

const LIVE_SCHEMA_MISSING: FakeSchema = { tables: new Set(), columnTypes: new Map() };

// NOT: `TENANT_ID` bilerek "fmcg-demo" — `customer-breakdown-config-service.
// test.ts` (wietnauer) ve `product-breakdown-config-service.test.ts` (pernod)
// ile AYNI `data/tenant-config.<id>.enc.json` dosyasını PAYLAŞMAZ; vitest test
// dosyalarını paralel worker'larda çalıştırır — aynı fiziksel dosyaya
// eşzamanlı backup/restore/write yapan iki test dosyası birbirini ezer
// (gözlemlenen flake — bkz. Faz B QA notu). Her konfigüratör-servis testi
// KENDİ tenant id'sini kullanır.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const TENANT_ID = "fmcg-demo";
const OVERRIDE_FILE = path.join(REPO_ROOT, "data", `tenant-config.${TENANT_ID}.enc.json`);
const ALT_META = { table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" };

let preExistingBackup: string | null = null;

beforeAll(() => {
  preExistingBackup = fs.existsSync(OVERRIDE_FILE) ? fs.readFileSync(OVERRIDE_FILE, "utf8") : null;
  process.env.TENANT = TENANT_ID;
});

function restoreOverrideFile(): void {
  if (preExistingBackup !== null) {
    fs.writeFileSync(OVERRIDE_FILE, preExistingBackup, { encoding: "utf8", mode: 0o600 });
  } else {
    try {
      fs.unlinkSync(OVERRIDE_FILE);
    } catch {
      /* zaten yok */
    }
  }
  clearTenantCache();
}

beforeEach(() => {
  vi.mocked(cachedClear).mockClear();
  vi.mocked(recordConfigAudit).mockClear();
});
afterEach(restoreOverrideFile);
afterAll(restoreOverrideFile);

describe("saveRegionBreakdownOverride — (a) allowlist/şema doğrulaması", () => {
  it("allowlist DIŞI tablo, DB'ye HİÇ gitmeden reddedilir (fail-fast)", async () => {
    let dbCalled = false;
    const run: RunReadOnlyFn = async () => {
      dbCalled = true;
      return { rows: [] };
    };
    await expect(
      saveRegionBreakdownOverride({
        run,
        tenantId: TENANT_ID,
        actor: "test-admin",
        input: { table: "TBLKULLANICI", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" },
      }),
    ).rejects.toThrow(/allowlist/i);
    expect(dbCalled).toBe(false);
    expect(getMappingOverride(TENANT_ID)?.dimensions?.regionBreakdown).toBeUndefined();
    expect(cachedClear).not.toHaveBeenCalled();
    expect(recordConfigAudit).not.toHaveBeenCalled();
  });

  it("allowlist'te olan AMA canlı DB'de eksik bir tablo LiveSchemaValidationError ile reddedilir", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_MISSING);
    await expect(
      saveRegionBreakdownOverride({
        run,
        tenantId: TENANT_ID,
        actor: "test-admin",
        input: { table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" },
      }),
    ).rejects.toBeInstanceOf(LiveSchemaValidationError);
    expect(getMappingOverride(TENANT_ID)?.dimensions?.regionBreakdown).toBeUndefined();
    expect(cachedClear).not.toHaveBeenCalled();
    expect(recordConfigAudit).not.toHaveBeenCalled();
  });
});

describe("saveRegionBreakdownOverride — (b) geçerli alternatif → yaz + invalidate + audit", () => {
  it("setMappingOverride'ı ATOMİK yazar, cache'i SENKRON invalidate eder ve audit kaydeder", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK);
    await saveRegionBreakdownOverride({
      run,
      tenantId: TENANT_ID,
      actor: "test-admin",
      input: { table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" },
    });

    expect(getMappingOverride(TENANT_ID)?.dimensions?.regionBreakdown).toEqual(ALT_META);
    clearTenantCache();
    expect(getRegionBreakdownMeta()).toEqual(ALT_META);

    // 3 domain (REGION_BREAKDOWN_CACHE_DOMAINS) senkron invalidate edildi.
    expect(cachedClear).toHaveBeenCalledTimes(3);

    expect(recordConfigAudit).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(recordConfigAudit).mock.calls[0]![0];
    expect(auditCall).toMatchObject({
      tenantId: TENANT_ID,
      actor: "test-admin",
      action: "save",
      field: "dimensions.regionBreakdown",
      newValue: ALT_META,
    });
  });
});

describe("resetRegionBreakdownOverride — (c) default'a döner", () => {
  it("override yazıldıktan sonra reset default'a döner + invalidate + audit", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK);
    await saveRegionBreakdownOverride({
      run,
      tenantId: TENANT_ID,
      actor: "test-admin",
      input: { table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" },
    });
    clearTenantCache();

    vi.mocked(cachedClear).mockClear();
    vi.mocked(recordConfigAudit).mockClear();

    await resetRegionBreakdownOverride({ tenantId: TENANT_ID, actor: "test-admin" });

    expect(getMappingOverride(TENANT_ID)?.dimensions?.regionBreakdown).toBeUndefined();
    clearTenantCache();
    expect(getMappingConfig()).toEqual(getTenantConfig()); // sıfır regresyon
    expect(cachedClear).toHaveBeenCalledTimes(3);
    expect(recordConfigAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reset", field: "dimensions.regionBreakdown" }),
    );
  });
});

describe("previewRegionBreakdownCandidate — (d) match-rate + tip bayrağı", () => {
  it("canlı şema OK'ken örnek değer + doğru match-rate döner", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK, { total: 31, matched: 28 });
    const preview = await previewRegionBreakdownCandidate(run, {
      table: "TBLDISTEKGRUP",
      joinColumn: "TXTEKGRUP",
      labelColumn: "TXTAD",
    });
    expect(preview.live.typeMismatch).toBe(false);
    expect(preview.sampleValues).toEqual(["MARMARA"]);
    expect(preview.matchRate).toEqual({ total: 31, matched: 28, rate: 28 / 31 });
  });

  it("tablo canlı DB'de yoksa örnek/match-rate DENENMEZ (null döner)", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_MISSING);
    const preview = await previewRegionBreakdownCandidate(run, {
      table: "TBLDISTEKGRUP",
      joinColumn: "TXTEKGRUP",
      labelColumn: "TXTAD",
    });
    expect(preview.live.tableExists).toBe(false);
    expect(preview.sampleValues).toBeNull();
    expect(preview.matchRate).toBeNull();
  });

  it("allowlist dışı girdi preview'de de THROW eder", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK);
    await expect(
      previewRegionBreakdownCandidate(run, {
        table: "TBLKULLANICI; DROP TABLE X--",
        joinColumn: "TXTEKGRUP",
        labelColumn: "TXTAD",
      }),
    ).rejects.toThrow();
  });
});
