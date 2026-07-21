import Link from "next/link";
import {
  getMapFacets,
  getMapSyncStatus,
  listMapCityYoY,
  listMapCustomers,
  listMapRegions,
} from "@/lib/api";
import { MapFilters } from "@/components/map-filters";
import { SalesMap } from "@/components/sales-map-client";
import { ViewModeToggle } from "@/components/view-mode-toggle";
import { MapHierarchyBreadcrumb } from "@/components/map-hierarchy-breadcrumb";
import { CityInsights } from "@/components/city-insights";
import { getTenantConfig } from "@/lib/tenant";

type Props = {
  searchParams: Record<string, string | string[] | undefined>;
  /**
   * Drill-down ve filter linklerinin hedef path'i. V1'de "/map", V2'de
   * "/v2/harita". Aynı içerik iki ayrı path'te de render edilebilsin diye
   * tüm child component'ler bu prop'u alır (MapFilters, MapHierarchyBreadcrumb,
   * page içi geri-dön linki).
   */
  basePath: string;
  /** Sol üstteki "← Radar" linkinin hedefi. V1'de "/", V2'de "/v2". */
  backHref: string;
  /** Geri-dön linkinin görünür metni. */
  backLabel: string;
};

/**
 * `/map` (V1) ve `/v2/harita` (V2) sayfaları aynı haritayı render eder; tek
 * fark navbar chrome ve geri-dön linki. DRY için içerik bu server component'e
 * çıkarıldı — V2'de hazır filtre kartlarına tıklayan kullanıcı artık V1'e
 * düşmüyor (navbar tutarlı kalıyor).
 *
 * Veri çekme + searchParams parse + tüm UI burada; sayfalar 1-2 satırlık
 * wrapper'a indirgenir.
 */
