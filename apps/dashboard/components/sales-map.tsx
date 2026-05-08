"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapCustomer } from "@/lib/api";
import { explainOnRadar } from "@/lib/api";

// CartoCDN positron — free, no API key, dark theme variant available.
const MAP_STYLE =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// Turkey-centered initial view.
const INITIAL_CENTER: [number, number] = [35.0, 39.0];
const INITIAL_ZOOM = 5.2;

type Props = {
  customers: MapCustomer[];
};

type SelectedCustomer = MapCustomer & { explainState?: ExplainState };
type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; brief?: string; sql?: string }
  | { kind: "err"; message: string };

export default function SalesMap({ customers }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const [selected, setSelected] = useState<SelectedCustomer | null>(null);
  const [explain, setExplain] = useState<ExplainState>({ kind: "idle" });

  // Tone thresholds for revenue colour. Numbers are last-30-day ciro in ₺.
  // High = healthy, Mid = ok, Low = needs attention, Zero = silent.
  // Designed for Pernod scale where a top customer does ~10M+/30d.
  const HIGH = 1_000_000;
  const MID = 100_000;

  const geojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: customers.map((c) => ({
        type: "Feature" as const,
        properties: {
          id: c.id,
          unvan: c.unvan,
          adres: c.adres ?? "",
          sehir: c.sehir ?? "",
          ilce: c.ilce ?? "",
          distributor: c.distributor ?? "",
          ciro30: c.ciro30,
          fatura30: c.fatura30,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [c.lng, c.lat] as [number, number],
        },
      })),
    }),
    [customers],
  );

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    map.on("load", () => setStyleReady(true));
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Add / refresh source + layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const SRC = "customers";
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
        ciroSum: ["+", ["get", "ciro30"]],
        highCount: ["+", ["case", [">=", ["get", "ciro30"], HIGH], 1, 0]],
      },
    });

    map.addLayer({
      id: "clusters",
      type: "circle",
      source: SRC,
      filter: ["has", "point_count"],
      paint: {
        // Cluster fill leans on revenue density: any high-revenue customer
        // pulls the cluster green; mostly silent clusters render gray.
        "circle-color": [
          "case",
          [">", ["get", "highCount"], 0],
          "oklch(0.78 0.18 145)", // good
          [">", ["get", "ciroSum"], MID],
          "oklch(0.78 0.16 60)", // accent
          "oklch(0.45 0 0)", // muted
        ],
        "circle-radius": [
          "step",
          ["get", "point_count"],
          18,
          25,
          22,
          100,
          28,
          500,
          36,
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "oklch(0.18 0 0)",
        "circle-opacity": 0.85,
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
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
      },
      paint: { "text-color": "#0a0a0a" },
    });

    map.addLayer({
      id: "unclustered",
      type: "circle",
      source: SRC,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "case",
          [">=", ["get", "ciro30"], HIGH],
          "oklch(0.78 0.18 145)",
          [">=", ["get", "ciro30"], MID],
          "oklch(0.78 0.16 60)",
          [">", ["get", "ciro30"], 0],
          "oklch(0.65 0 0)",
          "oklch(0.40 0 0)",
        ],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["get", "ciro30"],
          0,
          4,
          MID,
          7,
          HIGH,
          11,
          10_000_000,
          16,
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "oklch(0.18 0 0)",
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
      setSelected({
        id: Number(p.id),
        unvan: String(p.unvan),
        adres: (p.adres as string) || null,
        sehir: (p.sehir as string) || null,
        ilce: (p.ilce as string) || null,
        distributor: (p.distributor as string) || null,
        lat: (f.geometry as GeoJSON.Point).coordinates[1] as number,
        lng: (f.geometry as GeoJSON.Point).coordinates[0] as number,
        ciro30: Number(p.ciro30),
        fatura30: Number(p.fatura30),
      });
      setExplain({ kind: "idle" });
    });

    const setCursor = (cursor: string) => {
      map.getCanvas().style.cursor = cursor;
    };
    map.on("mouseenter", "clusters", () => setCursor("pointer"));
    map.on("mouseleave", "clusters", () => setCursor(""));
    map.on("mouseenter", "unclustered", () => setCursor("pointer"));
    map.on("mouseleave", "unclustered", () => setCursor(""));
  }, [styleReady, geojson]);

  async function runExplain(c: SelectedCustomer) {
    setExplain({ kind: "loading" });
    try {
      const res = await explainOnRadar(
        "sales",
        `Univera ERP'de "${c.unvan}" adlı müşteri (TBLMUSTERI.LNGKOD = ${c.id}, distribütör: ${c.distributor ?? "—"}, şehir: ${c.sehir ?? "—"}). Son 30 gün satış cirosu ${c.ciro30.toLocaleString("tr-TR")} ₺ ve ${c.fatura30} satış faturası kaydı var. Bu müşterinin son 30 gündeki **ürün grubu / marka kırılımını** TBLMSDFATURA + TBLMSDBELGEDETAY + TBLURUN üzerinden çıkar (TBLMSDFATURA.LNGMUSTERIKOD = ${c.id} AND BYTTUR=0 AND BYTDURUM=0). En çok ciro getiren 2-3 marka veya ürün grubunu somut adlarıyla, miktarlarıyla ver. 2-3 cümlelik Türkçe yönetici özeti yaz.`,
      );
      setExplain({ kind: "ok", brief: res.brief, sql: res.sql });
    } catch (err) {
      setExplain({ kind: "err", message: (err as Error).message });
    }
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="absolute inset-0" />

      {selected && (
        <div className="absolute right-4 top-4 w-[360px] max-h-[calc(100vh-160px)] overflow-y-auto rounded-xl border border-border bg-surface shadow-2xl z-10">
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
                  {formatCompact(selected.ciro30)} ₺
                </div>
              </div>
              <div className="rounded-lg border border-border bg-bg p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted">
                  Fatura Sayısı
                </div>
                <div className="text-xl font-semibold tracking-tight tabular-nums mt-1">
                  {selected.fatura30.toLocaleString("tr-TR")}
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => runExplain(selected)}
                disabled={explain.kind === "loading"}
                className="w-full inline-flex items-center justify-center gap-2 bg-accent text-accent-fg px-4 h-10 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {explain.kind === "loading" ? "Analiz ediliyor…" : "AI Analizi al"}
              </button>
            </div>

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

      {/* Legend */}
      <div className="absolute left-4 bottom-4 rounded-lg border border-border bg-surface/90 backdrop-blur p-3 text-xs space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">
          Son 30 gün cirosu
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ background: "oklch(0.78 0.18 145)" }} />
          1 Mn ₺ ve üzeri
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ background: "oklch(0.78 0.16 60)" }} />
          100 B – 1 Mn ₺
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ background: "oklch(0.65 0 0)" }} />
          Düşük aktivite
        </div>
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ background: "oklch(0.40 0 0)" }} />
          Sessiz (0 ₺)
        </div>
      </div>
    </div>
  );
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000_000)
    return (n / 1_000_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mr";
  if (Math.abs(n) >= 1_000_000)
    return (n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) + " Mn";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}
