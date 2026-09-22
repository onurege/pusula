import { describe, expect, it } from "vitest";
import {
  computeMatchRate,
  isLiveCheckSavable,
  previewSampleValues,
  verifyCandidateLive,
  type RunReadOnlyFn,
} from "../schema-check.js";
import type { CustomerBreakdownMeta } from "../identifier.js";

/**
 * Sahte MSSQL — `db.ts` `runReadOnly`'ye HİÇ bağlanmadan `schema-check.ts`'in
 * `sys.tables`/`sys.columns` sorgu şeklini taklit eder. Gerçek DB'ye asla
 * gitmez (DB salt-okunur kuralı + testin hızlı/deterministik olması).
 */
type FakeSchema = {
  tables: Set<string>;
  columnTypes: Map<string, string>; // "TABLO.KOLON" -> sys.types.name
};

function makeFakeRun(
  schema: FakeSchema,
  sampleRows: string[] = [],
  matchRate: { total: number; matched: number } = { total: 0, matched: 0 },
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
      return { rows: sampleRows.map((val) => ({ val })) };
    }
    if (query.includes("SUM(CASE WHEN")) {
      return { rows: [{ total: matchRate.total, matched: matchRate.matched }] };
    }
    throw new Error(`schema-check.test.ts: beklenmeyen sorgu: ${query}`);
  };
}

const CANDIDATE: CustomerBreakdownMeta = {
  table: "TBLMUSTERIGRUPKIRILIM",
  joinColumn: "TXTGRUPKIRILIMKOD",
  labelColumn: "TXTAD",
};

describe("verifyCandidateLive", () => {
  it("tablo + her iki kolon da canlı DB'de varsa hepsi true döner", async () => {
    const run = makeFakeRun({
      tables: new Set(["TBLMUSTERIGRUPKIRILIM"]),
      columnTypes: new Map([
        ["TBLMUSTERI.TXTGRUPKIRILIMKOD", "varchar"],
        ["TBLMUSTERIGRUPKIRILIM.TXTKOD", "varchar"],
        ["TBLMUSTERIGRUPKIRILIM.TXTAD", "varchar"],
      ]),
    });
    const result = await verifyCandidateLive(run, CANDIDATE);
    expect(result).toEqual({
      tableExists: true,
      joinColumnExists: true,
      labelColumnExists: true,
      joinColumnDataType: "varchar",
      lookupKeyDataType: "varchar",
      typeMismatch: false,
    });
    expect(isLiveCheckSavable(result)).toBe(true);
  });

  it("tablo canlı DB'de YOKSA tableExists=false ve kaydedilemez", async () => {
    const run = makeFakeRun({ tables: new Set(), columnTypes: new Map() });
    const result = await verifyCandidateLive(run, CANDIDATE);
    expect(result.tableExists).toBe(false);
    expect(isLiveCheckSavable(result)).toBe(false);
  });

  it("kolon eksikse (tablo var, TXTAD yok) labelColumnExists=false ve kaydedilemez", async () => {
    const run = makeFakeRun({
      tables: new Set(["TBLMUSTERIGRUPKIRILIM"]),
      columnTypes: new Map([
        ["TBLMUSTERI.TXTGRUPKIRILIMKOD", "varchar"],
        ["TBLMUSTERIGRUPKIRILIM.TXTKOD", "varchar"],
        // TXTAD kasıtlı eksik
      ]),
    });
    const result = await verifyCandidateLive(run, CANDIDATE);
    expect(result.labelColumnExists).toBe(false);
    expect(isLiveCheckSavable(result)).toBe(false);
  });

  it("tip uyumsuzluğunu (varchar vs int) doğru işaretler — REDDETMEZ, yalnız bayrak", async () => {
    const run = makeFakeRun({
      tables: new Set(["TBLMUSTERIGRUPKIRILIM"]),
      columnTypes: new Map([
        ["TBLMUSTERI.TXTGRUPKIRILIMKOD", "int"], // uyumsuz
        ["TBLMUSTERIGRUPKIRILIM.TXTKOD", "varchar"],
        ["TBLMUSTERIGRUPKIRILIM.TXTAD", "varchar"],
      ]),
    });
    const result = await verifyCandidateLive(run, CANDIDATE);
    expect(result.typeMismatch).toBe(true);
    // Tip uyumsuzluğu tek başına kaydetmeyi engellemez — tablo/kolonlar var.
    expect(isLiveCheckSavable(result)).toBe(true);
  });
});

describe("previewSampleValues", () => {
  it("mock'un döndürdüğü örnek değerleri aynen taşır", async () => {
    const run = makeFakeRun({ tables: new Set(), columnTypes: new Map() }, ["Prestige", "Premium"]);
    const values = await previewSampleValues(run, CANDIDATE, 10);
    expect(values).toEqual(["Prestige", "Premium"]);
  });
});

describe("computeMatchRate", () => {
  it("matched/total oranını doğru hesaplar", async () => {
    const run = makeFakeRun({ tables: new Set(), columnTypes: new Map() }, [], {
      total: 200,
      matched: 150,
    });
    const rate = await computeMatchRate(run, CANDIDATE);
    expect(rate).toEqual({ total: 200, matched: 150, rate: 0.75 });
  });

  it("total=0 iken bölme hatası yerine rate=0 döner", async () => {
    const run = makeFakeRun({ tables: new Set(), columnTypes: new Map() }, [], {
      total: 0,
      matched: 0,
    });
    const rate = await computeMatchRate(run, CANDIDATE);
    expect(rate).toEqual({ total: 0, matched: 0, rate: 0 });
  });
});
