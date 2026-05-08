"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import type { CustomerSales, MapCustomer } from "@/lib/api";
import { explainOnRadar, getCustomerSales } from "@/lib/api";

// Inline minimal style-spec — keeps the map self-contained instead of
// depending on a remote style.json fetch which can fail silently and
// leave the canvas blank. Raster tiles from Carto's basemaps CDN
// (free, no key) for a dark theme that matches the dashboard.
const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};
const INITIAL_CENTER: [number, number] = [35.0, 39.0];
const INITIAL_ZOOM = 5.2;

// Indigo / zinc palette borrowed from the map-check project so the map
// reads as part of the same family. maplibre-gl's style spec only takes
// hex / rgb / hsl / named colors — these are the Tailwind indigo + zinc
// hex values map-check used directly.
const COLOR_ACCENT = "#6366f1";        // indigo-500 (small clusters / active)
const COLOR_ACCENT_MID = "#4f46e5";    // indigo-600 (≥50)
const COLOR_ACCENT_HIGH = "#4338ca";   // indigo-700 (≥200)
const COLOR_ACCENT_DEEP = "#3730a3";   // indigo-800 (≥1000)
const COLOR_MUTED = "#a1a1aa";         // zinc-400 (silent customer)
const COLOR_STROKE = "#ffffff";         // white stroke for light tiles
const COLOR_LABEL = "#ffffff";          // cluster count text on indigo

type Props = {
  customers: MapCustomer[];
};

type SalesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: CustomerSales }
  | { kind: "err"; message: string };

type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; brief?: string; sql?: string }
  | { kind: "err"; message: string };

