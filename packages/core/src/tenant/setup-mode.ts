/**
 * Güvenli setup modu — Faz A Dalga 2, Faz 0 raporunun "Bootstrap (Security)"
 * bölümündeki sözleşmenin çekirdek (framework'süz, test edilebilir) mantığı.
 * `apps/api/src/setup-gate.ts` bunu saran ince bir Hono middleware'i —
 * `admin-gate.ts` ile AYNI ayrım (core = saf mantık, api = kablo).
 *
 * PROBLEM (tavuk-yumurta): boş bir sunucuda `TENANT=<id>` ile açılış yapılıp
 * o id için ne REGISTRY'de ne tenant-definition store'da bir tanım varsa,
 * `getTenantConfig()` THROW eder — normal admin girişi (session + admin
 * rolü) MÜMKÜN DEĞİLDİR (henüz ne kullanıcı ne DB var). Bu dosya, `SETUP_TOKEN`
 * env'iyle korunan, DAR (3 uç) ve DURUM-TÜREVLİ (H-1) bir kaçış kapısı sağlar.
 *
 * H-1 fail-closed sözleşmesi — İKİ AYRI SORU, KARIŞTIRILMAZ:
 *   1. "Bu deploy'da setup ÖZELLİĞİ açık mı?" → `SETUP_TOKEN` env tanımlı VE
 *      ≥32 bayt VE aktif tenant TAMAMLANMAMIŞ (`isActiveTenantIncomplete`).
 *      Üçü de HER İSTEKTE canlı kontrol edilir — in-memory bayrak YOK. Aktif
 *      tenant tamamlandığı (dbCredentials yazıldığı) AN, bir SONRAKİ istek
 *      otomatik olarak kapanır — ayrı bir "setup'ı kapat" adımı gerekmez.
 *   2. "BU istek yetkili mi?" → `verifySetupToken` (sabit-zamanlı karşılaştırma).
 *   Belirsizlik (beklenmeyen hata — disk/parse) HER İKİ soruda da fail-CLOSED
 *   (`isActiveTenantIncomplete` → false/"tamamlanmış" varsayar → setup KAPALI).
 */
import crypto from "node:crypto";
import { resolveActiveTenantId, listTenantIds } from "./index";
import { getTenantDefinition } from "./tenant-definition-store";
import { getDbConnectionMeta } from "./db-connection-config";

/** `SETUP_TOKEN`'ın minimum uzunluğu (bayt) — Faz 0 şartı. */
const MIN_SETUP_TOKEN_BYTES = 32;

/** İsteğin setup token'ını taşıması gereken header — `setup-gate.ts` okur. */
export const SETUP_TOKEN_HEADER = "x-setup-token";

/**
 * Aktif tenant "tamamlanmamış" mı? — tenant-definition YOK **veya**
 * `dbCredentials` (şifreli store) YOK. REGISTRY-yönetimli tenant'lar
 * (pernod/pernod-demo/fmcg-demo/wietnauer) HER ZAMAN "tamamlanmış" sayılır —
 * bunlar `.env` modeliyle çalışır, setup modu onları ASLA etkilemez
 * (regresyon-sıfır garantisi, Görev metninin "pernod/wietnauer bugünkü .env
 * ile ÇALIŞMAYA DEVAM etmeli" şartı).
 *
 * THROW ETMEZ. `getTenantDefinition`/`getDbConnectionMeta` zaten kendi
 * içlerinde disk/parse hatalarını yutup `null`/`false`'a düşürüyor; yine de
 * bu fonksiyon ek bir try/catch ile sarmalanır (savunma-derinliği — H-1
 * "belirsizlikte fail-CLOSED": beklenmeyen bir hata "tamamlanmış" (yani
 * setup KAPALI) sonucuna düşer, "tamamlanmamış" (setup AÇIK) DEĞİL).
 */
export function isActiveTenantIncomplete(): boolean {
  try {
    const id = resolveActiveTenantId();
    if (listTenantIds().includes(id)) return false; // REGISTRY-yönetimli — daima tamam.
    const def = getTenantDefinition(id);
    if (!def) return true;
    return !getDbConnectionMeta(id).hasPassword;
  } catch (err) {
    console.warn(
      "[setup-mode] tamamlanmışlık kontrolü beklenmeyen hata verdi — fail-closed (setup KAPALI) varsayılıyor.",
      err,
    );
    return false;
  }
}

/** `SETUP_TOKEN` env'i — yoksa/kısaysa `null` (bu deploy'da setup özelliği
 *  TÜMÜYLE kapalı). Değeri ASLA loglanmaz/döndürülmez — yalnız varlık/uzunluk
 *  kontrolü loglanır. */
function loadSetupToken(): string | null {
  const raw = process.env.SETUP_TOKEN;
  if (!raw) return null;
  if (Buffer.byteLength(raw, "utf8") < MIN_SETUP_TOKEN_BYTES) {
    console.warn(
      `[setup-mode] SETUP_TOKEN ${MIN_SETUP_TOKEN_BYTES} bayttan kısa — setup modu devre dışı (fail-closed).`,
    );
    return null;
  }
  return raw;
}

/**
 * Setup modu şu an AKTİF Mİ? — `SETUP_TOKEN` env tanımlı/yeterince uzun VE
 * aktif tenant tamamlanmamış. Bu, "istek doğru token'ı taşıyor mu"
 * sorusundan BAĞIMSIZDIR (`verifySetupToken` ayrı, H-1 iki kontrolü
 * karıştırmaz). `setup-gate.ts` HER istekte bunu çağırır — sonuç asla
 * cache'lenmez (in-memory bayrak YOK, durum-türevli kapanış).
 */
export function isSetupModeActive(): boolean {
  return loadSetupToken() !== null && isActiveTenantIncomplete();
}

/**
 * Sabit-zamanlı (timing-safe) token doğrulama — naive `===` YASAK (Faz 0
 * şartı). `crypto.timingSafeEqual` FARKLI UZUNLUKTA buffer'larda THROW eder;
 * bunu doğrudan ham token'lara uygulamak hem bu throw riskini taşır hem de
 * "uzunluk eşleşmedi" bilgisinin kendisi (erken dönüş/throw) bir zamanlama
 * yan-kanalı olabilir. Bunun yerine HER İKİ token'ı da sabit-uzunluklu
 * (32 bayt) bir SHA-256 digest'e indirger, `timingSafeEqual`'i DAİMA eşit
 * uzunlukta iki buffer üzerinde (throw'suz, girdi uzunluğundan bağımsız
 * sabit maliyetle) çalıştırır.
 */
export function verifySetupToken(candidate: string | null | undefined): boolean {
  const expected = loadSetupToken();
  if (expected === null || !candidate) return false;
  const expectedDigest = crypto.createHash("sha256").update(expected, "utf8").digest();
  const candidateDigest = crypto.createHash("sha256").update(candidate, "utf8").digest();
  return crypto.timingSafeEqual(expectedDigest, candidateDigest);
}
