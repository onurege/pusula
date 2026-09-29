/**
 * Kodsuz tenant onboarding'in ÇEKİRDEK servis katmanı (Faz A Dalga 1) —
 * `apps/api/src/server.ts`'teki `/api/admin/config/tenant*` uçları bu dosyayı
 * çağırır, kendileri parse/dön dışında mantık taşımaz (`customer-breakdown-
 * config-service.ts` ile AYNI ince-controller disiplini).
 *
 * GÜVENLİK sözleşmesi:
 *   1. `assertValidTenantId` — path traversal savunması (Faz 0 C-1), kaydetme/
 *      silmeden ÖNCE, disk hiç görülmeden.
 *   2. Zorunlu-alan doğrulaması (`validateTenantDefinitionInput`) — eksik/boş
 *      alanla diske hiçbir şey yazılmaz (fail-closed, `LiveSchemaValidation
 *      Error`'ın bu dalgadaki karşılığı: `TenantValidationError`). Bu dalgada
 *      "canlı-şema" doğrulaması YOK — kimlik verisi (displayName/labels/…)
 *      DB'ye karşı doğrulanacak bir şey değil; dimensions/dbCredentials'ın
 *      canlı-şema kontrolü zaten `{customer,product,region}-breakdown-
 *      config-service.ts`'te var ve bu tenant için de AYNEN çalışır.
 *   3. REGISTRY-çakışma koruması — `id` zaten derleme-zamanı `REGISTRY`'de
 *      (pernod/pernod-demo/fmcg-demo/wietnauer) ise kayıt REDDEDİLİR: REGISTRY
 *      her zaman birincil olduğu için (`getTenantConfig()` additive fallback,
 *      `tenant/index.ts`) o id için yazılan bir tanım ASLA okunmaz — sessiz
 *      "ölü yazım" kullanıcıyı yanıltır (kimliği değiştirdiğini sanıp aslında
 *      hiçbir şeyin değişmediği bir duruma düşer).
 *   4. Kaydetme SIRASI: doğrula → `saveTenantDefinition` (atomik) → SENKRON
 *      `clearTenantCache()` → audit. Doğrulama başarısız olursa hiçbiri
 *      çalışmaz.
 *   5. Server-otoriter tenant: `id` yalnız BU dosyanın hedef aldığı
 *      tenant-tanım DOSYASINI seçer — aktif tenant'ı (`process.env.TENANT`)
 *      ASLA değiştirmez. `getActiveTenantDefinitionMeta()` (GET) hiçbir
 *      parametre almaz, DAİMA `getTenantConfig().id` okur.
 */
import type { Industry, TaxToggle, TenantConfig, TenantLabels } from "./types";
import { assertValidTenantId } from "./tenant-id";
import {
  getTenantDefinition,
  saveTenantDefinition,
  resetTenantDefinition,
  type TenantDefinition,
  type TenantDefinitionInput,
} from "./tenant-definition-store";
import { buildTenantFromDefinition, getTenantConfig, clearTenantCache, listTenantIds } from "./index";
import { recordConfigAudit } from "./audit-log";

// `TenantDefinition`/`TenantDefinitionInput` burada TEKRAR export edilmez —
// `tenant-definition-store.ts` zaten `@enroute/core`'un kök `index.ts`'inden
// `export *` ile dışa açık (aynı isimle iki kez `export *` etmek gereksiz
// tekrar, Metz DRY).

/** `LiveSchemaValidationError`'ın bu servisteki karşılığı — canlı-şema değil,
 *  girdi (zorunlu alan/id/REGISTRY-çakışma) doğrulaması başarısız olduğunda. */
export class TenantValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "TenantValidationError";
  }
}

const REQUIRED_LABEL_FIELDS: (keyof TenantLabels)[] = [
  "morningHeadline",
  "channelTypeTitle",
  "channelTypeSource",
  "mapEmptyDataSource",
  "kpiSourceNote",
  "volumeMultiplierHint",
];

