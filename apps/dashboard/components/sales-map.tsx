"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { MapCustomer } from "@/lib/api";
import { CustomerModal } from "./customer-modal";

// CARTO Positron — vector style with proper Turkish labels and a clean
// gray base that doesn't fight the indigo markers. Same style map-check
// uses. Free, no key, includes its own glyphs URL inside the JSON so we
// don't have to declare one inline.
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
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
const COLOR_RISK_HIGH = "#dc2626";     // red-600 — customer at high risk
const COLOR_RISK_MED  = "#d97706";     // amber-600 — medium risk
const COLOR_ACTIVE    = "#16a34a";     // green-600 — healthy / active

type Props = {
  customers: MapCustomer[];
};

export default function SalesMap({ customers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<MapCustomer | null>(null);

  // Listen for fly-to events dispatched from the filters panel search.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ customer: MapCustomer }>;
      const c = ce.detail?.customer;
      if (!c) return;
      mapRef.current?.flyTo({ center: [c.lng, c.lat], zoom: 14, essential: true });
      setSelected(c);
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
          kisaAd: c.kisaAd ?? "",
          adres: c.adres ?? "",
          sehir: c.sehir ?? "",
          ilce: c.ilce ?? "",
          distributor: c.distributor ?? "",
          hasSales: c.hasSales ? 1 : 0,
          // Numeric encoding for maplibre paint expressions:
          //   3 high · 2 medium · 1 active · 0 low/dormant
          riskScore:
            c.riskTier === "high" ? 3 :
            c.riskTier === "medium" ? 2 :
            c.riskTier === "active" ? 1 : 0,
          riskTier: c.riskTier,
          daysSinceLastSale: c.daysSinceLastSale ?? -1,
          daysSinceLastVisit: c.daysSinceLastVisit ?? -1,
          ciro30: c.ciro30,
          ciroPrev30: c.ciroPrev30,
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
        // Color priority: high risk first (red), then medium (amber), then
        // active (green), else muted (gray) for dormant/never-bought.
        "circle-color": [
          "match",
          ["get", "riskScore"],
          3, COLOR_RISK_HIGH,
          2, COLOR_RISK_MED,
          1, COLOR_ACTIVE,
          /* default */ COLOR_MUTED,
        ],
        // High-risk points get a bigger marker to draw the eye when scanning
        // a dense city; active are normal; dormant are small.
        "circle-radius": [
          "match",
          ["get", "riskScore"],
          3, 9,
          2, 7,
          1, 6,
          /* default */ 4,
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
      const dSale = Number(p.daysSinceLastSale);
      const dVisit = Number(p.daysSinceLastVisit);
      const c: MapCustomer = {
        id: Number(p.id),
        distKod: distKodNum > 0 ? distKodNum : null,
        unvan: String(p.unvan),
        kisaAd: (p.kisaAd as string) || null,
        adres: (p.adres as string) || null,
        sehir: (p.sehir as string) || null,
        ilce: (p.ilce as string) || null,
        distributor: (p.distributor as string) || null,
        lat: (f.geometry as GeoJSON.Point).coordinates[1] as number,
        lng: (f.geometry as GeoJSON.Point).coordinates[0] as number,
        hasSales: Number(p.hasSales) === 1,
        daysSinceLastSale: dSale >= 0 ? dSale : null,
        daysSinceLastVisit: dVisit >= 0 ? dVisit : null,
        ciro30: Number(p.ciro30 ?? 0),
        ciroPrev30: Number(p.ciroPrev30 ?? 0),
        riskTier: ((p.riskTier as string) || "low") as MapCustomer["riskTier"],
      };
      setSelected(c);
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

  return (
    <>
      {/* The container is the only thing that fills the parent box. No
          wrappers, no absolute children of its parent. Map-check style. */}
      <div ref={containerRef} className="w-full h-full" />

      {selected && (
        <CustomerModal customer={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
