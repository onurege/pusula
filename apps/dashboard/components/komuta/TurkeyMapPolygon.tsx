"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { KomutaRegionRow } from "@/lib/api";
import { FinanceAgentLauncher } from "./FinanceAgentLauncher";

type Props = {
  regions: KomutaRegionRow[];
};

const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
function getMapStyleForTheme(): string {
  if (typeof document === "undefined") return MAP_STYLE_LIGHT;
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? MAP_STYLE_DARK
    : MAP_STYLE_LIGHT;
}
const INITIAL_CENTER: [number, number] = [35.2, 39.0];
const INITIAL_ZOOM = 4.7;

// Alias hack'i artık yok — backend zaten klasik bölge isimleriyle
// ("Marmara", "Ege", "Doğu Anadolu", ...) veri gönderiyor. Şehir → bölge
// eşlemesi `data/geo/tr-province-region.json` üzerinden tek master üzerinden
// yapılıyor (/map sayfası ile aynı kaynak).
//
// Renklendirme: YoY artış/azalış bazlı (yeşil → gri → kırmızı). Sabit bölge
// rengi değil — Komuta'nın amacı "hangi bölge yanıyor" göstermek.

/** YoY delta'ya göre il polygon dolgu rengi — yeşil (büyüyen) → gri (yatay)
 *  → kırmızı (düşen). null deltaPct (geçen yıl 0 ciro) için nötr gri. */
function deltaColor(deltaPct: number | null): string {
  if (deltaPct == null) return "#a8a29e";
  if (deltaPct >= 15) return "#16a34a";
  if (deltaPct >= 5) return "#84cc16";
  if (deltaPct >= -5) return "#a8a29e";
  if (deltaPct >= -15) return "#ea580c";
  return "#dc2626";
}

/**
 * Komuta TR + KKTC haritası — gerçek il polygon'larıyla.
 *
 * Backend `regions` ı zaten klasik bölge isimleriyle ("Marmara", "Doğu
 * Anadolu", ...) ve master JSON renkleriyle dönüyor (fetchRegions →
 * data/geo/tr-province-region.json üzerinden). Bu component sadece
 * görselleştiriyor:
 *   - İl polygon'ları bölgenin sabit master rengiyle dolu (/map ile aynı)
 *   - Bölge etiketinde YoY% yazıyor
 *   - Karta tıklanınca /map?region=<klasik-bolge>'a gider
 */
