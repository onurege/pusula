/**
 * Bölge kırılımı konfigüratörünün ÇEKİRDEK servis katmanı — Hono endpoint'leri
 * (apps/api) bu dosyayı çağırır, kendileri parse/dön dışında mantık taşımaz.
 * `customer-breakdown-config-service.ts`/`product-breakdown-config-service.ts`
 * ile AYNI güvenlik sözleşmesi ve sıra; tek fark: ebeveyn tablo `TBLDIST`.
 */
import type { RegionBreakdownDimension } from "./types";
import { resolveRegionBreakdown, type RegionBreakdownMeta } from "./identifier";
import { REGION_BREAKDOWN_CANDIDATES, type RegionBreakdownCandidate } from "./region-breakdown-candidates";
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
import { regionBreakdownJoin } from "./region-breakdown-sql";
import { getMappingConfig, getRegionBreakdownMeta } from "./index";
import { setMappingOverride, resetRegionBreakdownOverride as resetOverrideOnDisk } from "./mapping-store";
import { invalidateRegionBreakdownCaches } from "./cache-invalidation";
import { recordConfigAudit } from "./audit-log";

export { LiveSchemaValidationError };

/** Bölge kırılımının ebeveyn tablosu — `joinColumn` burada yaşar. */
const PARENT_TABLE = "TBLDIST";
const PARENT_ALIAS = "d";
const LOOKUP_ALIAS = "dg";

// ---------------------------------------------------------------------------
// GET .../region-breakdown — mevcut meta + küratörlü aday listesi (canlı VAR/YOK)
// ---------------------------------------------------------------------------

export type RegionBreakdownCandidateWithLiveStatus = RegionBreakdownCandidate & {
  live: CandidateLiveCheck;
};

export type RegionBreakdownConfigMeta = {
  current: RegionBreakdownMeta;
  candidates: RegionBreakdownCandidateWithLiveStatus[];
};

/**
 * Mevcut aktif kırılımı + tüm küratörlü adayların canlı VAR/YOK durumunu
 * döner. Canlı kontrol adaylar arasında PARALEL çalışır.
 */
export async function getRegionBreakdownConfigMeta(run: RunReadOnlyFn): Promise<RegionBreakdownConfigMeta> {
  const current = getRegionBreakdownMeta();
  const candidates = await Promise.all(
    REGION_BREAKDOWN_CANDIDATES.map(async (candidate) => ({
      ...candidate,
      live: await verifyCandidateLive(run, candidate, PARENT_TABLE),
    })),
  );
  return { current, candidates };
}

// ---------------------------------------------------------------------------
// POST .../region-breakdown/preview — seçilen aday için canlı önizleme
// ---------------------------------------------------------------------------

export type RegionBreakdownPreview = {
  meta: RegionBreakdownMeta;
  live: CandidateLiveCheck;
  sampleValues: string[] | null;
  matchRate: MatchRateResult | null;
};

/**
 * Bir adayı KAYDETMEDEN önce canlı önizler: örnek değerler + eşleşme oranı +
 * tip-uyum bayrağı. Girdi ÖNCE `resolveRegionBreakdown` ile doğrulanır.
 */
export async function previewRegionBreakdownCandidate(
  run: RunReadOnlyFn,
  input: RegionBreakdownDimension,
  sampleLimit = 10,
): Promise<RegionBreakdownPreview> {
  const meta = resolveRegionBreakdown(input); // fail-closed — THROW ederse endpoint 400 döner
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
      join: regionBreakdownJoin(meta, PARENT_ALIAS, LOOKUP_ALIAS, "INNER"),
    }),
  ]);
  return { meta, live, sampleValues, matchRate };
}

// ---------------------------------------------------------------------------
// POST .../region-breakdown — override KAYDET
// ---------------------------------------------------------------------------

export type SaveRegionBreakdownDeps = {
  run: RunReadOnlyFn;
  tenantId: string;
  /** Session'dan gelen admin username — client body'sinden ASLA. */
  actor: string;
  input: RegionBreakdownDimension;
};

/**
 * Bölge kırılımı override'ını kaydeder. Sıra `saveCustomerBreakdownOverride`
 * ile AYNI: allowlist → canlı-şema → atomik yaz → senkron invalidate → audit.
 */
export async function saveRegionBreakdownOverride(deps: SaveRegionBreakdownDeps): Promise<void> {
  const { run, tenantId, actor, input } = deps;

  const meta = resolveRegionBreakdown(input);

  const live = await verifyCandidateLive(run, meta, PARENT_TABLE);
  if (!isLiveCheckSavable(live)) {
    throw new LiveSchemaValidationError(
      `[region-breakdown] "${meta.table}"/"${meta.joinColumn}"/"${meta.labelColumn}" canlı şemada doğrulanamadı ` +
        `(tableExists=${live.tableExists}, joinColumnExists=${live.joinColumnExists}, labelColumnExists=${live.labelColumnExists}). ` +
        "Kayıt reddedildi — bozuk eşleme diske yazılmadı.",
      live,
    );
  }

  const oldValue = getMappingConfig().dimensions.regionBreakdown;

  await setMappingOverride(tenantId, {
    dimensions: { regionBreakdown: meta },
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  });

  invalidateRegionBreakdownCaches();

  await recordConfigAudit({
    tenantId,
    actor,
    action: "save",
    field: "dimensions.regionBreakdown",
    oldValue,
    newValue: meta,
  });
}

// ---------------------------------------------------------------------------
// POST .../region-breakdown/reset — override'ı sil (varsayılana dön)
// ---------------------------------------------------------------------------

export type ResetRegionBreakdownDeps = {
  tenantId: string;
  actor: string;
};

/** Override'ı kaldırır (config dosyasındaki default'a döner) → invalidate → audit. */
export async function resetRegionBreakdownOverride(deps: ResetRegionBreakdownDeps): Promise<void> {
  const { tenantId, actor } = deps;
  const oldValue = getMappingConfig().dimensions.regionBreakdown;

  await resetOverrideOnDisk(tenantId);
  invalidateRegionBreakdownCaches();

  const newValue = getMappingConfig().dimensions.regionBreakdown;
  await recordConfigAudit({
    tenantId,
    actor,
    action: "reset",
    field: "dimensions.regionBreakdown",
    oldValue,
    newValue,
  });
}