const VALID_INDUSTRIES: Industry[] = ["alcohol", "fmcg"];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Girdiyi doğrular; sorun varsa TÜM sorunları toplayıp TEK bir
 * `TenantValidationError` fırlatır (kullanıcı formu tek turda düzeltebilsin
 * diye — ilk hatada durup art arda 400 almasın). Geçerse `input`'u AYNEN
 * döner (normalize etmez — id zaten `assertValidTenantId`'den geçmiş sayılır,
 * çağıran onu ayrıca çağırır).
 */
export function validateTenantDefinitionInput(input: TenantDefinitionInput): TenantDefinitionInput {
  const issues: string[] = [];

  try {
    assertValidTenantId(input.id);
  } catch (err) {
    issues.push((err as Error).message);
  }

  if (!isNonEmptyString(input.displayName)) issues.push("displayName zorunlu (boş olamaz).");

  if (!VALID_INDUSTRIES.includes(input.industry)) {
    issues.push(`industry "alcohol" ya da "fmcg" olmalı, gelen: ${JSON.stringify(input.industry)}.`);
  }

  if (!Array.isArray(input.strategicBrands) || input.strategicBrands.length === 0) {
    issues.push("strategicBrands en az 1 marka içeren bir dizi olmalı.");
  } else if (!input.strategicBrands.every(isNonEmptyString)) {
    issues.push("strategicBrands içindeki her marka boş olmayan bir string olmalı.");
  }

  if (!input.labels || typeof input.labels !== "object") {
    issues.push("labels zorunlu.");
  } else {
    for (const field of REQUIRED_LABEL_FIELDS) {
      if (!isNonEmptyString(input.labels[field])) issues.push(`labels.${field} zorunlu (boş olamaz).`);
    }
  }

  if (!input.tax || typeof input.tax !== "object") {
    issues.push("tax zorunlu.");
  } else {
    const tax = input.tax as TaxToggle;
    if (!isNonEmptyString(tax.key)) issues.push("tax.key zorunlu (boş olamaz).");
    if (typeof tax.label !== "string") issues.push("tax.label string olmalı.");
    if (typeof tax.showInToggle !== "boolean") issues.push("tax.showInToggle boolean olmalı.");
  }

  if (input.logoMark !== undefined && !isNonEmptyString(input.logoMark)) {
    issues.push("logoMark verilirse boş olmayan bir string olmalı.");
  }

  // REGISTRY-çakışma koruması — bkz. dosya-üstü güvenlik notu #3. `id`
  // geçersizse yukarıda zaten issue eklendi; burada YİNE de kontrol etmek
  // zararsız (REGISTRY id'leri zaten geçerli formatta).
  if (isNonEmptyString(input.id) && listTenantIds().includes(input.id)) {
    issues.push(
      `id "${input.id}" zaten derleme-zamanı REGISTRY'de kayıtlı — bu tanım ASLA okunmaz ` +
        "(REGISTRY her zaman birincil, additive fallback yalnız REGISTRY-miss'te devreye girer). " +
        "Farklı bir id seçin.",
    );
  }

  if (issues.length > 0) {
    throw new TenantValidationError(`[tenant-config] Geçersiz tenant tanımı: ${issues.join(" ")}`, issues);
  }
  return input;
}

// ---------------------------------------------------------------------------
// GET — aktif tenant'ın kimlik tanımı (server-otoriter, parametresiz)
// ---------------------------------------------------------------------------

export type ActiveTenantDefinitionMeta = {
  tenantId: string;
  /** true ise aktif tenant derleme-zamanı REGISTRY'den geliyor — bu dosyanın
   *  yönettiği store BU id için devre dışı (yazılsa bile asla okunmaz). */
  registryManaged: boolean;
  /** Yalnız `registryManaged === false` VE bir store kaydı varsa dolu. */
  definition: TenantDefinition | null;
  /** `definition` doluysa `buildTenantFromDefinition` önizlemesi. */
  config: TenantConfig | null;
};

/**
 * Aktif tenant'ın (DAİMA `getTenantConfig().id` — istemci hiçbir tenant
 * seçemez) kimlik tanımını döner. REGISTRY-yönetimli bir tenant için
 * `definition`/`config` her zaman `null` (o id için store zaten okunmuyor).
 */
