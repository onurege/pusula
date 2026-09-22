import { describe, expect, it } from "vitest";
import { assertConfinedToDataDir, assertValidTenantId, isValidTenantId, TenantIdError } from "../tenant-id.js";

/**
 * Faz 0 C-1 CRITICAL — tenant-id path traversal savunması.
 *
 * `resolveIdentifier` (`identifier.ts`) BURADA test EDİLMEZ — o SQL bare
 * identifier'lar için (tire yasak); tenant id'leri ("pernod-demo",
 * "fmcg-demo") tire İÇERİR, kendi ayrı doğrulayıcısı gerekir (bkz. dosya-üstü
 * not, `tenant-id.ts`).
 */
describe("isValidTenantId / assertValidTenantId", () => {
  it("mevcut REGISTRY id'lerini (tire içeren dahil) kabul eder", () => {
    for (const id of ["pernod", "pernod-demo", "fmcg-demo", "wietnauer"]) {
      expect(isValidTenantId(id)).toBe(true);
      expect(assertValidTenantId(id)).toBe(id);
    }
  });

  it("tek karakterli id'yi kabul eder", () => {
    expect(isValidTenantId("a")).toBe(true);
  });

  it("path traversal denemesini (../) THROW eder", () => {
    expect(() => assertValidTenantId("../../etc/passwd")).toThrow(TenantIdError);
    expect(isValidTenantId("../../etc/passwd")).toBe(false);
  });

  it("eğik çizgi / ters eğik çizgi içeren id'yi THROW eder", () => {
    expect(() => assertValidTenantId("foo/bar")).toThrow(TenantIdError);
    expect(() => assertValidTenantId("foo\\bar")).toThrow(TenantIdError);
  });

  it("nokta içeren id'yi THROW eder (dosya uzantısı enjeksiyonu)", () => {
    expect(() => assertValidTenantId("tenant.json")).toThrow(TenantIdError);
  });

  it("NUL bayt içeren id'yi THROW eder", () => {
    expect(() => assertValidTenantId("pernod\0.json")).toThrow(TenantIdError);
  });

  it("baş/son tire içeren id'yi THROW eder", () => {
    expect(() => assertValidTenantId("-pernod")).toThrow(TenantIdError);
    expect(() => assertValidTenantId("pernod-")).toThrow(TenantIdError);
  });

  it("büyük harf/alt çizgi içeren id'yi THROW eder (yalnız küçük harf/rakam/tire)", () => {
    expect(() => assertValidTenantId("Pernod")).toThrow(TenantIdError);
    expect(() => assertValidTenantId("pernod_demo")).toThrow(TenantIdError);
  });

  it("40 karakterden uzun id'yi THROW eder", () => {
    expect(() => assertValidTenantId("a".repeat(41))).toThrow(TenantIdError);
  });

  it("boş string / non-string id'yi THROW eder", () => {
    expect(() => assertValidTenantId("")).toThrow(TenantIdError);
    expect(() => assertValidTenantId(undefined)).toThrow(TenantIdError);
    expect(() => assertValidTenantId(123)).toThrow(TenantIdError);
  });
});

describe("assertConfinedToDataDir (path-confinement, regex'ten bağımsız 2. katman)", () => {
  it("data/ içindeki bir dosya yolunu kabul eder", () => {
    expect(() => assertConfinedToDataDir("/repo/data/tenant-def.acme.json", "/repo/data")).not.toThrow();
  });

  it("data/ DIŞINA çıkan (üst dizin) bir yolu THROW eder", () => {
    expect(() => assertConfinedToDataDir("/repo/data/../etc/passwd", "/repo/data")).toThrow(TenantIdError);
  });

  it("data/ ile aynı ÖNEK'e sahip ama farklı bir kardeş dizini (prefix-bypass) THROW eder", () => {
    // "/repo/data-evil" "/repo/data" ile başlıyor gibi görünür ama FARKLI bir
    // dizindir — `path.sep` eklenmiş karşılaştırma bu bypass'ı kapatır.
    expect(() => assertConfinedToDataDir("/repo/data-evil/x.json", "/repo/data")).toThrow(TenantIdError);
  });
});
