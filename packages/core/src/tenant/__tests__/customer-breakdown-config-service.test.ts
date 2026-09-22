import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `../../cache.js` mock'lanır (invalidation'ın GERÇEKTEN tetiklendiğini
 * gözlemlemek için — bkz. `cache-invalidation.test.ts`'teki AYNI desen) ve
 * `../audit-log.js` mock'lanır (audit yazımının GERÇEKTEN çağrıldığını ve
 * doğru alanlarla çağrıldığını doğrulamak için — gerçek `data/config-audit.log`
 * dosyasına test sırasında yazmamak amacıyla; audit-log.ts'in kendi
 * append/read davranışı ayrı bir testte (`audit-log.test.ts`) doğrulanır).
 */
vi.mock("../../cache.js", () => ({ cachedClear: vi.fn() }));
vi.mock("../audit-log.js", () => ({ recordConfigAudit: vi.fn().mockResolvedValue(undefined) }));

import { cachedClear } from "../../cache.js";
import { recordConfigAudit } from "../audit-log.js";
import { clearTenantCache, getCustomerBreakdownMeta, getMappingConfig, getTenantConfig } from "../index.js";
import { getMappingOverride } from "../mapping-store.js";
import {
  LiveSchemaValidationError,
  previewCustomerBreakdownCandidate,
  resetCustomerBreakdownOverride,
  saveCustomerBreakdownOverride,
} from "../customer-breakdown-config-service.js";
import type { RunReadOnlyFn } from "../schema-check.js";

// ---------------------------------------------------------------------------
// Sahte MSSQL — GERÇEK bağlantı yok (bkz. schema-check.test.ts'teki AYNI desen).
// ---------------------------------------------------------------------------
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
      return { rows: [{ val: "Örnek Değer" }] };
    }
    if (query.includes("SUM(CASE WHEN")) {
      return { rows: [{ total: matchRate.total, matched: matchRate.matched }] };
    }
    throw new Error(`beklenmeyen sorgu: ${query}`);
  };
}

/** `TBLMUSTERIGRUP` ailesinin canlı DB'de TAM VAR olduğu senaryo. */
const LIVE_SCHEMA_OK: FakeSchema = {
  tables: new Set(["TBLMUSTERIGRUP"]),
  columnTypes: new Map([
    ["TBLMUSTERI.TXTGRUPKOD", "varchar"],
    ["TBLMUSTERIGRUP.TXTKOD", "varchar"],
    ["TBLMUSTERIGRUP.TXTAD", "varchar"],
  ]),
};

/** Allowlist'te olan AMA canlı DB'de eksik bir tablo (kaydetme reddedilmeli). */
const LIVE_SCHEMA_MISSING: FakeSchema = { tables: new Set(), columnTypes: new Map() };

// ---------------------------------------------------------------------------
// Gerçek fixture tenant — mapping-store.ts'teki AYNI backup/restore deseni
// (bkz. `mapping-override-e2e.test.ts`). "wietnauer" gerçek kayıtlı bir
// tenant id'si olmalı (getTenantConfig() bilinmeyen id'de default'a düşer).
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const TENANT_ID = "wietnauer";
const OVERRIDE_FILE = path.join(REPO_ROOT, "data", `tenant-config.${TENANT_ID}.enc.json`);
const DEFAULT_META = { table: "TBLMUSTERIGRUPKIRILIM", joinColumn: "TXTGRUPKIRILIMKOD", labelColumn: "TXTAD" };

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

describe("saveCustomerBreakdownOverride — (a) allowlist/şema doğrulaması", () => {
  it("allowlist DIŞI tablo, DB'ye HİÇ gitmeden reddedilir (fail-fast)", async () => {
    let dbCalled = false;
    const run: RunReadOnlyFn = async () => {
      dbCalled = true;
      return { rows: [] };
    };
    await expect(
      saveCustomerBreakdownOverride({
        run,
        tenantId: TENANT_ID,
        actor: "test-admin",
        input: { table: "TBLKULLANICI", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" },
      }),
    ).rejects.toThrow(/allowlist/i);
    expect(dbCalled).toBe(false);
    expect(getMappingOverride(TENANT_ID)).toBeNull(); // diske hiçbir şey yazılmadı
    expect(cachedClear).not.toHaveBeenCalled();
    expect(recordConfigAudit).not.toHaveBeenCalled();
  });

  it("allowlist'te olan AMA canlı DB'de eksik bir tablo LiveSchemaValidationError ile reddedilir", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_MISSING);
    await expect(
      saveCustomerBreakdownOverride({
        run,
        tenantId: TENANT_ID,
        actor: "test-admin",
        input: { table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" },
      }),
    ).rejects.toBeInstanceOf(LiveSchemaValidationError);
    expect(getMappingOverride(TENANT_ID)).toBeNull(); // bozuk config diske YAZILMADI
    expect(cachedClear).not.toHaveBeenCalled();
    expect(recordConfigAudit).not.toHaveBeenCalled();
  });
});

