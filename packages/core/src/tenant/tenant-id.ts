/**
 * Tenant-id doğrulayıcı — kodsuz tenant onboarding'in path-traversal savunması
 * (Faz 0 C-1 CRITICAL: `mapping-store.ts` id'yi doğrulamadan dosya yoluna
 * koyuyordu; Dalga 1 bu boşluğu hem yeni tenant-definition store'da hem de
 * mevcut mapping-store dosya-yolu üretiminde kapatır).
 *
 * `identifier.ts`'teki `resolveIdentifier` BURADA KULLANILMAZ — o SQL bare
 * identifier'ları için tasarlandı (`^[A-Za-z0-9_]+$`, tire YASAK). Bilinen
 * tenant id'leri tire içerir ("pernod-demo", "fmcg-demo") — `resolveIdentifier`
 * bunları reddederdi. Tenant-id kendi ayrı sözleşmesine sahip: DNS-benzeri
 * slug (RFC 1123 label deseni), dosya adına güvenle gömülebilir, ".."/"/"/
 * "\\" gibi path-traversal karakterleri asla içermez.
 */
import path from "node:path";

/** DNS-label benzeri slug: küçük harf/rakam, iç kısımda tire; baş/son harf
 *  tire olamaz. 1–40 karakter. Nokta/eğik çizgi/ters eğik çizgi/NUL zaten bu
 *  karakter kümesinde YOK — aşağıdaki `assertValidTenantId` yine de bunları
 *  AYRICA (savunma-derinliği) kontrol eder (bir regex motoru hatası/bypass'ı
 *  tek başına C-1'i yeniden açmasın diye). */
export const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Tenant-id doğrulama hatası — API katmanı bunu 400'e çevirir. */
export class TenantIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIdError";
  }
}

/**
 * `id`'nin geçerli bir tenant-id olup olmadığını (tip daraltmasıyla) döner.
 * THROW ETMEZ — koşullu dallanma için (`assertValidTenantId` throw eden
 * karşılığıdır, fail-closed gereken her yerde O kullanılmalı).
 */
export function isValidTenantId(id: unknown): id is string {
  if (typeof id !== "string" || id.length === 0 || id.length > 40) return false;
  if (id.includes("\0") || id.includes("..") || id.includes("/") || id.includes("\\") || id.includes(".")) {
    return false;
  }
  return TENANT_ID_PATTERN.test(id);
}

/**
 * `id`'yi doğrular; geçersizse THROW eder (fail-closed — path traversal
 * denemesini sessizce normalize/reddetmek yerine gürültülü durdurur). Geçerse
 * `id`'yi aynen döner (çağıran zincirleme kullanabilsin diye).
 */
export function assertValidTenantId(id: unknown): string {
  if (!isValidTenantId(id)) {
    throw new TenantIdError(
      `[tenant-id] Geçersiz tenant id: ${JSON.stringify(id)} — yalnız küçük harf/rakam/tire ` +
        `(^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$), nokta/eğik çizgi/".."/NUL yasak.`,
    );
  }
  return id;
}

/**
 * Defense-in-depth: `filePath`'in `dataDir` (veya alt dizini) İÇİNDE kaldığını
 * teyit eder. `assertValidTenantId` zaten path-traversal karakterlerini
 * regex'te reddediyor — bu ikinci katman regex'ten TAMAMEN bağımsız çalışır
 * (bir regex hatası/atlaması tek başına dosya sistemine sızmasın diye).
 * İhlal varsa THROW eder; asla sessizce normalize etmez.
 */
export function assertConfinedToDataDir(filePath: string, dataDir: string): string {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(dataDir) + path.sep;
  if (!resolved.startsWith(resolvedDir)) {
    throw new TenantIdError(
      `[tenant-id] Path confinement ihlali: "${resolved}" "${dataDir}" dışında — reddedildi.`,
    );
  }
  return resolved;
}
