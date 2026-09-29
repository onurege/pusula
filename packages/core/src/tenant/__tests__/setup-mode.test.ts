import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../audit-log.js", () => ({ recordConfigAudit: vi.fn().mockResolvedValue(undefined) }));

import { saveDbConnectionOverride } from "../db-connection-config.js";
import { saveTenantDefinition, type TenantDefinition } from "../tenant-definition-store.js";
import { clearTenantCache } from "../index.js";
import {
  isActiveTenantIncomplete,
  isSetupModeActive,
  verifySetupToken,
  SETUP_TOKEN_HEADER,
} from "../setup-mode.js";

/**
 * Güvenli setup modu (Faz A Dalga 2) — Faz 0 H-1 fail-closed sözleşmesi.
 *
 * `process.env.TENANT`/`SETUP_TOKEN` mutasyona uğrar; vitest her test
 * dosyasını izole bir worker'da çalıştırır (`vitest.config.ts` default
 * `isolate: true`) — diğer test dosyalarını etkilemez, aynı desen
 * `tenant-definition-fallback.test.ts`'te de kullanılır.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FIXTURE_TENANT = "vitest-setup-mode-acme";
const DEF_FILE = path.join(REPO_ROOT, "data", `tenant-def.${FIXTURE_TENANT}.json`);
const CONN_FILE = path.join(REPO_ROOT, "data", `tenant-config.${FIXTURE_TENANT}.enc.json`);

const ORIGINAL_TENANT_ENV = process.env.TENANT;
const ORIGINAL_SETUP_TOKEN = process.env.SETUP_TOKEN;

const VALID_TOKEN = "a".repeat(32); // tam 32 bayt — minimum kabul edilen uzunluk
const SHORT_TOKEN = "kisa-token"; // < 32 bayt — fail-closed devre dışı bırakmalı

beforeAll(() => {
  process.env.CONFIG_ENC_KEY = "0".repeat(64); // 32 bayt hex — yalnız test anahtarı
});

function restoreEnv(): void {
  if (ORIGINAL_TENANT_ENV === undefined) delete process.env.TENANT;
  else process.env.TENANT = ORIGINAL_TENANT_ENV;
  if (ORIGINAL_SETUP_TOKEN === undefined) delete process.env.SETUP_TOKEN;
  else process.env.SETUP_TOKEN = ORIGINAL_SETUP_TOKEN;
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

afterEach(() => {
  cleanupFixtures();
  restoreEnv();
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

describe("isActiveTenantIncomplete — tamamlanmışlık matrisi", () => {
  it("REGISTRY-yönetimli tenant (wietnauer) HER ZAMAN tamamlanmış sayılır (regresyon-sıfır)", () => {
    process.env.TENANT = "wietnauer";
    expect(isActiveTenantIncomplete()).toBe(false);
  });

  it("REGISTRY-yönetimli default (pernod, TENANT boş) tamamlanmış sayılır", () => {
    delete process.env.TENANT;
    expect(isActiveTenantIncomplete()).toBe(false);
  });

  it("tenant-def YOK → tamamlanmamış (true)", () => {
    process.env.TENANT = FIXTURE_TENANT;
    expect(isActiveTenantIncomplete()).toBe(true);
  });

  it("tenant-def VAR ama dbCredentials YOK → tamamlanmamış (true)", async () => {
    await saveTenantDefinition(makeDef());
    process.env.TENANT = FIXTURE_TENANT;
    expect(isActiveTenantIncomplete()).toBe(true);
  });

  it("tenant-def VAR ve dbCredentials VAR → tamamlanmış (false)", async () => {
    await saveTenantDefinition(makeDef());
    await saveDbConnectionOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      input: { server: "10.0.0.5", database: "UNIVERA", user: "sa", password: "gizli" },
    });
    process.env.TENANT = FIXTURE_TENANT;
    expect(isActiveTenantIncomplete()).toBe(false);
  });
});

describe("isSetupModeActive — aktiflik matrisi (SETUP_TOKEN × tamamlanmışlık)", () => {
  it("SETUP_TOKEN yokken — tenant tamamlanmamış olsa bile — devre dışı", () => {
    delete process.env.SETUP_TOKEN;
    process.env.TENANT = FIXTURE_TENANT; // tanım yok → tamamlanmamış
    expect(isSetupModeActive()).toBe(false);
  });

  it("SETUP_TOKEN 32 bayttan KISA iken devre dışı (fail-closed)", () => {
    process.env.SETUP_TOKEN = SHORT_TOKEN;
    process.env.TENANT = FIXTURE_TENANT;
    expect(isSetupModeActive()).toBe(false);
  });

  it("SETUP_TOKEN geçerli + tenant tamamlanmamış → AKTİF", () => {
    process.env.SETUP_TOKEN = VALID_TOKEN;
    process.env.TENANT = FIXTURE_TENANT;
    expect(isSetupModeActive()).toBe(true);
  });

  it("SETUP_TOKEN geçerli + tenant TAMAMLANMIŞ (REGISTRY-yönetimli) → devre dışı", () => {
    process.env.SETUP_TOKEN = VALID_TOKEN;
    process.env.TENANT = "pernod";
    expect(isSetupModeActive()).toBe(false);
  });

  it("SETUP_TOKEN geçerli + tenant tamamlandıktan (dbCredentials yazıldıktan) SONRA otomatik kapanır (H-1, in-memory bayrak yok)", async () => {
    process.env.SETUP_TOKEN = VALID_TOKEN;
    process.env.TENANT = FIXTURE_TENANT;
    await saveTenantDefinition(makeDef());
    expect(isSetupModeActive()).toBe(true); // tanım var, dbCredentials henüz yok

    await saveDbConnectionOverride({
      tenantId: FIXTURE_TENANT,
      actor: "test",
      input: { server: "10.0.0.5", database: "UNIVERA", user: "sa", password: "gizli" },
    });
    expect(isSetupModeActive()).toBe(false); // canlı kontrol — ayrı bir "kapat" adımı gerekmedi
  });
});

describe("verifySetupToken — timingSafeEqual tabanlı sabit-zamanlı karşılaştırma", () => {
  it("doğru token → true", () => {
    process.env.SETUP_TOKEN = VALID_TOKEN;
    expect(verifySetupToken(VALID_TOKEN)).toBe(true);
  });

  it("yanlış token → false", () => {
    process.env.SETUP_TOKEN = VALID_TOKEN;
    expect(verifySetupToken("b".repeat(32))).toBe(false);
  });

  it("farklı UZUNLUKTA token → throw ETMEZ, false döner (naive timingSafeEqual buffer boyu farkında throw eder — burada SHA-256 digest'e indirgeme bunu önler)", () => {
    process.env.SETUP_TOKEN = VALID_TOKEN;
    expect(() => verifySetupToken("kisa")).not.toThrow();
    expect(verifySetupToken("kisa")).toBe(false);
  });

  it("SETUP_TOKEN tanımsızken her zaman false döner", () => {
    delete process.env.SETUP_TOKEN;
    expect(verifySetupToken(VALID_TOKEN)).toBe(false);
  });

  it("candidate null/undefined iken false döner (throw etmez)", () => {
    process.env.SETUP_TOKEN = VALID_TOKEN;
    expect(verifySetupToken(null)).toBe(false);
    expect(verifySetupToken(undefined)).toBe(false);
  });

  it("prototip/tip kaçışlarına karşı sağlam — plain string DIŞINDA bir şey throw ettirmez, false döner", () => {
    // Naive `===` bu girdilerle "false" dönerdi zaten; buradaki asıl amaç
    // `crypto.createHash(...).update(candidate, "utf8")` çağrısının GEÇERSİZ
    // (string olmayan) bir candidate ile içeride THROW etmediğini/güvenle
    // ele alındığını doğrulamak — `verifySetupToken` imzası `string | null |
    // undefined` kabul eder, tip sistemi zaten bunun dışını engeller; runtime
    // savunması burada yalnız null/undefined için (yukarıdaki test).
    process.env.SETUP_TOKEN = VALID_TOKEN;
    expect(verifySetupToken("")).toBe(false);
  });

  it("SETUP_TOKEN_HEADER header adı sabit ve tanımlı", () => {
    expect(SETUP_TOKEN_HEADER).toBe("x-setup-token");
  });
});