export default function SalesMap({ customers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<MapCustomer | null>(null);
  const [sales, setSales] = useState<SalesState>({ kind: "idle" });
  const [explain, setExplain] = useState<ExplainState>({ kind: "idle" });

  // Listen for fly-to events dispatched from the filters panel search.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ customer: MapCustomer }>;
      const c = ce.detail?.customer;
      if (!c) return;
      mapRef.current?.flyTo({ center: [c.lng, c.lat], zoom: 14, essential: true });
      setSelected(c);
      setExplain({ kind: "idle" });
      setSales({ kind: "loading" });
      getCustomerSales(c.id, c.distKod)
        .then((data) => setSales({ kind: "ok", data }))
        .catch((err) => setSales({ kind: "err", message: (err as Error).message }));
    };
    window.addEventListener("enroute:fly-to", handler);
    return () => window.removeEventListener("enroute:fly-to", handler);
  }, []);

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: customers.map((c) => ({
        type: "Feature" as const,
        properties: {
          id: c.id,
          distKod: c.distKod ?? -1,
          unvan: c.unvan,
          adres: c.adres ?? "",
          sehir: c.sehir ?? "",
          ilce: c.ilce ?? "",
          distributor: c.distributor ?? "",
          hasSales: c.hasSales ? 1 : 0,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [c.lng, c.lat] as [number, number],
        },
      })),
    }),
    [customers],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    map.on("load", () => {
      // ssr:false dynamic import + flexbox layout often gives the map a 0×0
      // canvas on first paint. Force a resize once we're loaded.
      map.resize();
    });

    const resize = () => map.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const SRC = "customers";

    const apply = () => {
      // Belt-and-braces: maplibre throws if you call addSource/addLayer
      // before the style finishes loading. React's `load` listener can
      // fire a tick before isStyleLoaded() flips to true, especially
      // under HMR. Re-check at runtime and bail if not yet ready.
      if (!map.isStyleLoaded()) return;

      const existing = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(geojson);
        return;
      }

      map.addSource(SRC, {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 13,
        clusterRadius: 50,
        clusterProperties: {
          // Sum of hasSales (0/1) per cluster — used to tone clusters by
          // how active their constituent customers are.
          activeCount: ["+", ["get", "hasSales"]],
        },
      });

    map.addLayer({
      id: "clusters",
      type: "circle",
      source: SRC,
      filter: ["has", "point_count"],
      paint: {
        // Cluster color = how alive the customers inside it are. Any cluster
        // with zero recent-sales customers reads gray; mostly-sales clusters
        // get the accent ramp (deeper for bigger clusters).
        "circle-color": [
          "case",
          ["==", ["get", "activeCount"], 0],
          COLOR_MUTED,
          [
            "step",
            ["get", "point_count"],
            COLOR_ACCENT,
            50,
            COLOR_ACCENT_MID,
            200,
            COLOR_ACCENT_HIGH,
            1000,
            COLOR_ACCENT_DEEP,
          ],
        ],
        "circle-radius": [
          "step",
          ["get", "point_count"],
          16,
          50,
          20,
          200,
          26,
          1000,
          32,
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": COLOR_STROKE,
        "circle-opacity": 0.9,
      },
    });

    map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: SRC,
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-size": 12,
        // demotiles.maplibre.org/font only ships "Open Sans Regular",
        // "Open Sans Semibold" and "Noto Sans Regular". Anything else
        // would 404 and the cluster count would silently disappear.
        "text-font": ["Open Sans Semibold"],
      },
      paint: { "text-color": COLOR_LABEL },
    });

    map.addLayer({
      id: "unclustered",
      type: "circle",
      source: SRC,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "case",
          ["==", ["get", "hasSales"], 1],
          COLOR_ACCENT,
          COLOR_MUTED,
        ],
        "circle-radius": [
          "case",
          ["==", ["get", "hasSales"], 1],
          7,
          5,
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": COLOR_STROKE,
      },
    });

    map.on("click", "clusters", async (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      const clusterId = features[0]?.properties?.cluster_id;
      const src = map.getSource(SRC) as maplibregl.GeoJSONSource;
      if (clusterId == null) return;
      const zoom = await src.getClusterExpansionZoom(clusterId);
      const coords = (features[0].geometry as GeoJSON.Point).coordinates;
      map.easeTo({ center: coords as [number, number], zoom });
    });

    map.on("click", "unclustered", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string | number>;
      const distKodNum = Number(p.distKod);
      const c: MapCustomer = {
        id: Number(p.id),
        distKod: distKodNum > 0 ? distKodNum : null,
        unvan: String(p.unvan),
        adres: (p.adres as string) || null,
        sehir: (p.sehir as string) || null,
        ilce: (p.ilce as string) || null,
        distributor: (p.distributor as string) || null,
        lat: (f.geometry as GeoJSON.Point).coordinates[1] as number,
        lng: (f.geometry as GeoJSON.Point).coordinates[0] as number,
        hasSales: Number(p.hasSales) === 1,
      };
      setSelected(c);
      setExplain({ kind: "idle" });
      // Lazy-load this customer's 30d revenue.
      setSales({ kind: "loading" });
      getCustomerSales(c.id, c.distKod)
        .then((data) => setSales({ kind: "ok", data }))
        .catch((err) => setSales({ kind: "err", message: (err as Error).message }));
    });

      const setCursor = (cursor: string) => {
        map.getCanvas().style.cursor = cursor;
      };
      map.on("mouseenter", "clusters", () => setCursor("pointer"));
      map.on("mouseleave", "clusters", () => setCursor(""));
      map.on("mouseenter", "unclustered", () => setCursor("pointer"));
      map.on("mouseleave", "unclustered", () => setCursor(""));
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("load", apply);
    }
  }, [geojson]);

  async function runExplain(c: MapCustomer, s: CustomerSales) {
    setExplain({ kind: "loading" });
    try {
      const res = await explainOnRadar(
        "sales",
        `Univera ERP'de "${c.unvan}" adlı müşteri (TBLMUSTERI.LNGKOD = ${c.id}, distribütör: ${c.distributor ?? "—"}, şehir: ${c.sehir ?? "—"}). Son 30 gün satış cirosu ${s.ciro30.toLocaleString("tr-TR")} ₺ ve ${s.fatura30} satış faturası kaydı var. Bu müşterinin son 30 gündeki **ürün grubu / marka kırılımını** TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUN üzerinden çıkar (TBLMSDFATURA.LNGMUSTERIKOD = ${c.id} AND BYTTUR=0 AND BYTDURUM=0). En çok ciro getiren 2-3 marka veya ürün grubunu somut adlarıyla, miktarlarıyla ver. 2-3 cümlelik Türkçe yönetici özeti yaz.`,
      );
      setExplain({ kind: "ok", brief: res.brief, sql: res.sql });
    } catch (err) {
      setExplain({ kind: "err", message: (err as Error).message });
    }
  }

  return (
    <>
      {/* The container is the only thing that fills the parent box. No
          wrappers, no absolute children of its parent. Map-check style. */}
      <div ref={containerRef} className="w-full h-full" />

      {selected && (
        <div className="absolute right-3 top-3 w-[360px] max-h-[calc(100%-24px)] overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl z-50">
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-base truncate">{selected.unvan}</div>
                {selected.distributor && (
                  <div className="text-xs text-accent mt-0.5">{selected.distributor}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-muted hover:text-fg text-lg leading-none -mt-1"
                aria-label="Kapat"
              >
                ×
              </button>
            </div>

            {(selected.adres || selected.ilce || selected.sehir) && (
              <div className="text-sm text-fg/85">
                {selected.adres && <div>{selected.adres}</div>}
                <div className="text-muted text-xs mt-0.5">
                  {[selected.ilce, selected.sehir].filter(Boolean).join(" / ")}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-bg p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  30 Gün Ciro
                </div>
                <div className="text-xl font-semibold tracking-tight tabular-nums mt-1">
                  {sales.kind === "loading"
                    ? "…"
                    : sales.kind === "ok"
                    ? `${formatCompact(sales.data.ciro30)} ₺`
                    : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-bg p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  Fatura Sayısı
                </div>
                <div className="text-xl font-semibold tracking-tight tabular-nums mt-1">
                  {sales.kind === "loading"
                    ? "…"
                    : sales.kind === "ok"
                    ? sales.data.fatura30.toLocaleString("tr-TR")
                    : "—"}
                </div>
              </div>
            </div>

            {sales.kind === "ok" && sales.data.sonFaturaTarihi && (
              <div className="text-xs text-muted">
                Son fatura: {new Date(sales.data.sonFaturaTarihi).toLocaleDateString("tr-TR")}
              </div>
            )}
            {sales.kind === "err" && (
              <div className="text-xs text-bad">
                Ciro alınamadı: <code className="text-[10px]">{sales.message}</code>
              </div>
            )}

            {sales.kind === "ok" && (
              <button
                type="button"
                onClick={() => runExplain(selected, sales.data)}
                disabled={explain.kind === "loading"}
                className="w-full inline-flex items-center justify-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {explain.kind === "loading" ? "Analiz ediliyor…" : "AI Analizi al"}
              </button>
            )}

            {explain.kind === "err" && (
              <div className="text-sm text-bad">
                <code className="text-xs">{explain.message}</code>
              </div>
            )}
            {explain.kind === "ok" && explain.brief && (
              <div className="rounded-lg border border-accent/40 bg-accent/8 p-4">
                <div className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-2">
                  AI Analizi
                </div>
                <div className="text-sm leading-relaxed whitespace-pre-wrap">
                  {explain.brief}
                </div>
                {explain.sql && (
                  <details className="mt-3">
                    <summary className="text-xs text-muted cursor-pointer hover:text-fg">
                      Kullanılan SQL
                    </summary>
                    <pre className="mt-2 text-[11px] font-mono leading-relaxed overflow-auto bg-surface p-3 rounded">
                      {explain.sql}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000_000)
    return (n / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mr";
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mn";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}
