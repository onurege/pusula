import { describe, it, expect } from "vitest";
import { univeraCustomEncrypt, verifyUniveraPassword } from "../auth.js";

/**
 * Univera legacy şifre şeması (clsString.CustomEncrypt) regresyon testi.
 * Şema kaynak spec ile bit-bazında doğrulandı; bu testler o vektörleri ve
 * `verifyUniveraPassword`'un FAIL-CLOSED sözleşmesini kilitler (auth kritik
 * modül — Faz B veto QA gap kapanışı).
 */
describe("univeraCustomEncrypt — spec vektörleri (bit-bazında)", () => {
  const VECTORS: ReadonlyArray<[string, string]> = [
    ["ht22!!", "V3C46mKr64kTeTkCpS+YWA=="],
    ["123456789", "Zx+4/CD8sReSCCzx8r0rJg=="],
    ["P@ssw0rd", "ZgbG8X+niaeRXh9Nr9xkgg=="],
    ["Univera Connect 2026", "3nF0FzpRcAgEtsnxoe67dLfWXmkWFPG0F7TfGbnkR6M="],
    // boot self-test vektörü (auth.ts SELFTEST_*)
    ["321", "NHZI8nQ3ijIGZVRW2jwShg=="],
  ];

  it.each(VECTORS)("encrypt(%j) === %j", (plain, cipher) => {
    expect(univeraCustomEncrypt(plain)).toBe(cipher);
  });

  it("deterministik — aynı düz metin her zaman aynı ciphertext (sabit IV)", () => {
    expect(univeraCustomEncrypt("ht22!!")).toBe(univeraCustomEncrypt("ht22!!"));
  });

  it("düz metni şifreye çevirir (kimlik değil)", () => {
    expect(univeraCustomEncrypt("ht22!!")).not.toBe("ht22!!");
  });
});

describe("univeraCustomEncrypt — 'zaten base64 ise dokunma' kısayolu", () => {
  it("geçerli base64 girdi olduğu gibi döner (orijinal DLL davranışı)", () => {
    // "12345678" geçerli base64 (8 karakter, %4==0) → şifrelenmez
    expect(univeraCustomEncrypt("12345678")).toBe("12345678");
  });

  it("geçersiz base64 girdi şifrelenir", () => {
    // "ht22!!" geçerli base64 değil (! karakteri) → şifrelenir
    expect(univeraCustomEncrypt("ht22!!")).toBe("V3C46mKr64kTeTkCpS+YWA==");
  });
});

describe("verifyUniveraPassword — FAIL-CLOSED sözleşmesi", () => {
  it("doğru şifre → true (encrypt(girilen) === stored)", () => {
    expect(verifyUniveraPassword("ht22!!", "V3C46mKr64kTeTkCpS+YWA==")).toBe(true);
  });

  it("yanlış şifre → false", () => {
    expect(verifyUniveraPassword("yanlis", "V3C46mKr64kTeTkCpS+YWA==")).toBe(false);
  });

  it("stored null → false (fail-closed)", () => {
    expect(verifyUniveraPassword("ht22!!", null)).toBe(false);
  });

  it("stored boş string → false", () => {
    expect(verifyUniveraPassword("ht22!!", "")).toBe(false);
  });

  it("stored'daki baştaki/sondaki boşluk toleranslı (trim)", () => {
    expect(verifyUniveraPassword("ht22!!", "  V3C46mKr64kTeTkCpS+YWA==  ")).toBe(true);
  });

  it("eski gevşek davranışın regresyonu: rastgele '1' artık reddedilir", () => {
    // stored = "321"in şifresi; "1" ile giriş DENEMESİ eşleşmemeli
    const stored321 = "NHZI8nQ3ijIGZVRW2jwShg==";
    expect(verifyUniveraPassword("321", stored321)).toBe(true);
    expect(verifyUniveraPassword("1", stored321)).toBe(false);
  });

  it("base64-kısayol şifresi de doğrulanır", () => {
    // "12345678" şifrelenmeden saklanır; aynı değerle doğrulama tutar
    expect(verifyUniveraPassword("12345678", "12345678")).toBe(true);
  });
});
