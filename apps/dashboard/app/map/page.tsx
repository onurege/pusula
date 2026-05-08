import Link from "next/link";
import { getMapFacets, listMapCustomers } from "@/lib/api";
import { MapFilters } from "@/components/map-filters";
import { SalesMap } from "@/components/sales-map-client";

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

  const [customersResult, facetsResult] = await Promise.allSettled([
    listMapCustomers({ sehir, distKod, salesFilter, limit: 5000 }),
    getMapFacets(),
  ]);

  const data =
    customersResult.status === "fulfilled"
      ? customersResult.value
      : { count: 0, customers: [] };
  const apiError =
    customersResult.status === "rejected"
      ? (customersResult.reason as Error).message
      : null;
  const facets =
    facetsResult.status === "fulfilled"
      ? facetsResult.value
      : { cities: [], distributors: [] };

  return (
    // Break out of the global <main> container's max-width + padding so
    // the map fills everything below the navbar — map-check's full-bleed
    // layout. fixed inset-0 top-12 starts right under the 48px sticky
    // header.
    <div className="fixed inset-0 top-12 flex flex-col bg-bg">
      <header className="bg-surface border-b border-border h-14 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-3 flex-wrap">
          <Link href="/" className="text-xs text-muted hover:text-fg">← Radar</Link>
          <h1 className="text-base font-semibold tracking-tight">Satış Haritası</h1>
          <span className="text-xs text-muted hidden lg:inline">
            Onaylı müşteriler · noktaya tıkla → son 30 gün ciro + AI analizi
          </span>
        </div>
        <div className="text-xs text-muted tabular-nums">
          {data.count.toLocaleString("tr-TR")} müşteri
          {sehir && <span className="ml-2">· {sehir}</span>}
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
          ) : data.customers.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-muted text-sm">
              Bu filtrelerle koordinatlı müşteri yok.
            </div>
          ) : (
            <SalesMap customers={data.customers} />
          )}
        </main>
      </div>
    </div>
  );
}
