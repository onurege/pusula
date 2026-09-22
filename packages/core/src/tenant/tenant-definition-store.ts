/**
 * Runtime tenant-KİMLİĞİ store'u — kodsuz tenant onboarding'in Faz A Dalga 1
 * çekirdeği (bkz. `/Users/egeusluer/Documents/atlas/reports/
 * phase0-tenant-onboarding.md`).
 *
 * Neden AYRI dosya/store (`mapping-store.ts`'e karıştırılmaz):
 *   - `mapping-store.ts` müşteri/ürün/bölge KIRILIM boyutlarını ve ŞİFRELİ
 *     DB kimlik bilgilerini tutar — SIR içerir (AES-256-GCM).
 *   - Bu store tenant'ın KENDİ KİMLİĞİNİ (id/displayName/labels/
 *     strategicBrands/industry/tax) tutar — SIR DEĞİL, şifrelemeye gerek yok.
 *   Aynı dosyaya karıştırmak iki farklı güvenlik sınıfını (identity vs.
 *   secret) tek bir yazım/okuma yoluna bağlar — Faz 0 tasarım kararı bunu
 *   AÇIKÇA reddetti (ayrı registry dosyası: `data/tenant-def.<id>.json`).
 *
 * Desen `mapping-store.ts`'ten KOPYALANDI (import EDİLMEDİ — iki store farklı
 * tipte veri taşır, `writeAtomic`/`writeQueue` fonksiyonlarını paylaşmak
 * yanlış bir soyutlamaya (Metz) yol açardı): 0600 dosya izni + atomik yazım
 * (`tmp` + `renameSync`) + process-içi kuyrukla serialize edilen eşzamanlı
 * yazımlar. `repoRoot()` kök-çözümü DRY olarak `mapping-store.ts`'ten
 * import edilir (saf bir dosya-sistemi yardımcı fonksiyonu, store DEĞİL —
 * `audit-log.ts` de aynı şekilde reuse eder).
 *
 * GÜVENLİK (Faz 0 C-1 CRITICAL): dosya yolu HER ZAMAN `tenant-id.ts`
 * `assertValidTenantId` + `assertConfinedToDataDir`'den geçer — path
 * traversal denemesi (id içinde `..`/`/`/`\\`) dosya sistemine ulaşmadan
 * THROW eder (fail-closed).
 *
 * Bu dosya YALNIZ okuma/yazma ALTYAPISI — doğrulama (zorunlu alan kontrolü,
 * REGISTRY-çakışması) ve audit-trail servis katmanında
 * (`tenant-config-service.ts`); `getTenantConfig()`'in additive fallback
 * kablosu `tenant/index.ts`'te.
 */
import fs from "node:fs";
import path from "node:path";
import type { Industry, TaxToggle, TenantLabels } from "./types";
import { assertConfinedToDataDir, assertValidTenantId } from "./tenant-id";
import { repoRoot } from "./mapping-store";

/**
 * Kurulumcunun girdiği minimum alan kümesi (Faz 0 "Kapsam — minimum tenant").
 * Geri kalan `TenantConfig` alanları `buildTenantFromDefinition()`
 * (`tenant/index.ts`) tarafından Panorama-varsayılanlarından türetilir.
 */
export type TenantDefinitionInput = {
  /** `tenant-id.ts` `TENANT_ID_PATTERN`'e uymalı — dosya adına gömülür. */
  id: string;
  displayName: string;
  industry: Industry;
  strategicBrands: string[];
  /** Tüm alanlar zorunlu — sektöre/müşteriye özel metin, türetilemez. */
  labels: TenantLabels;
  tax: TaxToggle;
  /** Tanımsızsa `buildTenantFromDefinition` id'nin ilk 2 harfini kullanır. */
  logoMark?: string;
};

/** Diskte saklanan tam kayıt — girdi + audit-benzeri iz (kim/ne zaman). */
export type TenantDefinition = TenantDefinitionInput & {
  updatedAt: string;
  updatedBy?: string;
};

function dataDir(): string {
  return path.join(repoRoot(), "data");
}

function storeFilePath(tenantId: string): string {
  const id = assertValidTenantId(tenantId);
  const dir = dataDir();
  return assertConfinedToDataDir(path.join(dir, `tenant-def.${id}.json`), dir);
}

// ---------------------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------------------

/**
 * Kayıtlı tenant tanımı — yoksa/bozuksa/id geçersizse `null` (çağıran REGISTRY
 * fallback'e ya da fail-closed throw'a düşer; bu fonksiyonun kendisi asla
 * throw etmez — okuma yolu her zaman sakin bir "yok" sonucu üretir).
 */
export function getTenantDefinition(tenantId: string): TenantDefinition | null {
  let file: string;
  try {
    file = storeFilePath(tenantId);
  } catch (err) {
    console.warn(`[tenant-definition-store] geçersiz tenant id "${tenantId}" — tanım yok sayılıyor.`, err);
    return null;
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as TenantDefinition;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn(`[tenant-definition-store] "${file}" okunamadı/bozuk — tanım yok sayılıyor.`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Yazma — atomik + serialize (mapping-store.ts deseninin KOPYASI)
// ---------------------------------------------------------------------------

let writeQueue: Promise<unknown> = Promise.resolve();

function writeAtomic(def: TenantDefinition): void {
  const file = storeFilePath(def.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(def, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // writeFileSync'in mode'u umask'e tabi olabilir — garanti et
  fs.renameSync(tmp, file); // aynı dosya sistemi içinde atomik — torn write yok
  fs.chmodSync(file, 0o600);
}

function validateThenWrite(def: TenantDefinition): void {
  // Defense-in-depth — servis katmanı (`tenant-config-service.ts`) zaten
  // `assertValidTenantId` + zorunlu-alan doğrulamasını kaydetmeden ÖNCE
  // çalıştırır; burada TEKRAR doğrulamak `mapping-store.ts`'in
  // `validateThenWrite`'ıyla AYNI ilkeyi izler (bozuk veri diske hiç değmez).
  assertValidTenantId(def.id);
  writeAtomic(def);
}

/**
 * Tenant tanımını doğrula (id) ve ATOMİK yaz. Eşzamanlı çağrılar bir kuyrukta
 * sıraya girer — iki admin'in aynı anda kaydetmesi torn-write üretmez.
 */
export function saveTenantDefinition(def: TenantDefinition): Promise<void> {
  const task = writeQueue.then(
    () => validateThenWrite(def),
    () => validateThenWrite(def), // önceki yazım başarısız olsa da bu yazım denenir
  );
  writeQueue = task.catch(() => undefined);
  return task;
}

// ---------------------------------------------------------------------------
// Reset — tenant tanım dosyasını KALDIRIR
// ---------------------------------------------------------------------------

function deleteFileIfExists(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function resetThenWrite(tenantId: string): void {
  deleteFileIfExists(storeFilePath(tenantId));
}

/**
 * Tenant tanım dosyasını siler (idempotent — zaten yoksa no-op). Diğer
 * yazımlarla AYNI `writeQueue`'da serialize edilir.
 */
export function resetTenantDefinition(tenantId: string): Promise<void> {
  const task = writeQueue.then(
    () => resetThenWrite(tenantId),
    () => resetThenWrite(tenantId),
  );
  writeQueue = task.catch(() => undefined);
  return task;
}