describe("saveCustomerBreakdownOverride — (b) geçerli alternatif → yaz + invalidate + audit", () => {
  it("setMappingOverride'ı ATOMİK yazar, cache'i SENKRON invalidate eder ve audit kaydeder", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK);
    await saveCustomerBreakdownOverride({
      run,
      tenantId: TENANT_ID,
      actor: "test-admin",
      input: { table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" },
    });

    // 1) Diske GERÇEKTEN yazıldı (fixture dosyasından okunuyor).
    expect(getMappingOverride(TENANT_ID)?.dimensions?.customerBreakdown).toEqual({
      table: "TBLMUSTERIGRUP",
      joinColumn: "TXTGRUPKOD",
      labelColumn: "TXTAD",
    });
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).toEqual({
      table: "TBLMUSTERIGRUP",
      joinColumn: "TXTGRUPKOD",
      labelColumn: "TXTAD",
    });

    // 2) Cache invalidation SENKRON tetiklendi (5 domain).
    expect(cachedClear).toHaveBeenCalledTimes(5);

    // 3) Audit yazıldı — actor + eski→yeni.
    expect(recordConfigAudit).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(recordConfigAudit).mock.calls[0]![0];
    expect(auditCall).toMatchObject({
      tenantId: TENANT_ID,
      actor: "test-admin",
      action: "save",
      field: "dimensions.customerBreakdown",
      oldValue: DEFAULT_META,
      newValue: { table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" },
    });
  });
});

describe("resetCustomerBreakdownOverride — (c) default'a döner", () => {
  it("override yazıldıktan sonra reset default'a döner + invalidate + audit", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK);
    await saveCustomerBreakdownOverride({
      run,
      tenantId: TENANT_ID,
      actor: "test-admin",
      input: { table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" },
    });
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).not.toEqual(DEFAULT_META);

    vi.mocked(cachedClear).mockClear();
    vi.mocked(recordConfigAudit).mockClear();

    await resetCustomerBreakdownOverride({ tenantId: TENANT_ID, actor: "test-admin" });

    expect(getMappingOverride(TENANT_ID)).toBeNull(); // override dosyadan kalktı
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).toEqual(DEFAULT_META);
    expect(getMappingConfig()).toEqual(getTenantConfig()); // sıfır regresyon
    expect(cachedClear).toHaveBeenCalledTimes(5);
    expect(recordConfigAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reset", field: "dimensions.customerBreakdown" }),
    );
  });
});

describe("previewCustomerBreakdownCandidate — (d) match-rate + tip bayrağı", () => {
  it("canlı şema OK'ken örnek değer + doğru match-rate döner", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK, { total: 200, matched: 120 });
    const preview = await previewCustomerBreakdownCandidate(run, {
      table: "TBLMUSTERIGRUP",
      joinColumn: "TXTGRUPKOD",
      labelColumn: "TXTAD",
    });
    expect(preview.live.typeMismatch).toBe(false);
    expect(preview.sampleValues).toEqual(["Örnek Değer"]);
    expect(preview.matchRate).toEqual({ total: 200, matched: 120, rate: 0.6 });
  });

  it("tip uyumsuzluğu varsa bayrağı true, ama önizleme yine de çalışır (reddetmez)", async () => {
    const mismatchSchema: FakeSchema = {
      tables: new Set(["TBLMUSTERIGRUP"]),
      columnTypes: new Map([
        ["TBLMUSTERI.TXTGRUPKOD", "int"],
        ["TBLMUSTERIGRUP.TXTKOD", "varchar"],
        ["TBLMUSTERIGRUP.TXTAD", "varchar"],
      ]),
    };
    const run = makeFakeRun(mismatchSchema, { total: 10, matched: 0 });
    const preview = await previewCustomerBreakdownCandidate(run, {
      table: "TBLMUSTERIGRUP",
      joinColumn: "TXTGRUPKOD",
      labelColumn: "TXTAD",
    });
    expect(preview.live.typeMismatch).toBe(true);
    expect(preview.matchRate).toEqual({ total: 10, matched: 0, rate: 0 });
  });

  it("tablo canlı DB'de yoksa örnek/match-rate DENENMEZ (null döner)", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_MISSING);
    const preview = await previewCustomerBreakdownCandidate(run, {
      table: "TBLMUSTERIGRUP",
      joinColumn: "TXTGRUPKOD",
      labelColumn: "TXTAD",
    });
    expect(preview.live.tableExists).toBe(false);
    expect(preview.sampleValues).toBeNull();
    expect(preview.matchRate).toBeNull();
  });

  it("allowlist dışı girdi preview'de de THROW eder (kaydetmeden önce bile enjeksiyon yüzeyi kapalı)", async () => {
    const run = makeFakeRun(LIVE_SCHEMA_OK);
    await expect(
      previewCustomerBreakdownCandidate(run, {
        table: "TBLKULLANICI; DROP TABLE X--",
        joinColumn: "TXTGRUPKOD",
        labelColumn: "TXTAD",
      }),
    ).rejects.toThrow();
  });
});
