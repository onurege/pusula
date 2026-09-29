/**
 * Müşteri kırılımı konfigüratörünün ÇEKİRDEK servis katmanı — Hono
 * endpoint'leri (apps/api) bu dosyayı çağırır, kendileri parse/dön dışında
 * mantık taşımaz (Metz/Fowler ince-controller disiplini; bkz. görev
 * talimatı "Mimari disiplin").
 *
 * Her fonksiyon DB'ye `RunReadOnlyFn` enjeksiyonuyla erişir (`db.ts`
 * `runReadOnly`'nin production wiring'i endpoint tarafında yapılır) —
 * gerçek MSSQL'e bağlanmadan mock'la unit-testlenebilir.
 *
 * GÜVENLİK sözleşmesi (Faz 0 veto şartları, hepsi burada TEK yerde toplanır):
 *   1. Allowlist doğrulaması: `resolveCustomerBreakdown()` (regex + küratörlü
 *      liste) — kaydetmeden ÖNCE, DB'ye hiç gitmeden.
 *   2. Canlı şema doğrulaması: `verifyCandidateLive()` — allowlist geçse bile
 *      tablo/kolon o MSSQL'de GERÇEKTEN yoksa (curator hatası, ortam farkı)
 *      kaydetme REDDEDİLİR.
 *   3. Kaydetme SIRASI: doğrula → `setMappingOverride` (atomik) → SENKRON
 *      `invalidateCustomerBreakdownCaches()` → audit. Doğrulama başarısız
 *      olursa hiçbiri çalışmaz (fail-closed, bozuk config diske hiç değmez).
 */
import type { CustomerBreakdownDimension } from "./types";
import { resolveCustomerBreakdown, type CustomerBreakdownMeta } from "./identifier";
import { CUSTOMER_BREAKDOWN_CANDIDATES, type CustomerBreakdownCandidate } from "./customer-breakdown-candidates";
import {
  computeMatchRate,
  previewSampleValues,
  verifyCandidateLive,
  isLiveCheckSavable,
  LiveSchemaValidationError,
  type CandidateLiveCheck,
  type MatchRateResult,
  type RunReadOnlyFn,
} from "./schema-check";
import { getMappingConfig, getCustomerBreakdownMeta } from "./index";
import { setMappingOverride, resetCustomerBreakdownOverride as resetOverrideOnDisk } from "./mapping-store";
import { invalidateCustomerBreakdownCaches } from "./cache-invalidation";
import { recordConfigAudit } from "./audit-log";

// ---------------------------------------------------------------------------
// GET .../customer-breakdown — mevcut meta + küratörlü aday listesi (canlı VAR/YOK)
// ---------------------------------------------------------------------------

export type CandidateWithLiveStatus = CustomerBreakdownCandidate & {
  live: CandidateLiveCheck;
};

/**
 * `meta`'yı hata mesajlarında insan-okunabilir kılan mode-branch — tek-hop
 * "table"/"joinColumn"/"labelColumn" üçlüsü, iki-hop (`"eksaha-two-hop"`)
 * köprü+lookup dörtlüsü (union'ın hangi alan setini taşıdığı mode'a göre
 * değişir — bkz. `identifier.ts` `CustomerBreakdownMeta`).
 */
function describeCustomerBreakdownMeta(meta: CustomerBreakdownMeta): string {
  if (meta.mode === "eksaha-two-hop") {
    return `${meta.bridgeTable}→${meta.lookupTable} (saha ${meta.sahaKods.join("/")}, ad ${meta.labelColumn})`;
  }
  return `${meta.table}/${meta.joinColumn}/${meta.labelColumn}`;
}

export type CustomerBreakdownConfigMeta = {
  current: CustomerBreakdownMeta;
  candidates: CandidateWithLiveStatus[];
};

/**
 * Mevcut aktif kırılımı + tüm küratörlü adayların canlı VAR/YOK durumunu
 * döner. Canlı kontrol adaylar arasında PARALEL çalışır (N ayrı sıralı
 * round-trip yerine tek `Promise.all`) — admin panel açılışını yavaşlatmaz.
 */
export async function getCustomerBreakdownConfigMeta(run: RunReadOnlyFn): Promise<CustomerBreakdownConfigMeta> {
  const current = getCustomerBreakdownMeta();
  const candidates = await Promise.all(
    CUSTOMER_BREAKDOWN_CANDIDATES.map(async (candidate) => ({
      ...candidate,
      live: await verifyCandidateLive(run, candidate),
    })),
  );
  return { current, candidates };
}

// ---------------------------------------------------------------------------
// POST .../customer-breakdown/preview — seçilen aday için canlı önizleme
// ---------------------------------------------------------------------------

export type CustomerBreakdownPreview = {
  meta: CustomerBreakdownMeta;
  live: CandidateLiveCheck;
  /** `live.tableExists`/`joinColumnExists`/`labelColumnExists` hepsi true
   *  değilse örnekleme/match-rate DENENMEZ (var olmayan kolondan SELECT
   *  atmak yalnız gürültülü bir hata üretir) — bu alanlar `null` kalır. */
  sampleValues: string[] | null;
  matchRate: MatchRateResult | null;
};

