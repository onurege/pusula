import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  getTenantDefinition,
  resetTenantDefinition,
  saveTenantDefinition,
  type TenantDefinition,
} from "../tenant-definition-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FIXTURE_TENANT = "vitest-tenant-def";
const FIXTURE_FILE = path.join(REPO_ROOT, "data", `tenant-def.${FIXTURE_TENANT}.json`);

function cleanupFixture(): void {
  try {
    fs.unlinkSync(FIXTURE_FILE);
  } catch {
    /* zaten yok — sorun değil */
  }
}

afterEach(cleanupFixture);
afterAll(cleanupFixture);

function makeDef(overrides: Partial<TenantDefinition> = {}): TenantDefinition {
  return {
    id: FIXTURE_TENANT,
    displayName: "Vitest Tenant",
    industry: "fmcg",
    strategicBrands: ["Acme"],
    labels: {
      morningHeadline: "Bu Sabah Vitest'te Ne Oluyor",
      channelTypeTitle: "Müşteri Tipi",
      channelTypeSource: "kaynak",
      mapEmptyDataSource: "boş",
      kpiSourceNote: "not",
      volumeMultiplierHint: "hint",
    },
    tax: { key: "kdv", label: "KDV hariç", showInToggle: false },
    updatedAt: new Date().toISOString(),
    updatedBy: "vitest",
    ...overrides,
  };
}

describe("saveTenantDefinition / getTenantDefinition (atomik store roundtrip)", () => {
  it("yazılan tanım birebir aynı şekilde okunur", async () => {
    const def = makeDef();
    await saveTenantDefinition(def);
    expect(getTenantDefinition(FIXTURE_TENANT)).toEqual(def);
  });

  it("dosya mod 0600 ile yazılır", async () => {
    await saveTenantDefinition(makeDef());
    const mode = fs.statSync(FIXTURE_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("kayıtlı olmayan tenant için null döner (throw etmez)", () => {
    expect(getTenantDefinition("vitest-hic-yok-tenant")).toBeNull();
  });

  it("geçersiz (path-traversal) id ile getTenantDefinition THROW ETMEZ — null döner", () => {
    expect(() => getTenantDefinition("../../etc/passwd")).not.toThrow();
    expect(getTenantDefinition("../../etc/passwd")).toBeNull();
  });

  it("geçersiz id ile saveTenantDefinition DİSKE YAZILMADAN reddedilir (fail-closed)", async () => {
    const bad = makeDef({ id: "../../etc/passwd" });
    await expect(saveTenantDefinition(bad)).rejects.toThrow();
  });

  it("eşzamanlı yazımlar birbirini ezmez — kuyruk FIFO işler (torn-write savunması)", async () => {
    const writes = Array.from({ length: 15 }, (_, i) =>
      saveTenantDefinition(makeDef({ displayName: `write-${i}` })),
    );
    await Promise.all(writes);
    expect(getTenantDefinition(FIXTURE_TENANT)?.displayName).toBe("write-14");
  });
});

describe("resetTenantDefinition", () => {
  it("var olan bir tanımı kaldırır", async () => {
    await saveTenantDefinition(makeDef());
    expect(getTenantDefinition(FIXTURE_TENANT)).not.toBeNull();
    await resetTenantDefinition(FIXTURE_TENANT);
    expect(getTenantDefinition(FIXTURE_TENANT)).toBeNull();
  });

  it("olmayan bir tanımı silmek idempotent'tir (throw etmez)", async () => {
    await expect(resetTenantDefinition("vitest-hic-yok-tenant")).resolves.toBeUndefined();
  });
});
