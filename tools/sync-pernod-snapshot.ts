// Pernod offline snapshot — bu makine MSSQL'e erişebiliyorken komuta + TÜM V3
// dashboard'larını local.sqlite cache'ine yazar. Sonra local.sqlite sunucuya
// kopyalanır (offline pernod-demo tenant'ı cache'ten servis eder).
//   set -a; . ./.env; set +a
//   TENANT=pernod node node_modules/tsx/dist/cli.mjs tools/sync-pernod-snapshot.ts
import {
  getKomutaSnapshot,
  getWietnauerSatisSnapshot,
  getWietnauerSegmentSnapshot,
  getWietnauerMarkaSnapshot,
  getWietnauerStokSnapshot,
  getWietnauerSahaSnapshot,
  getWietnauerAktivasyonSnapshot,
  getWietnauerIskontoSnapshot,
  getWietnauerYonetimSnapshot,
  getTenantConfig,
} from "@enroute/core";

const strategicBrands = getTenantConfig().strategicBrands ?? [];
const v3Opts = {
  forceRefresh: true,
  strategicBrands,
  allowedDistKods: null,
  distId: null,
};

const jobs: [string, () => Promise<unknown>][] = [
  ["komuta-tl", () => getKomutaSnapshot({ forceRefresh: true, unit: "tl" })],
  ["komuta-9le", () => getKomutaSnapshot({ forceRefresh: true, unit: "9le" })],
  ["satis", () => getWietnauerSatisSnapshot(v3Opts)],
  ["segment", () => getWietnauerSegmentSnapshot(v3Opts)],
  ["marka", () => getWietnauerMarkaSnapshot(v3Opts)],
  ["stok", () => getWietnauerStokSnapshot(v3Opts)],
  ["saha", () => getWietnauerSahaSnapshot(v3Opts)],
  ["aktivasyon", () => getWietnauerAktivasyonSnapshot(v3Opts)],
  ["iskonto", () => getWietnauerIskontoSnapshot(v3Opts)],
  ["yonetim", () => getWietnauerYonetimSnapshot(v3Opts)],
];

for (const [name, fn] of jobs) {
  const t0 = Date.now();
  try {
    const snap = (await fn()) as Record<string, unknown> | null;
    const keys = snap ? Object.keys(snap).slice(0, 8).join(",") : "null";
    console.log(`[sync] ${name.padEnd(12)} OK   (${((Date.now() - t0) / 1000).toFixed(0)}s) keys=${keys}`);
  } catch (e) {
    console.log(`[sync] ${name.padEnd(12)} FAIL (${((Date.now() - t0) / 1000).toFixed(0)}s): ${(e as Error).message.slice(0, 140)}`);
  }
}
console.log("[sync] bitti.");
