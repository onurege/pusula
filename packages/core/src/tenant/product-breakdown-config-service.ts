/**
 * Ürün/marka kırılımı konfigüratörünün ÇEKİRDEK servis katmanı — Hono
 * endpoint'leri (apps/api) bu dosyayı çağırır, kendileri parse/dön dışında
 * mantık taşımaz. `customer-breakdown-config-service.ts` ile AYNI güvenlik
 * sözleşmesi ve sıra — bkz. o dosyanın dosya-üstü dokümantasyonu, burada
 * TEKRAR edilmez; tek fark: ebeveyn tablo `TBLMUSTERI` değil `TBLURUN`.
 */
import type { ProductBreakdownDimension } from "./types";
import { resolveProductBreakdown, type ProductBreakdownMeta } from "./identifier";
import { PRODUCT_BREAKDOWN_CANDIDATES, type ProductBreakdownCandidate } from "./product-breakdown-candidates";
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
import { productBreakdownJoin } from "./product-breakdown-sql";
import { getMappingConfig, getProductBreakdownMeta } from "./index";
import { setMappingOverride, resetProductBreakdownOverride as resetOverrideOnDisk } from "./mapping-store";
import { invalidateProductBreakdownCaches } from "./cache-invalidation";
import { recordConfigAudit } from "./audit-log";

export { LiveSchemaValidationError };

/** Ürün/marka kırılımının ebeveyn tablosu — `joinColumn` burada yaşar. */
const PARENT_TABLE = "TBLURUN";
const PARENT_ALIAS = "u";
const LOOKUP_ALIAS = "b";

// ---------------------------------------------------------------------------
// GET .../product-breakdown — mevcut meta + küratörlü aday listesi (canlı VAR/YOK)
// ---------------------------------------------------------------------------

export type ProductBreakdownCandidateWithLiveStatus = ProductBreakdownCandidate & {
  live: CandidateLiveCheck;
};

export type ProductBreakdownConfigMeta = {
  current: ProductBreakdownMeta;
  candidates: ProductBreakdownCandidateWithLiveStatus[];
};

/**
 * Mevcut aktif kırılımı + tüm küratörlü adayların canlı VAR/YOK durumunu
 * döner. Canlı kontrol adaylar arasında PARALEL çalışır.
 */
export async function getProductBreakdownConfigMeta(run: RunReadOnlyFn): Promise<ProductBreakdownConfigMeta> {
  const current = getProductBreakdownMeta();
  const candidates = await Promise.all(
    PRODUCT_BREAKDOWN_CANDIDATES.map(async (candidate) => ({
      ...candidate,
      live: await verifyCandidateLive(run, candidate, PARENT_TABLE),
    })),
  );
  return { current, candidates };
}

// ---------------------------------------------------------------------------
// POST .../product-breakdown/preview — seçilen aday için canlı önizleme
// ---------------------------------------------------------------------------

export type ProductBreakdownPreview = {
  meta: ProductBreakdownMeta;
  live: CandidateLiveCheck;
  sampleValues: string[] | null;
  matchRate: MatchRateResult | null;
};

/**
 * Bir adayı KAYDETMEDEN önce canlı önizler: örnek değerler + eşleşme oranı +
 * tip-uyum bayrağı. Girdi ÖNCE `resolveProductBreakdown` ile doğrulanır.
 */
export async function previewProductBreakdownCandidate(
  run: RunReadOnlyFn,
  input: ProductBreakdownDimension,
  sampleLimit = 10,
): Promise<ProductBreakdownPreview> {
  const meta = resolveProductBreakdown(input); // fail-closed — THROW ederse endpoint 400 döner
  const live = await verifyCandidateLive(run, meta, PARENT_TABLE);
  if (!isLiveCheckSavable(live)) {
    return { meta, live, sampleValues: null, matchRate: null };
  }
  const [sampleValues, matchRate] = await Promise.all([
    previewSampleValues(run, meta, sampleLimit),
    computeMatchRate(run, meta, {
      parentTable: PARENT_TABLE,
      parentAlias: PARENT_ALIAS,
      lookupAlias: LOOKUP_ALIAS,
      activeFilter: `${PARENT_ALIAS}.BYTDURUM = 0`,
      join: productBreakdownJoin(meta, { parentAlias: PARENT_ALIAS, lookupAlias: LOOKUP_ALIAS }),
    }),
  ]);
  return { meta, live, sampleValues, matchRate };
}

// ---------------------------------------------------------------------------
// POST .../product-breakdown — override KAYDET
// ---------------------------------------------------------------------------

export type SaveProductBreakdownDeps = {
  run: RunReadOnlyFn;
  tenantId: string;
  /** Session'dan gelen admin username — client body'sinden ASLA. */
  actor: string;
  input: ProductBreakdownDimension;
};

/**
 * Ürün/marka kırılımı override'ını kaydeder. Sıra `saveCustomerBreakdownOverride`
 * ile AYNI: allowlist → canlı-şema → atomik yaz → senkron invalidate → audit.
 */
export async function saveProductBreakdownOverride(deps: SaveProductBreakdownDeps): Promise<void> {
  const { run, tenantId, actor, input } = deps;

  const meta = resolveProductBreakdown(input);

  const live = await verifyCandidateLive(run, meta, PARENT_TABLE);
  if (!isLiveCheckSavable(live)) {
    throw new LiveSchemaValidationError(
      `[product-breakdown] "${meta.table}"/"${meta.joinColumn}"/"${meta.labelColumn}" canlı şemada doğrulanamadı ` +
        `(tableExists=${live.tableExists}, joinColumnExists=${live.joinColumnExists}, labelColumnExists=${live.labelColumnExists}). ` +
        "Kayıt reddedildi — bozuk eşleme diske yazılmadı.",
      live,
    );
  }

  const oldValue = getMappingConfig().dimensions.productBreakdown;

  await setMappingOverride(tenantId, {
    dimensions: { productBreakdown: meta },
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  });

  invalidateProductBreakdownCaches();

  await recordConfigAudit({
    tenantId,
    actor,
    action: "save",
    field: "dimensions.productBreakdown",
    oldValue,
    newValue: meta,
  });
}

// ---------------------------------------------------------------------------
// POST .../product-breakdown/reset — override'ı sil (varsayılana dön)
// ---------------------------------------------------------------------------

export type ResetProductBreakdownDeps = {
  tenantId: string;
  actor: string;
};

/** Override'ı kaldırır (config dosyasındaki default'a döner) → invalidate → audit. */
export async function resetProductBreakdownOverride(deps: ResetProductBreakdownDeps): Promise<void> {
  const { tenantId, actor } = deps;
  const oldValue = getMappingConfig().dimensions.productBreakdown;

  await resetOverrideOnDisk(tenantId);
  invalidateProductBreakdownCaches();

  const newValue = getMappingConfig().dimensions.productBreakdown;
  await recordConfigAudit({
    tenantId,
    actor,
    action: "reset",
    field: "dimensions.productBreakdown",
    oldValue,
    newValue,
  });
}
