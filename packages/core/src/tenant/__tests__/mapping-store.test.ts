import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  getMappingOverride,
  resetProductBreakdownOverride,
  resetRegionBreakdownOverride,
  setMappingOverride,
  type MappingOverride,
} from "../mapping-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// repoRoot() yukarı yürüyerek "apps" + "packages" içeren dizini bulur —
// testin kendisi zaten packages/core/src/tenant/__tests__ altında, üç seviye
// yukarısı repo kökü.
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const FIXTURE_TENANT = "vitest-fixture";
const FIXTURE_FILE = path.join(REPO_ROOT, "data", `tenant-config.${FIXTURE_TENANT}.enc.json`);

function cleanupFixture(): void {
  try {
    fs.unlinkSync(FIXTURE_FILE);
  } catch {
    /* zaten yok — sorun değil */
  }
}

beforeAll(() => {
  // Testler gerçek bir env değişkeni set edilmemişse skip edilecek şekilde
  // değil, kendi rastgele test anahtarını sağlar (üretim anahtarına dokunmaz).
  process.env.CONFIG_ENC_KEY = "0".repeat(64); // 64 hex karakter = 32 bayt
});

afterEach(cleanupFixture);
afterAll(cleanupFixture);

describe("encryptSecret / decryptSecret (AES-256-GCM)", () => {
  it("round-trip: şifrelenen değer aynen çözülür", () => {
    const plaintext = "W_MSSQL_PASSWORD_ornek_123!";
    const encrypted = encryptSecret(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("her çağrıda farklı IV üretir (rastgele IV — auth.ts'teki IV'siz ECB'nin aksine)", () => {
    const a = encryptSecret("aynı-değer");
    const b = encryptSecret("aynı-değer");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("ciphertext kurcalanırsa auth tag doğrulaması THROW eder (bütünlük korunur)", () => {
    const encrypted = encryptSecret("gizli-parola");
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + "abcd" };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("CONFIG_ENC_KEY yokken fail-closed THROW eder (sessiz demo-moda düşmez)", () => {
    const original = process.env.CONFIG_ENC_KEY;
    delete process.env.CONFIG_ENC_KEY;
    try {
      expect(() => encryptSecret("x")).toThrow(/CONFIG_ENC_KEY/);
    } finally {
      process.env.CONFIG_ENC_KEY = original;
    }
  });
});

describe("setMappingOverride / getMappingOverride (atomik store)", () => {
  it("yazılan override birebir aynı şekilde okunur", async () => {
    const override: MappingOverride = {
      dimensions: {
        customerBreakdown: {
          table: "TBLMUSTERIGRUP",
          joinColumn: "TXTGRUPKOD",
          labelColumn: "TXTAD",
        },
      },
      updatedAt: new Date().toISOString(),
      updatedBy: "vitest",
    };
    await setMappingOverride(FIXTURE_TENANT, override);
    expect(getMappingOverride(FIXTURE_TENANT)).toEqual(override);
  });

  it("dosya mod 0600 ile yazılır (web-root dışı + erişim kısıtlı)", async () => {
    await setMappingOverride(FIXTURE_TENANT, { updatedAt: new Date().toISOString() });
    const mode = fs.statSync(FIXTURE_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("geçersiz (allowlist dışı) customerBreakdown DİSKE YAZILMADAN THROW eder", async () => {
    const badOverride: MappingOverride = {
      dimensions: {
        customerBreakdown: {
          table: "TXTGRUP; UNION SELECT TXTPASSWORD FROM TBLKULLANICI--",
          joinColumn: "TXTGRUPKIRILIMKOD",
          labelColumn: "TXTAD",
        },
      },
      updatedAt: new Date().toISOString(),
    };
    await expect(setMappingOverride(FIXTURE_TENANT, badOverride)).rejects.toThrow();
    // Kötü override hiç yazılmadı — dosya yok ya da önceki geçerli durumda.
    const persistedTable = getMappingOverride(FIXTURE_TENANT)?.dimensions?.customerBreakdown?.table ?? "";
    expect(persistedTable).not.toContain("UNION");
  });

  it("eşzamanlı yazımlar birbirini ezmez — kuyruk çağrı sırasıyla işler (B2 torn-write savunması)", async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      setMappingOverride(FIXTURE_TENANT, { updatedAt: `write-${i}` }),
    );
    await Promise.all(writes);
    // Kuyruk FIFO olduğu için son çağrı (19) kazanmalı; dosya JSON.parse
    // edilebilir olmalı (torn write olsaydı parse hatası/kısmi içerik görürdük).
    const final = getMappingOverride(FIXTURE_TENANT);
    expect(final?.updatedAt).toBe("write-19");
  });

  it("geçersiz (allowlist dışı) productBreakdown DİSKE YAZILMADAN THROW eder (Faz B)", async () => {
    const badOverride: MappingOverride = {
      dimensions: {
        productBreakdown: {
          table: "TBLKULLANICI; DROP TABLE X--",
          joinColumn: "TXTURUNEKGRUPKOD",
          labelColumn: "TXTAD",
        },
      },
      updatedAt: new Date().toISOString(),
    };
    await expect(setMappingOverride(FIXTURE_TENANT, badOverride)).rejects.toThrow();
    expect(getMappingOverride(FIXTURE_TENANT)?.dimensions?.productBreakdown).toBeUndefined();
  });

  it("geçersiz (allowlist dışı) regionBreakdown DİSKE YAZILMADAN THROW eder (Faz B)", async () => {
    const badOverride: MappingOverride = {
      dimensions: {
        regionBreakdown: { table: "TBLKULLANICI", joinColumn: "TXTGRUP", labelColumn: "TXTAD" },
      },
      updatedAt: new Date().toISOString(),
    };
    await expect(setMappingOverride(FIXTURE_TENANT, badOverride)).rejects.toThrow();
    expect(getMappingOverride(FIXTURE_TENANT)?.dimensions?.regionBreakdown).toBeUndefined();
  });

  it("geçerli productBreakdown + regionBreakdown BİRLİKTE yazılıp okunur (Faz B, üç boyut bağımsız)", async () => {
    const override: MappingOverride = {
      dimensions: {
        productBreakdown: { table: "TBLURUNGRUP", joinColumn: "TXTURUNGRUPKOD", labelColumn: "TXTAD" },
        regionBreakdown: { table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" },
      },
      updatedAt: new Date().toISOString(),
    };
    await setMappingOverride(FIXTURE_TENANT, override);
    const persisted = getMappingOverride(FIXTURE_TENANT);
    expect(persisted?.dimensions?.productBreakdown).toEqual(override.dimensions!.productBreakdown);
    expect(persisted?.dimensions?.regionBreakdown).toEqual(override.dimensions!.regionBreakdown);
  });
});

describe("resetProductBreakdownOverride / resetRegionBreakdownOverride (Faz B)", () => {
  it("yalnız kendi boyutunu kaldırır — diğer boyut/dbCredentials DOKUNULMAZ", async () => {
    await setMappingOverride(FIXTURE_TENANT, {
      dimensions: {
        customerBreakdown: { table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" },
        productBreakdown: { table: "TBLURUNGRUP", joinColumn: "TXTURUNGRUPKOD", labelColumn: "TXTAD" },
        regionBreakdown: { table: "TBLDISTEKGRUP", joinColumn: "TXTEKGRUP", labelColumn: "TXTAD" },
      },
      updatedAt: new Date().toISOString(),
    });

    await resetProductBreakdownOverride(FIXTURE_TENANT);
    const afterProductReset = getMappingOverride(FIXTURE_TENANT);
    expect(afterProductReset?.dimensions?.productBreakdown).toBeUndefined();
    expect(afterProductReset?.dimensions?.customerBreakdown).toBeDefined();
    expect(afterProductReset?.dimensions?.regionBreakdown).toBeDefined();

    await resetRegionBreakdownOverride(FIXTURE_TENANT);
    const afterRegionReset = getMappingOverride(FIXTURE_TENANT);
    expect(afterRegionReset?.dimensions?.regionBreakdown).toBeUndefined();
    expect(afterRegionReset?.dimensions?.customerBreakdown).toBeDefined();
  });

  it("son boyut da kaldırılınca ve dbCredentials yoksa dosyanın KENDİSİ silinir", async () => {
    await setMappingOverride(FIXTURE_TENANT, {
      dimensions: { productBreakdown: { table: "TBLURUNGRUP", joinColumn: "TXTURUNGRUPKOD", labelColumn: "TXTAD" } },
      updatedAt: new Date().toISOString(),
    });
    await resetProductBreakdownOverride(FIXTURE_TENANT);
    expect(getMappingOverride(FIXTURE_TENANT)).toBeNull();
  });
});
