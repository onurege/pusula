/**
 * Çok-DB (login'de DB seçimi) konfigüratör servisi — admin panelden KODSUZ
 * yönetim. Aynı sunucu/kimlik, farklı `database`; liste sır DEĞİL (yalnız
 * etiket + DB adı), bu yüzden `mapping-store`'da DÜZ saklanır (dosyanın kendisi
 * zaten 0600 + web-root dışı + `.gitignore`). Doğrulama tek yerde
 * (`databases.ts` `validateDatabaseList`).
 *
 * Kayıt SONRASI çağıran (admin endpoint) `closePool()` çağırmalı — mevcut
 * havuzlar `${prefix}::${dbId}` anahtarlı; bir dbId'nin `database` adı
 * değişirse eski havuz taze creds'i yakalamaz (`db.ts getPool()` sözleşmesi,
 * `saveDbConnectionOverride` ile aynı desen).
 */
import { getMappingOverride, setMappingOverride } from "./mapping-store";
import { validateDatabaseList } from "./databases";
import { recordConfigAudit } from "./audit-log";
import type { TenantDatabase } from "./types";

/** Kayıtlı çok-DB listesi (store override). Yoksa boş dizi. */
export function getDatabasesConfig(tenantId: string): TenantDatabase[] {
  return getMappingOverride(tenantId)?.databases ?? [];
}

export type SaveDatabasesDeps = {
  tenantId: string;
  actor: string;
  /** Ham admin girdisi — `validateDatabaseList` doğrular/normalize eder. */
  databases: unknown;
};

/**
 * Çok-DB listesini store'a yazar. Diğer alanlar (`dimensions`,
 * `dbCredentials`) DOKUNULMADAN korunur. Boş liste → alanı KALDIRIR (çok-DB
 * kapanır, env fallback'e döner). Geçersiz girdi → THROW (fail-closed).
 * Döndürdüğü normalize edilmiş liste, çağıranın yanıtta göstermesi için.
 */
export async function saveDatabasesOverride(deps: SaveDatabasesDeps): Promise<TenantDatabase[]> {
  const { tenantId, actor } = deps;
  const validated = validateDatabaseList(deps.databases);
  const current = getMappingOverride(tenantId);

  await setMappingOverride(tenantId, {
    ...current,
    databases: validated.length > 0 ? validated : undefined,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  });

  await recordConfigAudit({
    tenantId,
    actor,
    action: "save",
    field: "databases",
    oldValue: current?.databases ?? [],
    newValue: validated,
  });

  return validated;
}