/**
 * `id`'nin aktif tenant'la (`getTenantConfig().id`) eşleşip eşleşmediğini
 * döner — admin panel `/api/admin/config/tenant` POST'unun (Security LOW,
 * Faz A Dalga 2 sertleştirme) "yalnız aktif tenant düzenlenebilir" kısıtı.
 * Aktif tenant dışında keyfi bir id'nin tanım dosyasını yazabilmek (Dalga
 * 1'de mümkündü) bir admin'in, aslında hiç etkilemediği "hayalet" bir
 * tenant'ı düzenlediğini sanmasına yol açar.
 *
 * Setup akışı (`/api/setup/tenant`) BUNU KULLANMAZ — aktif tenant henüz
 * TANIMLI olmayabilir (tam olarak setup modunun var olma sebebi); id orada
 * zaten `resolveActiveTenantId()` ile server tarafında üretilir, bu
 * karşılaştırmaya hiç girmeden.
 */
export function isActiveTenantId(id: string): boolean {
  return id === getTenantConfig().id;
}

export function getActiveTenantDefinitionMeta(): ActiveTenantDefinitionMeta {
  const tenantId = getTenantConfig().id;
  const registryManaged = listTenantIds().includes(tenantId);
  if (registryManaged) {
    return { tenantId, registryManaged: true, definition: null, config: null };
  }
  const definition = getTenantDefinition(tenantId);
  return {
    tenantId,
    registryManaged: false,
    definition,
    config: definition ? buildTenantFromDefinition(definition) : null,
  };
}

// ---------------------------------------------------------------------------
// POST — tenant tanımını KAYDET (create ilk yazım, update mevcut kaydın üstüne)
// ---------------------------------------------------------------------------

export type SaveTenantDefinitionDeps = {
  /** Session'dan gelen admin username — client body'sinden ASLA. */
  actor: string;
  input: TenantDefinitionInput;
};

/**
 * Tenant tanımını doğrula → atomik yaz → SENKRON `clearTenantCache()` →
 * audit. `input.id` YALNIZ hangi tanım dosyasının yazılacağını seçer —
 * aktif tenant'ı (`process.env.TENANT`) DEĞİŞTİRMEZ (dosya-üstü not #5).
 *
 * Dönen `TenantConfig`, `buildTenantFromDefinition`'ın çıktısıdır — admin
 * panelin "kaydedilen tenant böyle görünecek" önizlemesi için.
 */
export async function saveTenantDefinitionOverride(deps: SaveTenantDefinitionDeps): Promise<TenantConfig> {
  const { actor, input } = deps;
  validateTenantDefinitionInput(input); // fail-closed — throw ederse hiçbir şey yazılmaz
  const id = assertValidTenantId(input.id);

  const existing = getTenantDefinition(id);
  const now = new Date().toISOString();
  const def: TenantDefinition = { ...input, id, updatedAt: now, updatedBy: actor };

  await saveTenantDefinition(def);
  clearTenantCache(); // Faz 0 şart: kaydet sonrası çağrılmalı (index.ts:86)

  await recordConfigAudit({
    tenantId: id,
    actor,
    action: existing ? "update-tenant" : "create-tenant",
    field: "tenant-definition",
    oldValue: existing,
    newValue: def,
  });

  return buildTenantFromDefinition(def);
}

// ---------------------------------------------------------------------------
// POST reset — tenant tanım dosyasını KALDIR
// ---------------------------------------------------------------------------

export type ResetTenantDefinitionDeps = {
  id: string;
  actor: string;
};

/** Tanım dosyasını siler (idempotent) → invalidate → audit. REGISTRY-yönetimli
 *  bir id için store'da zaten hiçbir şey yoktur — no-op, güvenle çağrılabilir. */
export async function resetTenantDefinitionOverride(deps: ResetTenantDefinitionDeps): Promise<void> {
  const { actor } = deps;
  const id = assertValidTenantId(deps.id);
  const existing = getTenantDefinition(id);

  await resetTenantDefinition(id);
  clearTenantCache();

  await recordConfigAudit({
    tenantId: id,
    actor,
    action: "reset",
    field: "tenant-definition",
    oldValue: existing,
    newValue: null,
  });
}
