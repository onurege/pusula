import Link from "next/link";
import { getMapFacets, getMapSyncStatus, listMapCustomers, listMapRegions } from "@/lib/api";
import { MapFilters } from "@/components/map-filters";
import { SalesMap } from "@/components/sales-map-client";
import { SyncButton } from "@/components/sync-button";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { MapHierarchyBreadcrumb } from "@/components/map-hierarchy-breadcrumb";

export const dynamic = "force-dynamic";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const sehir = typeof sp.sehir === "string" ? sp.sehir : undefined;
  const distKodRaw = typeof sp.distKod === "string" ? sp.distKod : undefined;
  const distKod = distKodRaw && !isNaN(Number(distKodRaw)) ? Number(distKodRaw) : undefined;
  const salesFilterRaw = typeof sp.salesFilter === "string" ? sp.salesFilter : undefined;
  const salesFilter: "with" | "without" | undefined =
    salesFilterRaw === "with" || salesFilterRaw === "without"
      ? salesFilterRaw
      : undefined;
  const riskTierRaw = typeof sp.riskTier === "string" ? sp.riskTier : undefined;
  const riskTier: "high" | "medium" | "low" | "active" | undefined =
    riskTierRaw === "high" || riskTierRaw === "medium" || riskTierRaw === "low" || riskTierRaw === "active"
      ? (riskTierRaw as "high" | "medium" | "low" | "active")
      : undefined;
  // Yeni composite tier filter (URL param `tier`). Eski `riskTier` ile
  // birlikte geçirilirse backend `tier`'ı önceler.
  const tierRaw = typeof sp.tier === "string" ? sp.tier : undefined;
  const tier: "healthy" | "watch" | "risk" | "critical" | "unknown" | undefined =
    tierRaw === "healthy" ||
    tierRaw === "watch" ||
    tierRaw === "risk" ||
    tierRaw === "critical" ||
    tierRaw === "unknown"
      ? (tierRaw as "healthy" | "watch" | "risk" | "critical" | "unknown")
      : undefined;
  const minDaysSinceVisitRaw = typeof sp.minDaysSinceVisit === "string" ? sp.minDaysSinceVisit : undefined;
  const minDaysSinceVisit =
    minDaysSinceVisitRaw && !isNaN(Number(minDaysSinceVisitRaw))
      ? Number(minDaysSinceVisitRaw)
      : undefined;

  // Görünüm modu: customer (default) veya region. Region modu, TR'nin
  // 7 klasik bölgesini il bazlı polygon fill ile renkler; bir bölgeye
  // tıklayınca customer mode + ?region=<adi> drill-down.
  const viewMode = sp.view === "region" ? "region" : "customer";
  const bolge = typeof sp.bolge === "string" ? sp.bolge : undefined;
  const region = typeof sp.region === "string" ? sp.region : undefined;

  const [customersResult, regionsResult, facetsResult, syncResult] = await Promise.allSettled([
    // Customer mode için 30k limit (cluster gradient'in tüm tier'lardan
    // örnek görmesi için). Region drill-down ise region filter ile çekilir
    // (sehir IN (...) genişletilir backend tarafında).
    listMapCustomers({ sehir, distKod, bolge, region, salesFilter, riskTier, tier, minDaysSinceVisit, limit: 30000 }),
    listMapRegions({ sehir, distKod, salesFilter, riskTier, tier, minDaysSinceVisit }),
    getMapFacets(),
    getMapSyncStatus(),
  ]);

  const data =
    customersResult.status === "fulfilled"
      ? customersResult.value
      : { count: 0, customers: [] };
  const regionsData =
    regionsResult.status === "fulfilled"
      ? regionsResult.value
      : { count: 0, regions: [] };
  const apiError =
    customersResult.status === "rejected"
      ? (customersResult.reason as Error).message
      : null;
  const facets =
    facetsResult.status === "fulfilled"
      ? facetsResult.value
      : { cities: [], distributors: [] };
  const sync =
    syncResult.status === "fulfilled"
      ? syncResult.value
      : { lastSyncAt: null, durationMs: 0, customerCount: 0, cityCount: 0, distCount: 0 };

  const neverSynced = sync.lastSyncAt === null && data.customers.length === 0;

  return (
    <div className="fixed inset-0 top-14 flex flex-col bg-bg">
      <header className="bg-surface/80 backdrop-blur border-b border-border h-14 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Link
            href="/"
            className="text-xs text-muted hover:text-fg shrink-0"
          >
            ← Radar
          </Link>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-base font-semibold tracking-tight">Satış Haritası</h1>
          <span className="text-xs text-muted hidden lg:inline truncate">
            tek tık = analiz · çift tık = bir seviye derine in
          </span>
          <div className="h-4 w-px bg-border hidden xl:block" />
          <div className="hidden xl:flex min-w-0">
            <MapHierarchyBreadcrumb
              viewMode={viewMode}
              region={region}
              sehir={sehir}
              bolge={bolge}
              distKod={distKod}
              customerCount={data.count}
            />
          </div>
          {region && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] font-medium text-accent xl:hidden">
              📍 {region}
              <Link
                href={(() => {
                  // Filter çipini × ile kapatınca → bölge görünümüne dön
                  // (customer mode'da bu zaten zaten drill-down'dan geliyordu;
                  //  geriye region view'e dönmek doğal akış).
                  const params = new URLSearchParams();
                  params.set("view", "region");
                  if (sehir) params.set("sehir", sehir);
                  if (distKod) params.set("distKod", String(distKod));
                  if (salesFilter) params.set("salesFilter", salesFilter);
                  if (riskTier) params.set("riskTier", riskTier);
                  if (minDaysSinceVisit) params.set("minDaysSinceVisit", String(minDaysSinceVisit));
                  return `/map?${params.toString()}`;
                })()}
                className="ml-0.5 text-accent/70 hover:text-accent"
                title="Bölge görünümüne geri dön"
              >
                ×
              </Link>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ViewModeToggle current={viewMode} />
          <SyncButton initial={sync} />
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <MapFilters facets={facets} customers={data.customers} count={data.count} />

        <main className="flex-1 relative bg-surface">
          {apiError ? (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="rounded-lg border border-bad/40 bg-bad/10 px-5 py-4 text-sm max-w-lg">
                <div className="font-medium text-bad mb-1">Harita verisi alınamadı</div>
                <code className="text-xs text-muted">{apiError}</code>
              </div>
            </div>
          ) : neverSynced ? (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="rounded-lg border border-border bg-surface-2 px-5 py-4 text-sm max-w-md text-center">
                <div className="font-medium text-fg mb-1">Yerel veritabanı boş</div>
                <div className="text-muted text-xs">
                  Henüz hiç senkronizasyon yapılmamış. Sağ üstteki{" "}
                  <span className="text-fg">Verileri yenile</span> butonuna tıklayarak
                  PERNOD'dan müşteri listesini SQLite'a kopyalayın.
                </div>
              </div>
            </div>
          ) : data.customers.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-muted text-sm">
              Bu filtrelerle koordinatlı müşteri yok.
            </div>
          ) : (
            <SalesMap
              customers={data.customers}
              regions={regionsData.regions}
              viewMode={viewMode}
            />
          )}
        </main>
      </div>
    </div>
  );
}