export function TurkeyMapPolygon({ regions }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // bölge adı → row (data lookup için)
  const byBolge = useMemo(() => {
    const m = new Map<string, (typeof regions)[number]>();
    for (const r of regions) m.set(r.bolge, r);
    return m;
  }, [regions]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyleForTheme(),
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
      interactive: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;

    const onLoad = async () => {
      try {
        const res = await fetch("/geo/tr-provinces.geojson");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = (await res.json()) as GeoJSON.FeatureCollection;

        // Her il feature'ına bölgesinin YoY-bazlı rengini enjekte et —
        // yeşil/gri/kırmızı skala. Bölge eşlemesi backend'den (master JSON
        // ile şehir bazlı) geliyor, sadece renk YoY'ye göre belirleniyor.
        const enriched: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: raw.features.map((f) => {
            const cls = String((f.properties ?? {}).region ?? "");
            const row = byBolge.get(cls);
            const hasData = !!row && row.ciro > 0;
            return {
              ...f,
              properties: {
                ...(f.properties ?? {}),
                k_deltaPct: row?.deltaPct ?? -9999,
                k_color: deltaColor(row?.deltaPct ?? null),
                k_hasData: hasData ? 1 : 0,
              },
            };
          }),
        };

        if (!map.getSource("tr-prov")) {
          map.addSource("tr-prov", { type: "geojson", data: enriched });
        }
        if (!map.getLayer("prov-fill")) {
          map.addLayer({
            id: "prov-fill",
            type: "fill",
            source: "tr-prov",
            paint: {
              "fill-color": ["get", "k_color"],
              "fill-opacity": [
                "case",
                ["==", ["get", "k_hasData"], 1],
                0.55,
                0.12,
              ],
            },
          });
        }
        if (!map.getLayer("prov-outline")) {
          map.addLayer({
            id: "prov-outline",
            type: "line",
            source: "tr-prov",
            paint: {
              "line-color": "#44403c",
              "line-width": 0.5,
              "line-opacity": 0.4,
            },
          });
        }

        // Bölge etiketleri — 8 klasik bölgenin tamamı için centroid bas.
        // Backend her zaman 8 bölge döner (master JSON ile pre-seed); ciro
        // sıfır olan bölgeler "veri yok" gösterir, görsel olarak yerinde
        // kalır.
        const labelFeatures: GeoJSON.Feature[] = [];
        const masterCentroids: Record<string, [number, number]> = {
          Marmara: [29.2, 40.5],
          Ege: [28.2, 38.4],
          Akdeniz: [33.5, 36.9],
          "İç Anadolu": [33.6, 39.0],
          Karadeniz: [37.0, 41.2],
          "Doğu Anadolu": [41.5, 39.5],
          "Güneydoğu Anadolu": [40.0, 37.5],
          Kıbrıs: [33.4, 35.2],
        };
        for (const [cls, centroid] of Object.entries(masterCentroids)) {
          const row = byBolge.get(cls);
          const hasData = !!row && row.ciro > 0;
          const deltaPct = row?.deltaPct ?? null;
          const deltaLabel = !hasData
            ? "veri yok"
            : deltaPct == null
              ? "—"
              : `${deltaPct >= 0 ? "+" : ""}%${deltaPct.toFixed(0)} YoY`;
          labelFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: centroid },
            properties: {
              region: cls,
              deltaLabel,
              hasData: hasData ? 1 : 0,
            },
          });
        }
        if (!map.getSource("k-labels")) {
          map.addSource("k-labels", {
            type: "geojson",
            data: { type: "FeatureCollection", features: labelFeatures },
          });
        }
        if (!map.getLayer("k-region-name")) {
          map.addLayer({
            id: "k-region-name",
            type: "symbol",
            source: "k-labels",
            layout: {
              "text-field": ["concat", ["get", "region"], "\n", ["get", "deltaLabel"]],
              "text-size": 12,
              "text-font": ["Open Sans Semibold"],
              "text-allow-overlap": true,
              "text-ignore-placement": true,
              "text-anchor": "center",
              "text-letter-spacing": 0.05,
            },
            paint: {
              // Tema-bağımlı kontrast — dark zeminde beyaz, light'ta siyah.
              // Veri yoksa daha silik (gri) — kullanıcı hemen "burada veri yok"
              // anlasın, ama bölge tamamen kaybolmasın.
              "text-color":
                document.documentElement.getAttribute("data-theme") === "dark"
                  ? [
                      "case",
                      ["==", ["get", "hasData"], 1],
                      "#fafafa",
                      "#71717a",
                    ]
                  : [
                      "case",
                      ["==", ["get", "hasData"], 1],
                      "#0f172a",
                      "#78716c",
                    ],
              "text-halo-color":
                document.documentElement.getAttribute("data-theme") === "dark"
                  ? "#0a0a0b"
                  : "#ffffff",
              "text-halo-width": 3,
              "text-halo-blur": 0.4,
            },
          });
        }

        // İl tıklaması → klasik bölge ile /map drill-down
        map.on("click", "prov-fill", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const cls = String((f.properties as { region?: string }).region ?? "");
          if (!cls) return;
          const params = new URLSearchParams();
          params.set("region", cls);
          if (typeof window !== "undefined") {
            window.location.href = `/map?${params.toString()}`;
          }
        });
        map.on("mouseenter", "prov-fill", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "prov-fill", () => {
          map.getCanvas().style.cursor = "";
        });
      } catch (err) {
        console.error("[komuta map]", err);
      }
    };

    if (map.isStyleLoaded()) onLoad();
    else map.once("load", onLoad);

    // Tema değiştiğinde MapLibre base style'ı (positron ↔ dark-matter)
    // güncelle; layer'lar setStyle ile yıkıldığı için load event'inde
    // onLoad'u tekrar tetikliyoruz.
    const onThemeChange = () => {
      try {
        map.setStyle(getMapStyleForTheme());
        map.once("load", onLoad);
      } catch (err) {
        console.error("[komuta map theme]", err);
      }
    };
    window.addEventListener("enroute:theme:changed", onThemeChange);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("enroute:theme:changed", onThemeChange);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // byBolge değişirse veri güncellenmeli — basit yol: full remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byBolge]);

  // Veri olan bölge sayısı — header sub-text için
  const regionsWithData = regions.filter((r) => r.ciro > 0).length;

  return (
    <div className="panel map-panel">
      <div className="panel-header">
        <div className="panel-title">
          <span className="icon">🗺️</span> Türkiye + KKTC · Bölge × YoY
        </div>
        <div className="panel-meta map-panel-meta">
          <span>{regionsWithData}/8 bölgede satış var</span>
          <FinanceAgentLauncher
            regions={regions.map((r) => ({
              bolge: r.bolge,
              deltaPct: r.deltaPct,
            }))}
          />
        </div>
      </div>

      <div ref={containerRef} className="tmp-canvas" />

      <div className="tmp-legend">
        <span className="lg">
          <span className="dot" style={{ background: "#16a34a" }} /> +%15+
        </span>
        <span className="lg">
          <span className="dot" style={{ background: "#84cc16" }} /> +%5..+%15
        </span>
        <span className="lg">
          <span className="dot" style={{ background: "#a8a29e" }} /> ±%5
        </span>
        <span className="lg">
          <span className="dot" style={{ background: "#ea580c" }} /> -%5..-%15
        </span>
        <span className="lg">
          <span className="dot" style={{ background: "#dc2626" }} /> -%15-
        </span>
        <span className="lg muted">İl polygon'una tıklayınca /map'e gider</span>
      </div>

      {/* Bölge bazlı detay — her klasik bölgenin Pernod şehirleri + satış.
          "Doğu Anadolu boş mu, dolu mu" sorusuna doğrudan cevap verir. */}
      <details className="tmp-detail">
        <summary>
          🔍 Bölge bazlı şehir kırılımı (debug · {regions.length} klasik bölge)
        </summary>
        <div className="tmp-detail-grid">
          {regions
            .slice()
            .sort((a, b) => b.ciro - a.ciro)
            .map((r) => (
              <div key={r.bolge} className="tmp-detail-row">
                <span className="tmp-detail-bolge">
                  <span
                    className="tmp-detail-bolgedot"
                    style={{ background: r.color }}
                  />
                  {r.bolge}
                </span>
                <span className="tmp-detail-ciro">
                  {r.ciro > 0
                    ? `${Math.round(r.ciro / 1000).toLocaleString("tr-TR")} K`
                    : "veri yok"}
                </span>
                <span
                  className="tmp-detail-sehirler"
                  title={r.sehirler.join(", ")}
                >
                  {r.sehirler.length === 0
                    ? "—"
                    : `${r.sehirler.length} şehir: ${r.sehirler.slice(0, 5).join(", ")}${r.sehirler.length > 5 ? "…" : ""}`}
                </span>
              </div>
            ))}
        </div>
        <div className="tmp-detail-note">
          Şehir → bölge eşlemesi <code>data/geo/tr-province-region.json</code>
          {" · "}/map sayfası ile aynı master.
        </div>
      </details>

      <style jsx>{`
        .tmp-canvas {
          width: 100%;
          height: 320px;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid var(--color-border);
        }
        .tmp-legend {
          display: flex;
          gap: 14px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 10px;
          font-size: 10.5px;
          color: var(--color-fg-2);
        }
        .tmp-legend .lg {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .tmp-legend .lg.muted {
          color: var(--color-muted-2);
          margin-left: auto;
        }
        .tmp-legend .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
        }
        .tmp-unmatched {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          margin-top: 8px;
          padding: 8px 10px;
          background: var(--color-warn-soft);
          border: 1px solid var(--color-warn);
          border-radius: 6px;
          font-size: 10.5px;
        }
        .tmp-unmatched-label {
          color: var(--color-warn);
          font-weight: 600;
        }
        .tmp-unmatched-pill {
          background: var(--color-surface);
          color: var(--color-fg-2);
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid var(--color-border-strong);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10px;
        }
        .tmp-detail {
          margin-top: 10px;
          font-size: 11px;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: var(--color-surface-2);
        }
        .tmp-detail > summary {
          padding: 6px 10px;
          cursor: pointer;
          color: var(--color-muted);
          user-select: none;
          font-weight: 500;
        }
        .tmp-detail > summary:hover {
          color: var(--color-fg);
        }
        .tmp-detail[open] > summary {
          color: var(--color-fg);
          border-bottom: 1px solid var(--color-border);
        }
        .tmp-detail-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 2px;
          padding: 8px 10px;
          max-height: 240px;
          overflow-y: auto;
        }
        .tmp-detail-row {
          display: grid;
          grid-template-columns: minmax(140px, auto) 80px 1fr;
          gap: 10px;
          align-items: center;
          padding: 4px 6px;
          border-radius: 3px;
          font-size: 11px;
        }
        .tmp-detail-row:hover {
          background: var(--color-surface);
        }
        .tmp-detail-bolge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          color: var(--color-fg);
        }
        .tmp-detail-bolgedot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .tmp-detail-sehirler {
          color: var(--color-muted-2);
          font-size: 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tmp-detail-ciro {
          color: var(--color-fg-2);
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10.5px;
          text-align: right;
        }
        .tmp-detail-note {
          padding: 6px 10px;
          font-size: 10px;
          color: var(--color-muted-2);
          border-top: 1px solid var(--color-border);
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}
