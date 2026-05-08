import Link from "next/link";
import { listMapCustomers } from "@/lib/api";
import { SalesMap } from "@/components/sales-map-client";

export const dynamic = "force-dynamic";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const sehir = typeof sp.sehir === "string" ? sp.sehir : undefined;

  let data: Awaited<ReturnType<typeof listMapCustomers>> = { count: 0, customers: [] };
  let apiError: string | null = null;
  try {
    data = await listMapCustomers({ sehir, limit: 5000 });
  } catch (err) {
    apiError = (err as Error).message;
  }

  return (
    <div className="-m-5 h-[calc(100vh-48px)] flex flex-col">
      <header className="border-b border-border bg-surface/40 px-5 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-baseline gap-3 flex-wrap">
          <Link href="/" className="text-xs text-muted hover:text-fg">← Radar</Link>
          <h1 className="text-lg font-semibold tracking-tight">Satış Haritası</h1>
          <span className="text-xs text-muted">
            Onaylı müşteriler. Bir noktaya tıklayınca son 30 gün ciro + AI analizi.
          </span>
        </div>
        <div className="text-[11px] text-muted tabular-nums">
          {data.count.toLocaleString("tr-TR")} müşteri
          {sehir && <span className="ml-2">· {sehir}</span>}
        </div>
      </header>

      <div className="flex-1 relative min-h-0">
        {apiError ? (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="rounded-lg border border-bad/40 bg-bad/10 px-5 py-4 text-sm max-w-lg">
              <div className="font-medium text-bad mb-1">Harita verisi alınamadı</div>
              <code className="text-xs text-muted">{apiError}</code>
            </div>
          </div>
        ) : data.customers.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-muted text-sm">
            Koordinatlı müşteri bulunamadı. <code className="ml-2 text-xs">TBLMUSTERI.DBLKOORDINATX/Y</code> dolu olmalı.
          </div>
        ) : (
          <SalesMap customers={data.customers} />
        )}
      </div>
    </div>
  );
}
