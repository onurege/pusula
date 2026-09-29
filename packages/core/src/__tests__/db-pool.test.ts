import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `getPool()` creds-wire testleri (Faz A Dalga 2 GÖREV 1) — `mssql`
 * mock'lanır (gerçek TCP bağlantısı açılmaz); yalnız `new sql.ConnectionPool
 * (config)`'e GEÇEN config'i ve kaç kez YENİ bir pool açıldığını gözlemleriz.
 *
 * `vi.hoisted` — `vi.mock` fabrikası modül-üstü hoisted edilir (Vitest/Vite
 * kısıtı); `poolInstances`'ı fabrika İÇİNDEN erişilebilir kılmak için AYNI
 * şekilde hoisted edilmesi gerekir.
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
import { clearTenantCache } from "../tenant/index.js";
import { saveTenantDefinition, type TenantDefinition } from "../tenant/tenant-definition-store.js";
import { saveDbConnectionOverride, getDbConnectionMeta } from "../tenant/db-connection-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FIXTURE_TENANT = "vitest-db-pool-acme";
const DEF_FILE = path.join(REPO_ROOT, "data", `tenant-def.${FIXTURE_TENANT}.json`);
const CONN_FILE = path.join(REPO_ROOT, "data", `tenant-config.${FIXTURE_TENANT}.enc.json`);
// buildTenantFromDefinition: `${id.toUpperCase().replace(/-/g, "_")}_MSSQL_`
const FIXTURE_PREFIX = "VITEST_DB_POOL_ACME_MSSQL_";

const ORIGINAL_TENANT_ENV = process.env.TENANT;
const ENV_KEYS = [
  `${FIXTURE_PREFIX}SERVER`,
  `${FIXTURE_PREFIX}PORT`,
  `${FIXTURE_PREFIX}DATABASE`,
  `${FIXTURE_PREFIX}USER`,
  `${FIXTURE_PREFIX}PASSWORD`,
  `${FIXTURE_PREFIX}ENCRYPT`,
  `${FIXTURE_PREFIX}TRUST_SERVER_CERT`,
];

beforeAll(() => {
  process.env.CONFIG_ENC_KEY = "0".repeat(64); // 32 bayt hex — yalnız test anahtarı
});

function restoreEnv(): void {
  if (ORIGINAL_TENANT_ENV === undefined) delete process.env.TENANT;
  else process.env.TENANT = ORIGINAL_TENANT_ENV;
  for (const k of ENV_KEYS) delete process.env[k];
}

function cleanupFixtures(): void {
  for (const f of [DEF_FILE, CONN_FILE]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* zaten yok */
    }
  }
}

async function activateFixtureTenant(): Promise<void> {
  const def: TenantDefinition = {
    id: FIXTURE_TENANT,
    displayName: "DB Pool Fixture",
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
  process.env.TENANT = FIXTURE_TENANT;
  clearTenantCache();
}

afterEach(async () => {
  await closePool().catch(() => undefined);
  cleanupFixtures();
  restoreEnv();
  clearTenantCache();
  poolInstances.length = 0;
});

describe("getPool() — store override VARSA store kullanılır (decrypt yalnız pool-init'te)", () => {
  it("server/database/user/password şifresi ÇÖZÜLMÜŞ store'dan gelir — .env HİÇ okunmaz", async () => {
    await activateFixtureTenant();
    await saveDbConnectionOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      input: { server: "10.0.0.9", database: "PANORAMA_DB", user: "svc_panorama", password: "cok-gizli-parola" },
    });
    // Env prefix'i BİLİNÇLİ OLARAK BOŞ bırakılır — eğer kod env dalına
    // düşerse `readEnv` "Missing required env var" ile THROW eder, bu da
    // testin kendisini başarısız kılar (store dalına gerçekten girdiğinin
    // dolaylı kanıtı).
    for (const k of ENV_KEYS) delete process.env[k];

    const pool = await getPool();
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0]!.config).toMatchObject({
      server: "10.0.0.9",
      database: "PANORAMA_DB",
      user: "svc_panorama",
      password: "cok-gizli-parola", // ÇÖZÜLMÜŞ düz metin — decrypt burada gerçekleşti
      port: 1433,
    });
    expect(pool).toBe(poolInstances[0]);
  });

  it("cache-hit'te YENİDEN decrypt/pool-init OLMAZ — ikinci getPool() çağrısı YENİ ConnectionPool açmaz", async () => {
    await activateFixtureTenant();
    await saveDbConnectionOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      input: { server: "10.0.0.9", database: "PANORAMA_DB", user: "svc_panorama", password: "parola-1" },
    });
    const first = await getPool();
    const second = await getPool();
    expect(poolInstances).toHaveLength(1); // tek pool-init — decrypt de tek sefer çağrıldı demektir
    expect(first).toBe(second);
  });

  it("closePool() sonrası bir sonraki getPool() YENİ bir pool açar (aynı kaynak-tipinde bile — 'kaydet sonrası taze bağlantı' güvenli reset yolu)", async () => {
    await activateFixtureTenant();
    await saveDbConnectionOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      input: { server: "10.0.0.9", database: "PANORAMA_DB", user: "svc_panorama", password: "eski-parola" },
    });
    await getPool();
    expect(poolInstances).toHaveLength(1);

    // Admin/setup save-endpoint'lerinin yaptığı: creds güncelle + closePool().
    await saveDbConnectionOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      input: { server: "10.0.0.9", database: "PANORAMA_DB", user: "svc_panorama", password: "yeni-parola" },
    });
    await closePool();

    const pool = await getPool();
    expect(poolInstances).toHaveLength(2); // eskisi kapatıldı, YENİ pool yeni parolayla açıldı
    expect(poolInstances[0]!.closeCalls).toBeGreaterThanOrEqual(1);
    expect((pool as unknown as { config: Record<string, unknown> }).config.password).toBe("yeni-parola");
  });
});

describe("getPool() — store override YOKSA .env prefix fallback (pernod/wietnauer regresyon-sıfır)", () => {
  it("bugünkü ${prefix}SERVER/... davranışı BİREBİR korunur", async () => {
    await activateFixtureTenant();
    // Bu fixture için HİÇ db-connection override'ı KAYDETMEDİK — store-miss.
    expect(getDbConnectionMeta(FIXTURE_TENANT).hasPassword).toBe(false);

    process.env[`${FIXTURE_PREFIX}SERVER`] = "legacy-env-server";
    process.env[`${FIXTURE_PREFIX}DATABASE`] = "LEGACY_DB";
    process.env[`${FIXTURE_PREFIX}USER`] = "legacy_user";
    process.env[`${FIXTURE_PREFIX}PASSWORD`] = "legacy-env-password";

    const pool = await getPool();
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0]!.config).toMatchObject({
      server: "legacy-env-server",
      database: "LEGACY_DB",
      user: "legacy_user",
      password: "legacy-env-password",
      port: 1433,
    });
    expect(pool).toBe(poolInstances[0]);
  });

  it("zorunlu env eksikse eskisiyle AYNI 'Missing required env var' hatasını fırlatır", async () => {
    await activateFixtureTenant();
    for (const k of ENV_KEYS) delete process.env[k];
    await expect(getPool()).rejects.toThrow(/Missing required env var/);
  });

  it("PERFORMANS: cache-hit yolunda getDbConnectionMeta/store'a HİÇ bakılmaz — env→store geçişi closePool() OLMADAN yansımaz (bilinçli tradeoff, bkz. db.ts getPool() dosya-üstü notu)", async () => {
    await activateFixtureTenant();
    process.env[`${FIXTURE_PREFIX}SERVER`] = "legacy-env-server";
    process.env[`${FIXTURE_PREFIX}DATABASE`] = "LEGACY_DB";
    process.env[`${FIXTURE_PREFIX}USER`] = "legacy_user";
    process.env[`${FIXTURE_PREFIX}PASSWORD`] = "legacy-env-password";
    await getPool();
    expect(poolInstances).toHaveLength(1);

    // closePool() ÇAĞRILMADAN store'a creds yazılır — admin/setup save
    // endpoint'lerinin YAPTIĞI şey (closePool()) burada BİLİNÇLİ OLARAK
    // atlanır: cache-hit yolu store'u hiç KONTROL ETMEDİĞİ için (hot-path
    // performansı) eski env-pool'u AYNEN döner — regresyon DEĞİL, tasarım.
    await saveDbConnectionOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      input: { server: "store-server", database: "STORE_DB", user: "store_user", password: "store-password" },
    });
    const staleReuse = await getPool();
    expect(poolInstances).toHaveLength(1); // YENİ pool YOK — cache-hit
    expect((staleReuse as unknown as { config: Record<string, unknown> }).config).toMatchObject({
      server: "legacy-env-server",
    });

    // `closePool()` (save endpoint'lerinin gerçekte yaptığı) çağrılınca taze
    // store creds bir sonraki `getPool()`'da devreye girer.
    await closePool();
    const fresh = await getPool();
    expect(poolInstances).toHaveLength(2);
    expect((fresh as unknown as { config: Record<string, unknown> }).config).toMatchObject({
      server: "store-server",
      password: "store-password",
    });
  });
});