/**
 * Bir adayı KAYDETMEDEN önce canlı önizler: örnek değerler + eşleşme oranı +
 * tip-uyum bayrağı. Girdi ÖNCE `resolveCustomerBreakdown` ile doğrulanır —
 * allowlist dışı bir değer burada da (yalnız kaydetmede değil) THROW eder,
 * böylece admin panel "önizle" adımında bile enjeksiyon yüzeyi kapalı kalır.
 */
export async function previewCustomerBreakdownCandidate(
  run: RunReadOnlyFn,
  input: CustomerBreakdownDimension,
  sampleLimit = 10,
): Promise<CustomerBreakdownPreview> {
  const meta = resolveCustomerBreakdown(input); // fail-closed — THROW ederse endpoint 400 döner
  const live = await verifyCandidateLive(run, meta);
  if (!isLiveCheckSavable(live)) {
    return { meta, live, sampleValues: null, matchRate: null };
  }
  const [sampleValues, matchRate] = await Promise.all([
    previewSampleValues(run, meta, sampleLimit),
    computeMatchRate(run, meta),
  ]);
  return { meta, live, sampleValues, matchRate };
}

// ---------------------------------------------------------------------------
// POST .../customer-breakdown — override KAYDET (allowlist + canlı-şema → yaz → invalidate → audit)
// ---------------------------------------------------------------------------

export type SaveCustomerBreakdownDeps = {
  run: RunReadOnlyFn;
  tenantId: string;
  /** Session'dan gelen admin username — client body'sinden ASLA. */
  actor: string;
  input: CustomerBreakdownDimension;
};

// `LiveSchemaValidationError` artık `schema-check.ts`'te tanımlı (Faz B —
// product/region konfigüratör servisleriyle PAYLAŞILAN ortak hata tipi,
// `instanceof` kontrolünün üç servis için de AYNI class kimliğiyle çalışması
// için); burada yalnız geriye-uyum için re-export edilir (mevcut import
// yolu `from "./customer-breakdown-config-service"` kırılmasın diye).
export { LiveSchemaValidationError };

/**
 * Müşteri kırılımı override'ını kaydeder. Sıra KESİNLİKLE şu şekilde
 * (bkz. dosya üstü güvenlik sözleşmesi):
 *   1. `resolveCustomerBreakdown` — allowlist (DB'ye hiç gitmeden fail-fast).
 *   2. `verifyCandidateLive` — canlı şema; başarısızsa THROW, hiçbir şey
 *      yazılmaz (bozuk config diske değmez — Database D2 veto şartı).
 *   3. `setMappingOverride` — atomik disk yazımı (mevcut `dbCredentials` gibi
 *      diğer override alanları KORUNUR).
 *   4. `invalidateCustomerBreakdownCaches()` — SENKRON, yazımdan HEMEN SONRA
 *      (bir sonraki istek bayat cache'ten değil taze eşlemeden okur).
 *   5. `recordConfigAudit` — kim/ne zaman/eski→yeni.
 */
export async function saveCustomerBreakdownOverride(deps: SaveCustomerBreakdownDeps): Promise<void> {
  const { run, tenantId, actor, input } = deps;

  const meta = resolveCustomerBreakdown(input);

  const live = await verifyCandidateLive(run, meta);
  if (!isLiveCheckSavable(live)) {
    throw new LiveSchemaValidationError(
      `[customer-breakdown] "${describeCustomerBreakdownMeta(meta)}" canlı şemada doğrulanamadı ` +
        `(tableExists=${live.tableExists}, joinColumnExists=${live.joinColumnExists}, labelColumnExists=${live.labelColumnExists}). ` +
        "Kayıt reddedildi — bozuk eşleme diske yazılmadı.",
      live,
    );
  }

  const oldValue = getMappingConfig().dimensions.customerBreakdown;

  await setMappingOverride(tenantId, {
    dimensions: { customerBreakdown: meta },
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  });

  invalidateCustomerBreakdownCaches();

  await recordConfigAudit({
    tenantId,
    actor,
    action: "save",
    field: "dimensions.customerBreakdown",
    oldValue,
    newValue: meta,
  });
}

// ---------------------------------------------------------------------------
// POST .../customer-breakdown/reset — override'ı sil (varsayılana dön)
// ---------------------------------------------------------------------------

export type ResetCustomerBreakdownDeps = {
  tenantId: string;
  actor: string;
};

/** Override'ı kaldırır (config dosyasındaki default'a döner) → invalidate → audit. */
export async function resetCustomerBreakdownOverride(deps: ResetCustomerBreakdownDeps): Promise<void> {
  const { tenantId, actor } = deps;
  const oldValue = getMappingConfig().dimensions.customerBreakdown;

  await resetOverrideOnDisk(tenantId);
  invalidateCustomerBreakdownCaches();

  const newValue = getMappingConfig().dimensions.customerBreakdown;
  await recordConfigAudit({
    tenantId,
    actor,
    action: "reset",
    field: "dimensions.customerBreakdown",
    oldValue,
    newValue,
  });
}
