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

  const MAP_HEIGHT = "min(calc(100vh - 140px), 900px)";

  return (
    <div className="space-y-3">
      <header className="flex items-baseline justify-between flex-wrap gap-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <Link href="/" className="text-xs text-muted hover:text-fg">← Radar</Link>
          <h1 className="text-lg font-semibold tracking-tight">Satış Haritası</h1>
          <span className="text-xs text-muted">
            Onaylı müşteriler. Bir noktaya tıkla veya yukarıda ara → son 30 gün ciro + AI analizi.
          </span>
        </div>
        <div className="text-[11px] text-muted tabular-nums">
          {data.count.toLocaleString("tr-TR")} müşteri
          {sehir && <span className="ml-2">· {sehir}</span>}
          {distKod && <span className="ml-2">· dist #{distKod}</span>}
        </div>
      </header>

      <div className="flex gap-3" style={{ height: MAP_HEIGHT, minHeight: 480 }}>
        <MapFilters facets={facets} customers={data.customers} count={data.count} />

        <div className="flex-1 rounded-xl overflow-hidden border border-border bg-surface relative">
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
        </div>
      </div>
    </div>
  );
}
