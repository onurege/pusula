import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Çok-DB (login'de DB seçimi) testleri. `mssql` mock'lanır (gerçek TCP yok);
 * `new sql.ConnectionPool(config)`'e geçen config'i ve kaç YENİ pool açıldığını
 * gözlemleriz. Kapsam:
 *   - `runWithDbId` bağlamı → `getPool()` yalnız `database` alanını override eder
 *     (sunucu/kimlik aynı), her dbId AYRI pool alır (eşzamanlı iki DB).
 *   - `resolveDatabaseName` allowlist fail-closed (bilinmeyen dbId → throw).
 *   - `listSelectableDatabases` yalnız id+label döner (ham `database` sızmaz).
 *   - regresyon-sıfır: `databases` tanımsız tenant tek-DB davranır (db-pool.test).
 */
const { poolInstances } = vi.hoisted(() => ({
  poolInstances: [] as Array<{ config: Record<string, unknown>; connected: boolean; closeCalls: number }>,
}));

vi.mock("mssql", () => {
  class ConnectionPool {
    config: Record<string, unknown>;
    connected = false;
    closeCalls = 0;
    constructor(config: Record<string, unknown>) {
      this.config = config;
      poolInstances.push(this as unknown as (typeof poolInstances)[number]);
    }
    async connect() {
      this.connected = true;
      return this;
    }
    async close() {
      this.connected = false;
      this.closeCalls += 1;
    }
    request() {
      return { query: vi.fn() };
    }
  }
  return { default: { ConnectionPool } };
});

vi.mock("../tenant/audit-log.js", () => ({ recordConfigAudit: vi.fn().mockResolvedValue(undefined) }));

import { getPool, closePool } from "../db.js";
import { clearTenantCache, listSelectableDatabases, resolveDatabaseName } from "../tenant/index.js";
import { runWithDbId, getActiveDbId } from "../request-context.js";
import { saveTenantDefinition, type TenantDefinition } from "../tenant/tenant-definition-store.js";
import { saveDatabasesOverride, getDatabasesConfig } from "../tenant/databases-config.js";
import { validateDatabaseList } from "../tenant/databases.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FIXTURE_TENANT = "vitest-multidb-acme";
const DEF_FILE = path.join(REPO_ROOT, "data", `tenant-def.${FIXTURE_TENANT}.json`);
const CONN_FILE = path.join(REPO_ROOT, "data", `tenant-config.${FIXTURE_TENANT}.enc.json`);
// buildTenantFromDefinition: `${id.toUpperCase().replace(/-/g, "_")}_MSSQL_`
const FIXTURE_PREFIX = "VITEST_MULTIDB_ACME_MSSQL_";
const DATABASES_ENV = "VITEST_MULTIDB_ACME_DATABASES";

const ORIGINAL_TENANT_ENV = process.env.TENANT;
const ENV_KEYS = [
  `${FIXTURE_PREFIX}SERVER`,
  `${FIXTURE_PREFIX}PORT`,
  `${FIXTURE_PREFIX}DATABASE`,
  `${FIXTURE_PREFIX}USER`,
  `${FIXTURE_PREFIX}PASSWORD`,
  `${FIXTURE_PREFIX}ENCRYPT`,
  `${FIXTURE_PREFIX}TRUST_SERVER_CERT`,
  DATABASES_ENV,
];

beforeAll(() => {
  process.env.CONFIG_ENC_KEY = "0".repeat(64);
});

function restoreEnv(): void {
  if (ORIGINAL_TENANT_ENV === undefined) delete process.env.TENANT;
  else process.env.TENANT = ORIGINAL_TENANT_ENV;
  for (const k of ENV_KEYS) delete process.env[k];
}

async function activateFixtureTenant(): Promise<void> {
  const def: TenantDefinition = {
    id: FIXTURE_TENANT,
    displayName: "Multi-DB Fixture",
    industry: "fmcg",
    strategicBrands: ["Acme Cola"],
    labels: {
      morningHeadline: "h",
      channelTypeTitle: "h",
      channelTypeSource: "h",
      mapEmptyDataSource: "h",
      kpiSourceNote: "h",
      volumeMultiplierHint: "h",
    },
    tax: { key: "kdv", label: "KDV hariç", showInToggle: false },
    updatedAt: new Date().toISOString(),
  };
  await saveTenantDefinition(def);
  // Aynı sunucu/kimlik; yalnız `database` dbId'ye göre değişir.
  process.env[`${FIXTURE_PREFIX}SERVER`] = "10.0.0.5";
  process.env[`${FIXTURE_PREFIX}DATABASE`] = "DEFAULTDB"; // dbId override edecek
  process.env[`${FIXTURE_PREFIX}USER`] = "svc";
  process.env[`${FIXTURE_PREFIX}PASSWORD`] = "pw";
  process.env[DATABASES_ENV] = "core:Reckitt Core:RBHYHO,ess:ESSHOME:ESSHOME";
  process.env.TENANT = FIXTURE_TENANT;
  clearTenantCache();
}

afterEach(async () => {
  await closePool().catch(() => undefined);
  for (const f of [DEF_FILE, CONN_FILE]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* zaten yok */
    }
  }
  restoreEnv();
  clearTenantCache();
  poolInstances.length = 0;
});

