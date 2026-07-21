// Pernod snapshot üret — bu makine MSSQL'e erişebiliyorken local.sqlite'a
// güncel (v7) komuta cache'i yazar. Sonra local.sqlite sunucuya kopyalanır.
//   TENANT=pernod node node_modules/tsx/dist/cli.mjs tools/sync-pernod-snapshot.ts
import { getKomutaSnapshot } from "@enroute/core";

for (const unit of ["tl"] as const) {
  console.log(`[sync] komuta ${unit} hesaplanıyor (MSSQL)...`);
  const snap = await getKomutaSnapshot({ forceRefresh: true, unit });
  console.log(
    `[sync]   ${unit}: regions=${snap.regions.length} kpis=${snap.kpis.length} reps=${snap.reps.length} brief=${snap.brief ? "var" : "boş"}`,
  );
}
console.log("[sync] tamam.");
