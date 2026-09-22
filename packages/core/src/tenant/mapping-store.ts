/**
 * Runtime config override store — Insider konfigüratörünün admin panelden
 * kaydettiği tenant-bazlı override katmanı (Faz A: müşteri kırılımı boyutu;
 * Faz B: dist/marka + şifreli DB bağlantı bilgisi).
 *
 * Neden ayrı store: `tenant/configs/*.ts` derleme-zamanı sabit — kod
 * değiştirmeden yeni müşteri kuramayız (bu konfigüratörün TÜM amacı). Bu
 * dosya, o default'ların ÜSTÜNE runtime'da bindirilen bir katman tutar
 * (bkz. `getMappingConfig()`, `./index.ts`).
 *
 * Güvenlik (Faz 0 H1 / B2 bulguları — bu ikisinin düzeltilmiş hâli):
 *   - Olası DB parolası alanları AES-256-**GCM** ile şifreli tutulur
 *     (rastgele 12 bayt IV + 16 bayt auth tag); anahtar `CONFIG_ENC_KEY`
 *     env'den. `auth.ts`'teki AES-128-**ECB** helper'ı (IV'siz, auth'suz,
 *     kırık — H1) KASITLI OLARAK reuse edilmedi.
 *   - Dosya web-root DIŞINDA — `data/` (mevcut `perms.<tenant>.json` ve
 *     SQLite mirror deseniyle aynı dizin; statik olarak servis edilmez),
 *     mod **0600**, `.gitignore`'da.
 *   - Yazım ATOMİK: temp dosyaya yaz + `fs.renameSync` (aynı dosya
 *     sisteminde atomik — torn write yok). Eşzamanlı yazımlar process-içi
 *     bir kuyrukla serialize edilir. `user-perms.ts`'in kilitsiz
 *     read-mutate-write deseni BİLİNÇLİ OLARAK kopyalanmadı (B2).
 *
 * Bu dalga yalnız store'un okuma/yazma + şifreleme ALTYAPISINI kurar; admin
 * endpoint'i (yazan taraf, kaydetme-anında `resolveIdentifier` validasyonu
 * ve audit-trail) Dalga 2'de gelecek.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { CustomerBreakdownDimension, ProductBreakdownDimension, RegionBreakdownDimension, TenantDatabase } from "./types";
import { resolveCustomerBreakdown, resolveProductBreakdown, resolveRegionBreakdown } from "./identifier";
import { assertConfinedToDataDir, assertValidTenantId } from "./tenant-id";

// ---------------------------------------------------------------------------
// Dosya konumu — user-perms.ts ile aynı repo-kök çözümü
// ---------------------------------------------------------------------------

let cachedRoot: string | null = null;

/** cwd'den yukarı yürüyerek monorepo kökünü bul (apps + packages içeren dizin).
 *  `audit-log.ts` da aynı kök çözümünü kullanır — tek yerde tutulur (DRY). */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "apps")) && fs.existsSync(path.join(dir, "packages"))) {
      cachedRoot = dir;
      return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

/** `data/` zaten web-root dışı (perms/SQLite mirror ile aynı dizin, statik
 *  sunuma açık değil) — buraya tenant başına tek şifreli dosya yazılır.
 *
 * Faz A Dalga 1 (Security C-1 CRITICAL): `tenantId` doğrulanmadan burada
 * dosya yoluna interpolate ediliyordu — bir tenant-create akışından gelen
 * kurcalanmış id (`"../../etc/passwd"` vb.) path traversal'a açardı. Bu TEK
 * yerde (`storeFilePath`) doğrulama, `getMappingOverride`/`writeAtomic`/
 * `deleteFileIfExists` dahil dosya yolu üreten HER çağrıyı otomatik korur —
 * çağıranların kendi validasyonunu tekrarlamasına gerek yok. İkinci katman
 * (`assertConfinedToDataDir`) regex'ten bağımsız savunma-derinliği. */
function storeFilePath(tenantId: string): string {
  const id = assertValidTenantId(tenantId);
  const dataDir = path.join(repoRoot(), "data");
  return assertConfinedToDataDir(path.join(dataDir, `tenant-config.${id}.enc.json`), dataDir);
}

// ---------------------------------------------------------------------------
// Şifreleme — AES-256-GCM
// ---------------------------------------------------------------------------

export type EncryptedField = { iv: string; tag: string; ciphertext: string };

/** `CONFIG_ENC_KEY`'i hex (64 karakter) ya da base64 olarak 32 bayta çevirir.
 *  Eksik/hatalı anahtarla FAIL-CLOSED — auth.ts'teki demo-moda düşme deseni
 *  burada BİLİNÇLİ OLARAK yok (bu parola, DB kimlik bilgisi — sessiz düşüş
 *  kabul edilemez). */
function loadEncKey(): Buffer {
  const raw = process.env.CONFIG_ENC_KEY;
  if (!raw) {
    throw new Error(
      "CONFIG_ENC_KEY tanımsız — şifreli config alanları (DB parolası) okunamaz/yazılamaz. " +
        "`openssl rand -base64 32` ile üretip .env'e ekleyin.",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    /* aşağıda throw edilecek */
  }
  throw new Error(
    "CONFIG_ENC_KEY geçersiz — AES-256 için tam 32 bayt gerekir; 64 karakter hex ya da 32 bayta çözülen base64 verin.",
  );
}

/** AES-256-GCM ile şifrele — her çağrıda taze rastgele IV. */
export function encryptSecret(plaintext: string): EncryptedField {
  const key = loadEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/** Şifreli alanı çöz — auth tag uyuşmazsa (kurcalanmış/yanlış anahtar) throw eder. */
export function decryptSecret(field: EncryptedField): string {
  const key = loadEncKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(field.iv, "base64"));
  decipher.setAuthTag(Buffer.from(field.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(field.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

// ---------------------------------------------------------------------------
// Store şeması
// ---------------------------------------------------------------------------

/**
 * Tenant başına runtime override. Faz A yalnız `dimensions.customerBreakdown`
 * yazıyordu; Faz B `productBreakdown`/`regionBreakdown`'ı ekledi. `dbCredentials`
 * parola alanı DAİMA `EncryptedField` — düz metin asla diske yazılmaz.
 */
export type MappingOverride = {
  dimensions?: {
    customerBreakdown?: CustomerBreakdownDimension;
    productBreakdown?: ProductBreakdownDimension;
    regionBreakdown?: RegionBreakdownDimension;
  };
  dbCredentials?: {
    server: string;
    database: string;
    user: string;
    password: EncryptedField;
  };
  /**
   * Çok-DB (login'de DB seçimi) — aynı sunucu/kimlik, farklı `database`.
   * Kodsuz: admin konfigüratörden yönetilir (`databases-config.ts`). Sır
   * DEĞİL (yalnız etiket + DB adı) → düz saklanır. ≥2 eleman → login dropdown.
   */
  databases?: TenantDatabase[];
  /** Son yazan admin + zaman damgası — audit-trail iskeleti (Faz 0 §5). */
  updatedAt: string;
  updatedBy?: string;
};

// ---------------------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------------------

/** Kayıtlı override — yoksa/bozuksa `null` (çağıran default'a düşer). */
export function getMappingOverride(tenantId: string): MappingOverride | null {
  const file = storeFilePath(tenantId);
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as MappingOverride;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn(`[tenant/mapping-store] "${file}" okunamadı/bozuk — override yok sayılıyor.`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Yazma — atomik + serialize
// ---------------------------------------------------------------------------

// Eşzamanlı yazımları process-içi kuyrukla serialize eder — user-perms.ts'in
// kilitsiz read-mutate-write deseninin AKSİNE iki eşzamanlı admin kaydı
// birbirini ezmez (B2 "torn write"). `.catch(() => undefined)` kuyruğun
// kendisini asla reddetmeyecek şekilde tutar; her çağrının KENDİ promise'i
// (`task`) kendi başarı/hatasını çağırana doğru yansıtır.
let writeQueue: Promise<unknown> = Promise.resolve();

function writeAtomic(tenantId: string, override: MappingOverride): void {
  const file = storeFilePath(tenantId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(override, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // writeFileSync'in mode'u umask'e tabi olabilir — garanti et
  fs.renameSync(tmp, file); // aynı dosya sistemi içinde atomik — torn write yok
  fs.chmodSync(file, 0o600);
}

function validateThenWrite(tenantId: string, override: MappingOverride): void {
  // Kaydetme-anında validasyon (B2) — geçersiz boyut diske YAZILMADAN throw
  // eder; bozuk bir override asla persist edilmez. Üç boyut da bağımsız
  // doğrulanır — biri eksikse (undefined) atlanır, diğerleri yine kontrol edilir.
  if (override.dimensions?.customerBreakdown) {
    resolveCustomerBreakdown(override.dimensions.customerBreakdown);
  }
  if (override.dimensions?.productBreakdown) {
    resolveProductBreakdown(override.dimensions.productBreakdown);
  }
  if (override.dimensions?.regionBreakdown) {
    resolveRegionBreakdown(override.dimensions.regionBreakdown);
  }
  writeAtomic(tenantId, override);
}

/**
 * Override'ı doğrula (varsa `customerBreakdown`) ve ATOMİK yaz. Eşzamanlı
 * çağrılar bir kuyrukta sıraya girer; dönen promise HER ZAMAN kendi
 * çağrısının sonucunu yansıtır (validasyon hatası da dahil — throw değil,
 * reddedilen promise, böylece `await`/`.catch` her durumda tutarlı çalışır).
 */
export function setMappingOverride(tenantId: string, override: MappingOverride): Promise<void> {
  const task = writeQueue.then(
    () => validateThenWrite(tenantId, override),
    () => validateThenWrite(tenantId, override), // önceki yazım başarısız olsa da bu yazım denenir
  );
  writeQueue = task.catch(() => undefined);
  return task;
}

// ---------------------------------------------------------------------------
// Reset — yalnız `customerBreakdown`'ı override'dan çıkar (varsayılana dön)
// ---------------------------------------------------------------------------

/** ENOENT'i yok say (zaten silinmiş) — başka her hatayı yükselt. */
function deleteFileIfExists(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/** Tek bir `dimensions.<key>` override'ını KALDIRIR — diğer alanlar (diğer
 *  boyutlar, `dbCredentials`) DOKUNULMADAN kalır. Üç `reset*Override` dışa
 *  aktarılan fonksiyonun ORTAK gövdesi (Faz A tek boyutluyken tek kopyaydı;
 *  Faz B üç boyuta çoğaltmak yerine burada TEK yerde genellenir — Metz DRY). */
function resetDimensionThenWrite(tenantId: string, dimensionKey: keyof NonNullable<MappingOverride["dimensions"]>): void {
  const current = getMappingOverride(tenantId);
  if (!current) return; // zaten default — yapacak bir şey yok

  const remainingDims = current.dimensions ? { ...current.dimensions } : undefined;
  if (remainingDims) delete remainingDims[dimensionKey];
  const hasRemainingDims = !!remainingDims && Object.keys(remainingDims).length > 0;

  // Override'da başka HİÇBİR şey (dbCredentials dahil) kalmıyorsa dosyanın
  // KENDİSİNİ sil — boş `{ updatedAt: ... }` iskeleti diskte tutmanın anlamı
  // yok ve `getMappingOverride` zaten `null`'ı "override yok" sayıyor.
  if (!hasRemainingDims && !current.dbCredentials) {
    deleteFileIfExists(storeFilePath(tenantId));
    return;
  }

  writeAtomic(tenantId, {
    ...current,
    dimensions: hasRemainingDims ? remainingDims : undefined,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Verilen boyutun override'ını `setMappingOverride` ile AYNI `writeQueue`'da
 * serialize ederek sıfırlar — eşzamanlı bir kaydetme/sıfırlama çifti
 * birbirini ezmez (B2 torn-write savunması bu fonksiyon için de geçerli).
 */
function resetDimensionOverride(
  tenantId: string,
  dimensionKey: keyof NonNullable<MappingOverride["dimensions"]>,
): Promise<void> {
  const task = writeQueue.then(
    () => resetDimensionThenWrite(tenantId, dimensionKey),
    () => resetDimensionThenWrite(tenantId, dimensionKey),
  );
  writeQueue = task.catch(() => undefined);
  return task;
}

/** `customerBreakdown` override'ını KALDIRIR — tenant `dimensions.customerBreakdown`
 *  default'una (config dosyasındaki değere) döner. */
export function resetCustomerBreakdownOverride(tenantId: string): Promise<void> {
  return resetDimensionOverride(tenantId, "customerBreakdown");
}

/** `productBreakdown` override'ını KALDIRIR — tenant `dimensions.productBreakdown`
 *  default'una (config dosyasındaki değere) döner. */
export function resetProductBreakdownOverride(tenantId: string): Promise<void> {
  return resetDimensionOverride(tenantId, "productBreakdown");
}

/** `regionBreakdown` override'ını KALDIRIR — tenant `dimensions.regionBreakdown`
 *  default'una (config dosyasındaki değere) döner. */
export function resetRegionBreakdownOverride(tenantId: string): Promise<void> {
  return resetDimensionOverride(tenantId, "regionBreakdown");
}