describe("request-context — AsyncLocalStorage dbId taşıması", () => {
  it("bağlam yoksa getActiveDbId() undefined döner", () => {
    expect(getActiveDbId()).toBeUndefined();
  });
  it("runWithDbId içinde dbId okunur, dışında tekrar undefined", () => {
    let inside: string | undefined = "x";
    runWithDbId("core", () => {
      inside = getActiveDbId();
    });
    expect(inside).toBe("core");
    expect(getActiveDbId()).toBeUndefined();
  });
  it("null/undefined dbId bağlamı boş kurar", () => {
    let seen: string | undefined = "x";
    runWithDbId(null, () => {
      seen = getActiveDbId();
    });
    expect(seen).toBeUndefined();
  });
});

describe("resolveDatabaseName / listSelectableDatabases (allowlist, fail-closed)", () => {
  it("dbId → gerçek database adına çevrilir", async () => {
    await activateFixtureTenant();
    expect(resolveDatabaseName("core")).toBe("RBHYHO");
    expect(resolveDatabaseName("ess")).toBe("ESSHOME");
  });
  it("dbId boşsa ilk (varsayılan) DB dönülür", async () => {
    await activateFixtureTenant();
    expect(resolveDatabaseName(undefined)).toBe("RBHYHO");
  });
  it("bilinmeyen dbId THROW eder (istekten gelen değer sessizce DB'ye düşemez)", async () => {
    await activateFixtureTenant();
    expect(() => resolveDatabaseName("nope")).toThrow(/Bilinmeyen dbId/);
  });
  it("listSelectableDatabases yalnız id+label döner — ham `database` adı SIZMAZ", async () => {
    await activateFixtureTenant();
    const list = listSelectableDatabases();
    expect(list).toEqual([
      { id: "core", label: "Reckitt Core" },
      { id: "ess", label: "ESSHOME" },
    ]);
    for (const d of list) expect(d).not.toHaveProperty("database");
  });
});

describe("getPool() — çok-DB: dbId'ye göre AYRI pool, yalnız database override", () => {
  it("runWithDbId('core') → database=RBHYHO; runWithDbId('ess') → database=ESSHOME, AYRI pool", async () => {
    await activateFixtureTenant();
    const core = await runWithDbId("core", () => getPool());
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0]!.config).toMatchObject({ server: "10.0.0.5", database: "RBHYHO", user: "svc" });

    const ess = await runWithDbId("ess", () => getPool());
    expect(poolInstances).toHaveLength(2); // ayrı DB → ayrı pool (eşzamanlılık)
    expect(poolInstances[1]!.config).toMatchObject({ server: "10.0.0.5", database: "ESSHOME", user: "svc" });
    expect(core).not.toBe(ess);
  });

  it("aynı dbId ikinci çağrıda YENİ pool açmaz (cache-hit)", async () => {
    await activateFixtureTenant();
    const first = await runWithDbId("core", () => getPool());
    const second = await runWithDbId("core", () => getPool());
    expect(poolInstances).toHaveLength(1);
    expect(first).toBe(second);
  });

  it("bilinmeyen dbId ile getPool() THROW eder (fail-closed)", async () => {
    await activateFixtureTenant();
    await expect(runWithDbId("bogus", () => getPool())).rejects.toThrow(/Bilinmeyen dbId/);
    expect(poolInstances).toHaveLength(0); // pool AÇILMADI
  });
});

describe("validateDatabaseList — kodsuz kayıt doğrulaması (fail-closed)", () => {
  it("etiketten id türetir, normalize eder", () => {
    const out = validateDatabaseList([
      { label: "Reckitt Core", database: "RBHYHO" },
      { label: "Ess Home", database: "ESSHOME" },
    ]);
    expect(out).toEqual([
      { id: "reckitt-core", label: "Reckitt Core", database: "RBHYHO" },
      { id: "ess-home", label: "Ess Home", database: "ESSHOME" },
    ]);
  });
  it("geçersiz database adını reddeder", () => {
    expect(() => validateDatabaseList([{ label: "X", database: "bad;name" }])).toThrow(/Geçersiz veritabanı/);
  });
  it("yinelenen id'yi reddeder", () => {
    expect(() =>
      validateDatabaseList([
        { id: "core", label: "A", database: "DBA" },
        { id: "core", label: "B", database: "DBB" },
      ]),
    ).toThrow(/Yinelenen kimlik/);
  });
  it("etiket boşsa reddeder", () => {
    expect(() => validateDatabaseList([{ label: "  ", database: "DBA" }])).toThrow(/etiket/);
  });
});

describe("store override — kodsuz çok-DB (env'e göre öncelikli)", () => {
  it("saveDatabasesOverride sonrası listSelectableDatabases/resolveDatabaseName STORE'u yansıtır (env değil)", async () => {
    await activateFixtureTenant(); // env DATABASES = core:Reckitt Core:RBHYHO,ess:ESSHOME:ESSHOME
    await saveDatabasesOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      databases: [
        { label: "Şirket A", database: "COMPANYA" },
        { label: "Şirket B", database: "COMPANYB" },
      ],
    });
    clearTenantCache();

    // Store env'i EZER:
    expect(listSelectableDatabases()).toEqual([
      { id: "irket-a", label: "Şirket A" },
      { id: "irket-b", label: "Şirket B" },
    ]);
    expect(resolveDatabaseName("irket-a")).toBe("COMPANYA");
    expect(getDatabasesConfig(FIXTURE_TENANT)).toHaveLength(2);
  });

  it("boş liste kaydı çok-DB'yi KAPATIR → env fallback'e döner", async () => {
    await activateFixtureTenant();
    await saveDatabasesOverride({ tenantId: FIXTURE_TENANT, actor: "test", databases: [] });
    clearTenantCache();
    // Store databases kalmadı → env (2 eleman) devreye girer:
    expect(listSelectableDatabases().map((d) => d.id)).toEqual(["core", "ess"]);
  });
});