export async function MapPageBody({
  searchParams: sp,
  basePath,
  backHref,
  backLabel,
}: Props) {
  const tenant = getTenantConfig();
  const sehir = typeof sp.sehir === "string" ? sp.sehir : undefined;
  const distKodRaw = typeof sp.distKod === "string" ? sp.distKod : undefined;
  const distKod =
    distKodRaw && !isNaN(Number(distKodRaw)) ? Number(distKodRaw) : undefined;
  const salesFilterRaw =
    typeof sp.salesFilter === "string" ? sp.salesFilter : undefined;
  const salesFilter: "with" | "without" | undefined =
    salesFilterRaw === "with" || salesFilterRaw === "without"
      ? salesFilterRaw
      : undefined;
  const riskTierRaw =
    typeof sp.riskTier === "string" ? sp.riskTier : undefined;
  const riskTier: "high" | "medium" | "low" | "active" | undefined =
    riskTierRaw === "high" ||
    riskTierRaw === "medium" ||
    riskTierRaw === "low" ||
    riskTierRaw === "active"
      ? (riskTierRaw as "high" | "medium" | "low" | "active")
      : undefined;
  // Composite tier filter (URL param `tier`). Eski `riskTier` ile birlikte
  // geçirilirse backend `tier`'ı önceler.
  const tierRaw = typeof sp.tier === "string" ? sp.tier : undefined;
  const tier:
    | "healthy"
    | "watch"
    | "risk"
    | "critical"
    | "unknown"
    | undefined =
    tierRaw === "healthy" ||
    tierRaw === "watch" ||
    tierRaw === "risk" ||
    tierRaw === "critical" ||
    tierRaw === "unknown"
      ? (tierRaw as "healthy" | "watch" | "risk" | "critical" | "unknown")
      : undefined;
  const minDaysSinceVisitRaw =
    typeof sp.minDaysSinceVisit === "string" ? sp.minDaysSinceVisit : undefined;
  const minDaysSinceVisit =
    minDaysSinceVisitRaw && !isNaN(Number(minDaysSinceVisitRaw))
      ? Number(minDaysSinceVisitRaw)
      : undefined;

  // Görünüm modu: customer (default), region veya city.
  //   - region: TR 7 klasik bölgesi polygon fill (YoY renkleriyle)
  //   - city:   ?region=X seçili → o bölgenin illeri YoY rengiyle dolu (ara seviye)
  //   - customer: nokta nokta müşteriler (sehir/region filter ile)
  // Drill akışı: region → city → customer
  const viewModeRaw =
    sp.view === "region" || sp.view === "city" || sp.view === "customer"
      ? (sp.view as "region" | "city" | "customer")
      : "customer";
  const bolge = typeof sp.bolge === "string" ? sp.bolge : undefined;
  const region = typeof sp.region === "string" ? sp.region : undefined;
  // City mode region olmadan anlamsız → region'a fallback
  const viewMode =
    viewModeRaw === "city" && !region ? "region" : viewModeRaw;

  const [
    customersResult,
    regionsResult,
    citiesResult,
    facetsResult,
    syncResult,
  ] = await Promise.allSettled([
    // Customer mode için 30k limit (cluster gradient'in tüm tier'lardan
    // örnek görmesi için). Region drill-down ise region filter ile çekilir.
    listMapCustomers({
      sehir,
      distKod,
      bolge,
      region,
      salesFilter,
      riskTier,
      tier,
      minDaysSinceVisit,
      limit: 30000,
    }),
    listMapRegions({
      sehir,
      distKod,
      salesFilter,
      riskTier,
      tier,
      minDaysSinceVisit,
    }),
    // Şehir-bazlı YoY — sadece view=city iken anlamlı, region zorunlu
    viewMode === "city" && region
      ? listMapCityYoY({ region })
      : Promise.resolve({ count: 0, cities: [] }),
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
  const citiesData =
    citiesResult.status === "fulfilled"
      ? citiesResult.value
      : { count: 0, cities: [] };
  const citiesError =
    citiesResult.status === "rejected"
      ? (citiesResult.reason as Error).message
      : null;
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
      : {
          lastSyncAt: null,
          durationMs: 0,
          customerCount: 0,
          cityCount: 0,
          distCount: 0,
        };

  const neverSynced =
    sync.lastSyncAt === null && data.customers.length === 0;

  return (
    <div className="fixed inset-0 top-14 flex flex-col bg-bg">
      <header className="bg-surface/80 backdrop-blur border-b border-border h-14 px-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <Link
            href={backHref}
            className="text-xs text-muted hover:text-fg shrink-0"
          >
            {backLabel}
          </Link>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-base font-semibold tracking-tight">
            Satış Haritası
          </h1>
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
              basePath={basePath}
            />
          </div>
          {region && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-[var(--color-accent-soft)] px-2 py-1 text-[11px] font-medium text-accent xl:hidden">
              📍 {region}
              <Link
                href={(() => {
                  // Filter çipini × ile kapatınca → bölge görünümüne dön
                  const params = new URLSearchParams();
                  params.set("view", "region");
                  if (sehir) params.set("sehir", sehir);
                  if (distKod) params.set("distKod", String(distKod));
                  if (salesFilter) params.set("salesFilter", salesFilter);
                  if (riskTier) params.set("riskTier", riskTier);
                  if (minDaysSinceVisit)
                    params.set("minDaysSinceVisit", String(minDaysSinceVisit));
                  return `${basePath}?${params.toString()}`;
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
          {/* SyncButton kaldırıldı — global "Veriyi Yenile" navbar'da merkezi. */}
        </div>
      </header>

      {/* City view içgörü paneli — sadece view=city + region varken,
          haritanın üstünde 3 kart (büyüyenler / kaybedilenler / acil aksiyon)
          görünür. */}
      {viewMode === "city" &&
        region &&
        citiesData.cities.length > 0 && (
          <CityInsights cities={citiesData.cities} region={region} />
        )}

      {/* City API hatası — bütün illeri "bayisiz" göstermek yanıltıcı.
          DB connection / VPN sorunu / endpoint hatası net mesajlı uyarı. */}
      {viewMode === "city" && region && citiesError && (
        <div className="border-b border-bad/40 bg-bad/10 px-5 py-3 text-sm">
          <div className="font-semibold text-bad mb-1">
            ⚠ Şehir bazlı YoY verisi alınamadı
          </div>
          <div className="text-xs text-fg-2 mb-1">
            Harita illeri sönük gösteriliyor ama bu{" "}
            <strong>"bayisiz" anlamına gelmiyor</strong> — sadece veri
            çekilemedi. Backend MSSQL bağlantısı kopmuş olabilir (VPN /
            network).
          </div>
          <code className="text-[11px] text-muted">{citiesError}</code>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <MapFilters
          facets={facets}
          customers={data.customers}
          count={data.count}
          basePath={basePath}
        />

        <main className="flex-1 relative bg-surface">
          {apiError ? (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="rounded-lg border border-bad/40 bg-bad/10 px-5 py-4 text-sm max-w-lg">
                <div className="font-medium text-bad mb-1">
                  Harita verisi alınamadı
                </div>
                <code className="text-xs text-muted">{apiError}</code>
              </div>
            </div>
          ) : neverSynced ? (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="rounded-lg border border-border bg-surface-2 px-5 py-4 text-sm max-w-md text-center">
                <div className="font-medium text-fg mb-1">
                  Yerel veritabanı boş
                </div>
                <div className="text-muted text-xs">
                  {tenant.labels.mapEmptyDataSource}
                </div>
              </div>
            </div>
          ) : data.customers.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-muted text-sm">
              Bu filtrelerle koordinatlı müşteri yok.
            </div>
          ) : (
            <>
              <SalesMap
                customers={data.customers}
                regions={regionsData.regions}
                cities={citiesData.cities}
                viewMode={viewMode}
              />
              <MapRiskLegend />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * Harita nokta renk açıklaması — müşteri noktaları composite "kayıp riski"
 * skoruna (0-100) göre renklenir; yüksek skor = yüksek risk. Eşikler
 * packages/core/src/map.ts `tierForScore` ile birebir.
 */
function MapRiskLegend() {
  const items = [
    { c: "#16a34a", t: "Sağlıklı", r: "skor 0–29" },
    { c: "#d97706", t: "İzlemede", r: "30–54" },
    { c: "#ea580c", t: "Riskli", r: "55–74" },
    { c: "#dc2626", t: "Kritik", r: "75–100" },
    { c: "#a1a1aa", t: "Bilinmiyor", r: "veri yok" },
  ];
  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[5] flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface/90 backdrop-blur px-3.5 py-2 shadow-md text-[11px] max-w-[95%]">
      <span className="font-semibold text-muted mr-1">Kayıp riski:</span>
      {items.map((i) => (
        <span key={i.t} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.c }} />
          <span className="text-fg font-medium">{i.t}</span>
          <span className="text-muted">{i.r}</span>
        </span>
      ))}
    </div>
  );
}
