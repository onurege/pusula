"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import maplibregl from "maplibre-gl";
import type {
  CustomerRiskScore,
  MapCityYoY,
  MapCustomer,
  MapRegion,
  RiskComponentKey,
  RiskTierV2,
} from "@/lib/api";
import { trendColor } from "@/components/komuta/trend-colors";
import { CustomerModal } from "./customer-modal";

/**
 * GeoJSON property'sinden composite Risk Score'u geri kurar. MapLibre
 * feature properties string|number|null tuttuğu için tam objeyi JSON-string
 * olarak serialize edip burada parse ediyoruz.
 */
function parseRiskScoreJson(raw: string | number | null | undefined): CustomerRiskScore {
  const fallback: CustomerRiskScore = {
    score: null,
    tier: "unknown",
    components: {
      momentum: null,
      behavioral: null,
      payment: null,
      engagement: null,
    },
    reasons: ["Risk skoru bu müşteri için henüz yüklenmedi."],
  };
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomerRiskScore>;
    const tier: RiskTierV2 =
      parsed.tier === "healthy" ||
      parsed.tier === "watch" ||
      parsed.tier === "risk" ||
      parsed.tier === "critical" ||
      parsed.tier === "unknown"
        ? parsed.tier
        : "unknown";
    const c: Partial<Record<RiskComponentKey, number | null>> =
      parsed.components ?? {};
    const componentVal = (k: RiskComponentKey): number | null =>
      typeof c[k] === "number" ? (c[k] as number) : null;
    return {
      score: typeof parsed.score === "number" ? parsed.score : null,
      tier,
      components: {
        momentum: componentVal("momentum"),
        behavioral: componentVal("behavioral"),
        payment: componentVal("payment"),
        engagement: componentVal("engagement"),
      },
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((x): x is string => typeof x === "string")
        : fallback.reasons,
    };
  } catch {
    return fallback;
  }
}

// CARTO Positron (light) / Dark Matter (dark) — vector styles with proper
// Turkish labels. Tema toggle ile dinamik geçişli; harita instance'ı
// `setStyle()` ile yenilenir, layer'lar effect tarafından yeniden eklenir.
const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
function getMapStyleForTheme(): string {
  if (typeof document === "undefined") return MAP_STYLE_LIGHT;
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? MAP_STYLE_DARK
    : MAP_STYLE_LIGHT;
}
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

// Composite Risk Score tier renkleri — UI dilinde "Kritik / Riskli /
// İzlemede / Sağlıklı / Yetersiz veri".
const COLOR_TIER_CRITICAL = "#dc2626"; // red-600
const COLOR_TIER_RISK     = "#ea580c"; // orange-600
const COLOR_TIER_WATCH    = "#d97706"; // amber-600
const COLOR_TIER_HEALTHY  = "#16a34a"; // green-600
const COLOR_TIER_UNKNOWN  = "#a1a1aa"; // zinc-400

type Props = {
  customers: MapCustomer[];
  regions?: MapRegion[];
  /** Şehir bazlı YoY — view=city için. Backend MSSQL'den taze hesaplar
   *  (son 30g vs geçen yıl aynı 30g). Müşteri-bazlı agregasyon değil. */
  cities?: MapCityYoY[];
  viewMode?: "customer" | "region" | "city";
};

export default function SalesMap({
  customers,
  regions = [],
  cities = [],
  viewMode = "customer",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [selected, setSelected] = useState<MapCustomer | null>(null);
  // mapReady: harita stili tamamen yüklendi mi (kaynak/layer eklenebilir mi).
  // Effect'lerin "map mount ile aynı tick'te tetiklendi ama map henüz hazır
  // değil" race condition'ını engellemek için state.
  const [mapReady, setMapReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Click handler bunları capture edebilsin diye ref'te tut — useEffect deps
  // listesine girince her search param değişiminde cleanup/setup loop'una sokar.
  const navRef = useRef({ router, pathname, sp });
  navRef.current = { router, pathname, sp };

  // Aynı sebepten: regions ref'te tutulur, deps loop'unu önler. Hem layer
  // setup hem data güncelleme buradan okur.
  const regionsRef = useRef(regions);
  regionsRef.current = regions;

  // customers ref'te tutulur — city view effect'i customers'ı dep'e koyup
  // her prop reference değişiminde re-trigger olmasın. URL filter değişimi
  // ile sayfa yeniden yüklenip yeni customers geleceği zaten effect'i
  // regionFilter dep üzerinden tetikler (regionFilter sehir filtresinden
  // bağımsız).
  const customersRef = useRef(customers);
  customersRef.current = customers;

  // cities ref — view=city için backend'den gelen şehir bazlı YoY data.
  // Customer agregasyonu yerine (MoM idi) gerçek YoY (son 30g vs geçen yıl
  // aynı 30g) kullanıyoruz. Komuta haritasıyla aynı pencere.
  const citiesRef = useRef(cities);
  citiesRef.current = cities;
  // Cities array içerikleri değişince city useEffect'in tetiklenmesi için
  // stabil signature
  const citiesKey = useMemo(
    () =>
      cities
        .map((c) => `${c.sehirNorm}:${c.ciro}:${c.ciroPrev}`)
        .sort()
        .join("|"),
    [cities],
  );

  // Filter-driven veri tazelemelerinde paint'in güncellenmesi için stabil
  // signature. Aynı veri → aynı string → effect re-run yok. Veri değişti
  // (composite tier sayıları farklı) → string değişti → effect tetiklenir
  // ve fill renkleri / etiket sayıları yenilenir.
  const regionsKey = useMemo(
    () =>
      regions
        .map(
          (r) =>
            `${r.bolge}:${r.musteriSayisi}:${r.critical}:${r.risk}:${r.watch}:${r.healthy}`,
        )
        .join("|"),
    [regions],
  );

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

  // Region drill-down sonrası: customer mode'da ?region= varsa, regions
  // master'dan o bölgenin centroid'ine + uygun zoom'a fit et.
  const regionFilter = sp.get("region");
  useEffect(() => {
    if (viewMode !== "customer" || !regionFilter) return;
    const target = regions.find((r) => r.bolge === regionFilter);
    if (!target) return;
    const map = mapRef.current;
    if (!map) return;
    // Coğrafi büyüklüğe göre zoom: KKTC küçük, Doğu Anadolu büyük
    const isSmall = target.bolge === "Kıbrıs";
    map.easeTo({
      center: [target.lng, target.lat],
      zoom: isSmall ? 8.5 : 6.5,
      duration: 700,
    });
  }, [viewMode, regionFilter, regions]);

  // Region geojson — her bölge için tek bir point (centroid). Region mode
  // açıkken bu kaynak üzerinden tek katmanlı büyük balonlar render edilir.
  // greenRatio artık composite tier'lardan türetilir:
  //   green = healthy + 0.6*watch,  red = critical + 0.6*risk
  //   ratio = green / (green + red). Bilinen müşteri 0 ise null (-1) → gri.
  const regionGeojson = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: regions.map((r) => {
        const rankedTotal = r.critical + r.risk + r.watch + r.healthy;
        const green = r.healthy + 0.6 * r.watch;
        const red = r.critical + 0.6 * r.risk;
        const greenRatio = green + red > 0 ? green / (green + red) : -1;
        return {
          type: "Feature" as const,
          properties: {
            bolge: r.bolge,
            musteriSayisi: r.musteriSayisi,
            critical: r.critical,
            risk: r.risk,
            watch: r.watch,
            healthy: r.healthy,
            unknown: r.unknown,
            rankedTotal,
            greenRatio,
            ciro30: r.ciro30,
          },
          geometry: {
            type: "Point" as const,
            coordinates: [r.lng, r.lat] as [number, number],
          },
        };
      }),
    }),
    [regions],
  );

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
          musteriKodu: c.musteriKodu ?? "",
          takipKodu: c.takipKodu ?? "",
          adres: c.adres ?? "",
          sehir: c.sehir ?? "",
          ilce: c.ilce ?? "",
          distributor: c.distributor ?? "",
          bolge: c.bolge ?? "",
          hasSales: c.hasSales ? 1 : 0,
          // Yeni composite Risk Score modeli — paint expression'lar bunu
          // okur. UI cutover sonrası eski `riskTier` field'ları sadece
          // back-compat için duruyor (modal'da fallback'lerde kullanılabilir).
          riskTierV2: c.riskScore.tier,
          riskTier: c.riskTier,
          // Tam Risk Score objesi — JSON string olarak tutuluyor ki
          // unclustered click handler tam objeyi geri kurabilsin (komponent
          // skorları + reasons). Paint expression'lar bu string'i okumaz.
          riskScoreJson: JSON.stringify(c.riskScore),
          daysSinceLastSale: c.daysSinceLastSale ?? -1,
          daysSinceLastVisit: c.daysSinceLastVisit ?? -1,
          ciro30: c.ciro30,
          ciroPrev30: c.ciroPrev30,
          activityDays: c.activityDays,
          activityCiro: c.activityCiro,
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
      style: getMapStyleForTheme(),
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    // Debug — global expose
    (window as unknown as { __map: maplibregl.Map }).__map = map;
    const onLoaded = () => {
      // ssr:false dynamic import + flexbox layout often gives the map a 0×0
      // canvas on first paint. Force a resize once we're loaded.
      map.resize();
      setMapReady(true);
    };
    // İdle event = "tüm style/tile yüklendi + render bitti" — load'dan daha
    // garantili. once handler ile bir kez tetiklenir. HMR/StrictMode'da
    // race olsa da idle her zaman tetiklenir.
    map.once("idle", onLoaded);
    // Backup: load event'ini de bekle (idle gelmezse).
    map.once("load", onLoaded);

    const resize = () => map.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Tema değiştiğinde MapLibre base style'ı (positron ↔ dark-matter) güncelle.
  // setStyle layer'ları yıkar; mapReady false'a çekilip sonra true'ya geçer
  // ki effect'ler customer/region katmanlarını yeniden eklesin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onThemeChange = () => {
      try {
        setMapReady(false);
        map.setStyle(getMapStyleForTheme());
        map.once("idle", () => setMapReady(true));
        map.once("load", () => setMapReady(true));
      } catch (err) {
        console.error("[sales-map] setStyle failed:", err);
      }
    };
    window.addEventListener("enroute:theme:changed", onThemeChange);
    return () => window.removeEventListener("enroute:theme:changed", onThemeChange);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Region modunda customer katmanlarını hiç ekleme — temiz render.
    if (viewMode !== "customer") return;

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
          // Cluster içindeki composite Risk Score tier sayıları. MapLibre
          // clusterProperties map expression subset'i `case` desteklemediği
          // için boolean'ı `to-number` ile 0/1'e çeviriyoruz.
          criticalCount: [
            "+",
            ["to-number", ["==", ["get", "riskTierV2"], "critical"]],
          ],
          riskCount: [
            "+",
            ["to-number", ["==", ["get", "riskTierV2"], "risk"]],
          ],
          watchCount: [
            "+",
            ["to-number", ["==", ["get", "riskTierV2"], "watch"]],
          ],
          healthyCount: [
            "+",
            ["to-number", ["==", ["get", "riskTierV2"], "healthy"]],
          ],
          unknownCount: [
            "+",
            ["to-number", ["==", ["get", "riskTierV2"], "unknown"]],
          ],
        },
      });

    map.addLayer({
      id: "clusters",
      type: "circle",
      source: SRC,
      filter: ["has", "point_count"],
      paint: {
        // Cluster rengi = içerdiği "kırmızı ağırlık" oranı.
        //   redWeight   = critical + 0.6*risk    (yüksek + orta-yüksek risk)
        //   greenWeight = healthy + 0.6*watch    (sağlam + erken-uyarı)
        //   redRatio    = redWeight / (redWeight + greenWeight)
        // Bilinen müşteri toplamı 0 ise (sadece unknown) gri.
        "circle-color": [
          "case",
          [
            "==",
            [
              "+",
              ["to-number", ["get", "criticalCount"]],
              ["to-number", ["get", "riskCount"]],
              ["to-number", ["get", "watchCount"]],
              ["to-number", ["get", "healthyCount"]],
            ],
            0,
          ],
          COLOR_TIER_UNKNOWN,
          [
            "interpolate",
            ["linear"],
            [
              "/",
              [
                "+",
                ["to-number", ["get", "criticalCount"]],
                ["*", 0.6, ["to-number", ["get", "riskCount"]]],
              ],
              [
                "+",
                ["to-number", ["get", "criticalCount"]],
                ["to-number", ["get", "riskCount"]],
                ["to-number", ["get", "watchCount"]],
                ["to-number", ["get", "healthyCount"]],
              ],
            ],
            0,    COLOR_TIER_HEALTHY,  // tüm sağlıklı
            0.25, "#84cc16",            // çoğunluk healthy/watch
            0.5,  COLOR_TIER_WATCH,    // karışık (amber)
            0.75, COLOR_TIER_RISK,     // çoğunluk risk
            1,    COLOR_TIER_CRITICAL, // tüm critical
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
        // Composite Risk Score tier rengi.
        //   critical → red, risk → orange, watch → amber, healthy → green,
        //   unknown → gray.
        "circle-color": [
          "match",
          ["get", "riskTierV2"],
          "critical", COLOR_TIER_CRITICAL,
          "risk",     COLOR_TIER_RISK,
          "watch",    COLOR_TIER_WATCH,
          "healthy",  COLOR_TIER_HEALTHY,
          /* default (unknown) */ COLOR_TIER_UNKNOWN,
        ],
        // Tier yükseldikçe daha büyük marker — yoğun şehirde gözü yakalar.
        "circle-radius": [
          "match",
          ["get", "riskTierV2"],
          "critical", 9,
          "risk",     7.5,
          "watch",    6,
          "healthy",  6,
          /* default (unknown) */ 4,
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
        musteriKodu: (p.musteriKodu as string) || null,
        takipKodu: (p.takipKodu as string) || null,
        adres: (p.adres as string) || null,
        sehir: (p.sehir as string) || null,
        ilce: (p.ilce as string) || null,
        distributor: (p.distributor as string) || null,
        bolge: (p.bolge as string) || null,
        lat: (f.geometry as GeoJSON.Point).coordinates[1] as number,
        lng: (f.geometry as GeoJSON.Point).coordinates[0] as number,
        hasSales: Number(p.hasSales) === 1,
        daysSinceLastSale: dSale >= 0 ? dSale : null,
        daysSinceLastVisit: dVisit >= 0 ? dVisit : null,
        ciro30: Number(p.ciro30 ?? 0),
        ciroPrev30: Number(p.ciroPrev30 ?? 0),
        activityDays: Number(p.activityDays ?? 30),
        activityCiro: Number(p.activityCiro ?? p.ciro30 ?? 0),
        riskTier: ((p.riskTier as string) || "low") as MapCustomer["riskTier"],
        riskScore: parseRiskScoreJson(p.riskScoreJson),
      };
      setSelected(c);
    });

    // Çift tıklama → bir seviye derine in (drill-down).
    //   distKod yoksa  → ?distKod=...  (distribütör seviyesi filter)
    //   distKod varsa  → modal aç (zaten en alt seviye)
    // Müşteri marker default-zoom interaksiyonunu engellemek için preventDefault.
    map.on("dblclick", "unclustered", (e) => {
      e.preventDefault();
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string | number>;
      const distKodNum = Number(p.distKod);
      const sehirStr = String(p.sehir ?? "");
      const { router: rt, pathname: pn, sp: sParams } = navRef.current;
      const params = new URLSearchParams(sParams.toString());
      // Mevcut seviyeye göre bir alt seviyeye in
      if (!sParams.get("sehir") && sehirStr) {
        params.set("sehir", sehirStr);
      } else if (!sParams.get("distKod") && distKodNum > 0) {
        params.set("distKod", String(distKodNum));
      } else {
        // Zaten en altta — modal aç (default click davranışı)
        return;
      }
      rt.push(`${pn}?${params.toString()}`);
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

    // viewMode region'a geçince customer kaynak ve katmanlarını temizle.
    return () => {
      try {
        if (map.getLayer("clusters")) map.removeLayer("clusters");
        if (map.getLayer("cluster-count")) map.removeLayer("cluster-count");
        if (map.getLayer("unclustered")) map.removeLayer("unclustered");
        if (map.getSource("customers")) map.removeSource("customers");
      } catch {
        // map kaldırılmış olabilir — yut
      }
    };
  }, [geojson, viewMode, mapReady]);

  // Region katmanı — viewMode === "region" iken TR il polygon'larını fill
  // ile renkler. Aynı klasik bölgenin il'leri aynı renge boyanır →
  // birleşik bölge görünümü. Polygon kaynağı statik:
  // /geo/tr-provinces.geojson (her feature.properties.region zaten dolu).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (viewMode !== "region") return;

    const PROV_SRC = "tr-provinces";
    const CENT_SRC = "region-centroids";

    let cancelled = false;

    // styleHasLayers: isStyleLoaded() external tile'lar yüklenene kadar
    // false dönebilir (MapLibre v3 quirk). Style spec layer'larının yüklenmiş
    // olması source/layer eklemek için yeterli — daha güvenilir gösterge.
    const styleReady = () =>
      (map.getStyle()?.layers?.length ?? 0) > 0;

    const apply = async () => {
      if (!styleReady()) return;

      // İl polygon GeoJSON'unu fetch et (cache'lenir tarayıcıda)
      let provGeo: GeoJSON.FeatureCollection | null = null;
      try {
        const r = await fetch("/geo/tr-provinces.geojson");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        provGeo = await r.json();
      } catch (e) {
        console.error("[sales-map] il GeoJSON yüklenemedi:", e);
        return;
      }
      if (!provGeo) return;
      // cancelled check'i fetch sonrası kaldırıldı — setup idempotent
      // (remove + add), HMR remount sırasında stale durum kalmaz.

      // Bölge → metric eşlemesi (composite tier ağırlıklı greenRatio + sayım)
      type RegMetric = { greenRatio: number; musteriSayisi: number; color: string };
      const metrics = new Map<string, RegMetric>();
      for (const r of regionsRef.current) {
        const green = r.healthy + 0.6 * r.watch;
        const red = r.critical + 0.6 * r.risk;
        const denom = green + red;
        metrics.set(r.bolge, {
          // denom 0 ise (bilinen müşteri yok) -1 → fill'de "veri yok" gri'sine düşer
          greenRatio: denom > 0 ? green / denom : -1,
          musteriSayisi: r.musteriSayisi,
          color: r.color,
        });
      }

      // Her il feature'ına agg metric'i ekle (data-driven paint için)
      const enriched: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: provGeo.features.map((f) => {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          const regionName = String(p.region ?? "");
          const m = metrics.get(regionName);
          return {
            ...f,
            properties: {
              ...p,
              greenRatio: m?.greenRatio ?? -1, // -1 = veri yok
              musteriSayisi: m?.musteriSayisi ?? 0,
            },
          };
        }),
      };

      // Centroid kaynak — etiketler için (regionGeojson zaten bizim
      // weighted-centroid verimiz; merkeze koy)
      const existingProv = map.getSource(PROV_SRC) as maplibregl.GeoJSONSource | undefined;
      if (existingProv) {
        existingProv.setData(enriched);
      } else {
        map.addSource(PROV_SRC, { type: "geojson", data: enriched });
      }
      const existingCent = map.getSource(CENT_SRC) as maplibregl.GeoJSONSource | undefined;
      if (existingCent) {
        existingCent.setData(regionGeojson);
      } else {
        map.addSource(CENT_SRC, { type: "geojson", data: regionGeojson });
      }

      // Layer'ları her zaman yeniden ekle — HMR/race sırasında stale state
      // kalmasın. addLayer "exists" hata atar; bu yüzden önce sil sonra ekle.
      if (map.getLayer("region-fill")) map.removeLayer("region-fill");
      if (map.getLayer("region-outline")) map.removeLayer("region-outline");
      if (map.getLayer("region-label")) map.removeLayer("region-label");

      // Fill layer — aynı klasik bölgenin il'leri aynı rengi alır
      map.addLayer({
        id: "region-fill",
        type: "fill",
        source: PROV_SRC,
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "greenRatio"], -1],
            COLOR_MUTED,
            [
              "interpolate",
              ["linear"],
              ["get", "greenRatio"],
              0,    "#dc2626",
              0.25, "#ef4444",
              0.5,  "#f59e0b",
              0.75, "#84cc16",
              1,    "#16a34a",
            ],
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "greenRatio"], -1],
            0.18,
            0.55,
          ],
        },
      });

      // Region sınır çizgisi
      map.addLayer({
        id: "region-outline",
        type: "line",
        source: PROV_SRC,
        paint: {
          "line-color": "#44403c",
          "line-width": 0.8,
          "line-opacity": 0.5,
        },
      });

      // Bölge adı + müşteri sayısı (centroid'de).
      map.addLayer({
        id: "region-label",
        type: "symbol",
        source: CENT_SRC,
        layout: {
          "text-field": [
            "concat",
            ["get", "bolge"],
            "\n",
            ["to-string", ["get", "musteriSayisi"]],
          ],
          "text-size": 15,
          "text-font": ["Open Sans Semibold"],
          "text-anchor": "center",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
          "text-letter-spacing": 0.04,
        },
        paint: {
          "text-color":
            typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme") === "dark"
              ? "#fafafa"
              : "#0f172a",
          "text-halo-color":
            typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme") === "dark"
              ? "#0a0a0b"
              : "#ffffff",
          "text-halo-width": 3,
          "text-halo-blur": 0.5,
        },
      });

      // Drill-down: il polygon'una tıklayınca city view + ?region=<bolge>
      // (eski davranış customer'a sıçrıyordu; artık ara seviye city var:
      // region → city → customer)
      map.on("click", "region-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const regionName = String((f.properties as { region?: string }).region ?? "");
        if (!regionName) return;
        const { router: rt, pathname: pn, sp: sParams } = navRef.current;
        const params = new URLSearchParams(sParams.toString());
        params.set("view", "city");
        params.delete("bolge"); // legacy filter'i temizle
        params.delete("sehir"); // önceki sehir filter'ı varsa kaldır
        params.set("region", regionName);
        rt.push(`${pn}?${params.toString()}`);
      });

      const setCursor = (cursor: string) => {
        map.getCanvas().style.cursor = cursor;
      };
      map.on("mouseenter", "region-fill", () => setCursor("pointer"));
      map.on("mouseleave", "region-fill", () => setCursor(""));
    };

    // isStyleLoaded() ve idle event timing'i MapLibre v3'te kararsız. Polling
    // ile periyodik check yapıp ilk hazır olduğunda apply çağır.
    let applied = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tryApply = () => {
      if (applied || cancelled) return;
      if (map.isStyleLoaded()) {
        applied = true;
        void apply();
        return;
      }
      timer = setTimeout(tryApply, 100);
    };
    tryApply();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try {
        if (map.getLayer("region-label")) map.removeLayer("region-label");
        if (map.getLayer("region-outline")) map.removeLayer("region-outline");
        if (map.getLayer("region-fill")) map.removeLayer("region-fill");
        if (map.getSource("region-centroids")) map.removeSource("region-centroids");
        if (map.getSource("tr-provinces")) map.removeSource("tr-provinces");
      } catch {
        // yut
      }
    };
    // mapReady ile race condition korunur — map henüz yüklenmemişken effect
    // tetiklenirse early return etmesin, mapReady true olunca tekrar fire et.
    // regionsKey değişirse (filter ile bölge metrikleri güncellendi) layer
    // yeniden kurulur ve fill renkleri tazelenir.
  }, [viewMode, mapReady, regionsKey]);

  // Customer drill-down il sınırı overlay'i — viewMode === "customer" ve
  // ?region= varken, o klasik bölgenin il'lerini dashed outline + il adı
  // etiketi olarak çizer. Maraş'ın Pazarcık ilçesi gibi sınır noktalar
  // basemap'in "Gaziantep" yazısının dibine düşünce kafa karışıyordu;
  // il sınırı çizgisi noktaları görsel olarak doğru il'e yerleştirir.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (viewMode !== "customer" || !regionFilter) return;

    const PROV_SRC = "drill-provinces";
    const CENT_SRC = "drill-province-centroids";
    let cancelled = false;
    let applied = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // İl polygon'unun ana gövdesi için tek bir merkez nokta — etiket buraya
    // konur. MultiPolygon (İzmir = yarımada + adalar) için en BÜYÜK polygon'un
    // bbox merkezi alınır; küçük adalar etiket spamı yapmasın.
    // Area-weighted polygon centroid (shoelace formula) — gerçek geometrik
    // merkez. Düzensiz şekillerde (İzmir gibi yarımadalı/körfezli il)
    // bbox-center yanlış il'e düşerken bu, polygon'un içinde / doğru noktada
    // kalır.
    const ringCentroidArea = (
      ring: number[][],
    ): { cx: number; cy: number; area: number } => {
      let sumX = 0, sumY = 0, sumA = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        const a = x0 * y1 - x1 * y0;
        sumA += a;
        sumX += (x0 + x1) * a;
        sumY += (y0 + y1) * a;
      }
      const signedArea = sumA / 2;
      if (signedArea === 0) {
        return {
          cx: ring[0]?.[0] ?? 0,
          cy: ring[0]?.[1] ?? 0,
          area: 0,
        };
      }
      return {
        cx: sumX / (6 * signedArea),
        cy: sumY / (6 * signedArea),
        area: Math.abs(signedArea),
      };
    };
    const featureCentroid = (geom: GeoJSON.Geometry): [number, number] | null => {
      if (geom.type === "Polygon") {
        const c = ringCentroidArea(geom.coordinates[0]);
        return [c.cx, c.cy];
      }
      if (geom.type === "MultiPolygon") {
        // Tüm parçaların alan-ağırlıklı ortalaması (İzmir adaları dahil
        // ana karaya çekilir, salt en büyük parça'nın bbox merkezi değil).
        let wx = 0, wy = 0, totalA = 0;
        for (const poly of geom.coordinates) {
          const c = ringCentroidArea(poly[0]);
          wx += c.cx * c.area;
          wy += c.cy * c.area;
          totalA += c.area;
        }
        if (totalA === 0) return null;
        return [wx / totalA, wy / totalA];
      }
      return null;
    };

    const apply = async () => {
      if (cancelled || !map.isStyleLoaded()) return;

      let geo: GeoJSON.FeatureCollection | null = null;
      try {
        const r = await fetch("/geo/tr-provinces.geojson");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        geo = await r.json();
      } catch (e) {
        console.error("[sales-map] drill-down il geojson yüklenemedi:", e);
        return;
      }
      if (!geo || cancelled) return;

      // Sadece drill-down bölgesinin il'leri
      const filtered: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: geo.features.filter(
          (f) =>
            String((f.properties ?? {}).region ?? "") === regionFilter,
        ),
      };

      // Centroid'ler (il başına tek Point) — etiketler için ayrı source
      const centroidFeatures: GeoJSON.Feature[] = [];
      for (const f of filtered.features) {
        const c = featureCentroid(f.geometry);
        if (!c) continue;
        centroidFeatures.push({
          type: "Feature",
          properties: { name: String((f.properties ?? {}).name ?? "") },
          geometry: { type: "Point", coordinates: c },
        });
      }
      const centroids: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: centroidFeatures,
      };

      const existing = map.getSource(PROV_SRC) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) existing.setData(filtered);
      else map.addSource(PROV_SRC, { type: "geojson", data: filtered });

      const existingCent = map.getSource(CENT_SRC) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existingCent) existingCent.setData(centroids);
      else map.addSource(CENT_SRC, { type: "geojson", data: centroids });

      // Clusters layer'ı varsa onun ALTINA yerleştir — point click'leri
      // bloklamasın diye fill ve outline en altta kalsın.
      const beforeId = map.getLayer("clusters") ? "clusters" : undefined;

      if (map.getLayer("drill-fill")) map.removeLayer("drill-fill");
      map.addLayer(
        {
          id: "drill-fill",
          type: "fill",
          source: PROV_SRC,
          paint: {
            "fill-color": ["get", "regionColor"],
            // Çok düşük opacity — sadece il alanını hafifçe boya, noktalar
            // baskın kalsın. Drill-down olduğunu ima eden subtle vurgu.
            "fill-opacity": 0.06,
          },
        },
        beforeId,
      );

      if (map.getLayer("drill-outline")) map.removeLayer("drill-outline");
      map.addLayer(
        {
          id: "drill-outline",
          type: "line",
          source: PROV_SRC,
          paint: {
            "line-color": ["get", "regionColor"],
            "line-width": 1.5,
            "line-opacity": 0.75,
            // Kesik çizgi — basemap'in il sınırlarıyla karışmasın diye.
            "line-dasharray": [2, 2],
          },
        },
        beforeId,
      );

      // İl ad etiketleri — en üstte (noktaların üstüne). Polygon kaynağı
      // değil, il başına TEK Point içeren centroid kaynağı kullanılır;
      // MultiPolygon il'lerde (İzmir vs.) parça başına etiket çıkmasın.
      if (map.getLayer("drill-label")) map.removeLayer("drill-label");
      map.addLayer({
        id: "drill-label",
        type: "symbol",
        source: CENT_SRC,
        // Düşük zoom'da il etiketleri spam yapmasın — 7+ zoom'da görünsün
        minzoom: 6.5,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 13,
          "text-font": ["Open Sans Semibold"],
          "text-anchor": "center",
          "text-letter-spacing": 0.05,
          // Centroid'ler il başına tek olduğu için overlap olmaz; emin olmak
          // için allow-overlap=false bırakıyoruz (yine de zoom out'ta küçük
          // illerin etiketleri komşusuna çakışırsa biri gizlenir).
          "text-allow-overlap": false,
        },
        paint: {
          "text-color":
            typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme") === "dark"
              ? "#fafafa"
              : "#0f172a",
          "text-halo-color":
            typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme") === "dark"
              ? "#0a0a0b"
              : "#ffffff",
          "text-halo-width": 2.5,
          "text-halo-blur": 0.4,
        },
      });
    };

    const tryApply = () => {
      if (applied || cancelled) return;
      if (map.isStyleLoaded()) {
        applied = true;
        void apply();
        return;
      }
      timer = setTimeout(tryApply, 100);
    };
    tryApply();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try {
        if (map.getLayer("drill-label")) map.removeLayer("drill-label");
        if (map.getLayer("drill-outline")) map.removeLayer("drill-outline");
        if (map.getLayer("drill-fill")) map.removeLayer("drill-fill");
        if (map.getSource("drill-province-centroids"))
          map.removeSource("drill-province-centroids");
        if (map.getSource("drill-provinces")) map.removeSource("drill-provinces");
      } catch {
        // yut
      }
    };
  }, [viewMode, mapReady, regionFilter]);

  // === City view useEffect — viewMode === "city" + regionFilter =============
  // Bölgenin illerini, müşterilerden agrege edilen YoY rengiyle dolu polygon
  // olarak çizer. İl'e tıklayınca → view=customer&sehir=<il> drill-down.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (viewMode !== "city" || !regionFilter) return;

    const CITY_SRC = "city-provinces";
    const CITY_CENTROIDS_SRC = "city-province-centroids";
    let cancelled = false;
    let applied = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // YoY rengi — ortak pastel trend palette (TurkeyMapPolygon + Treemap +
    // ExecutionGapScatter ile birebir aynı tonlar). trendColor helper'ı
    // components/komuta/trend-colors.ts.
    const cityDeltaColor = trendColor;

    // TR diacritic-strip + uppercase (customer.sehir → geojson province_norm
    // ile eşleştirmek için). "İstanbul" → "ISTANBUL"
    const normalizeSehir = (s: string | null | undefined): string => {
      if (!s) return "";
      return s
        .replace(/İ/g, "I").replace(/ı/g, "I").replace(/I/g, "I").replace(/i/g, "I")
        .replace(/Ş/g, "S").replace(/ş/g, "S")
        .replace(/Ğ/g, "G").replace(/ğ/g, "G")
        .replace(/Ü/g, "U").replace(/ü/g, "U")
        .replace(/Ö/g, "O").replace(/ö/g, "O")
        .replace(/Ç/g, "C").replace(/ç/g, "C")
        .toUpperCase().trim();
    };

    // Şehir bazlı YoY artık backend'den (MSSQL gerçek YoY pencereli) geliyor —
    // customer agregasyonuna gerek yok. cities prop'unu province_norm → veri
    // map'ine çevir.
    const cityAgg = new Map<
      string,
      { ciro: number; ciroPrev: number; rawSehir: string }
    >();
    for (const c of citiesRef.current) {
      cityAgg.set(c.sehirNorm, {
        ciro: c.ciro,
        ciroPrev: c.ciroPrev,
        rawSehir: c.sehir,
      });
    }

    // Centroid hesabı için yardımcılar (drill-province'tan kopyalanmış)
    // Area-weighted polygon centroid (shoelace formula) — gerçek geometrik
    // merkez. Düzensiz şekillerde (İzmir gibi yarımadalı/körfezli il)
    // bbox-center yanlış il'e düşerken bu, polygon'un içinde / doğru noktada
    // kalır.
    const ringCentroidArea = (
      ring: number[][],
    ): { cx: number; cy: number; area: number } => {
      let sumX = 0, sumY = 0, sumA = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        const a = x0 * y1 - x1 * y0;
        sumA += a;
        sumX += (x0 + x1) * a;
        sumY += (y0 + y1) * a;
      }
      const signedArea = sumA / 2;
      if (signedArea === 0) {
        return {
          cx: ring[0]?.[0] ?? 0,
          cy: ring[0]?.[1] ?? 0,
          area: 0,
        };
      }
      return {
        cx: sumX / (6 * signedArea),
        cy: sumY / (6 * signedArea),
        area: Math.abs(signedArea),
      };
    };
    const featureCentroid = (geom: GeoJSON.Geometry): [number, number] | null => {
      if (geom.type === "Polygon") {
        const c = ringCentroidArea(geom.coordinates[0]);
        return [c.cx, c.cy];
      }
      if (geom.type === "MultiPolygon") {
        // Tüm parçaların alan-ağırlıklı ortalaması (İzmir adaları dahil
        // ana karaya çekilir, salt en büyük parça'nın bbox merkezi değil).
        let wx = 0, wy = 0, totalA = 0;
        for (const poly of geom.coordinates) {
          const c = ringCentroidArea(poly[0]);
          wx += c.cx * c.area;
          wy += c.cy * c.area;
          totalA += c.area;
        }
        if (totalA === 0) return null;
        return [wx / totalA, wy / totalA];
      }
      return null;
    };

    const apply = async () => {
      if (cancelled || !map.isStyleLoaded()) return;
      let geo: GeoJSON.FeatureCollection | null = null;
      try {
        const r = await fetch("/geo/tr-provinces.geojson");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        geo = await r.json();
      } catch (e) {
        console.error("[sales-map] city view geojson yüklenemedi:", e);
        return;
      }
      if (!geo || cancelled) return;

      // Bu bölgedeki polygon'lardan kaçında veri var → konsol debug
      const regionPolygons = geo.features.filter(
        (f) => String((f.properties ?? {}).region ?? "") === regionFilter,
      );
      const polygonsWithoutData = regionPolygons.filter((f) => {
        const provNorm = String((f.properties ?? {}).province_norm ?? "");
        return !cityAgg.has(provNorm);
      });
      if (polygonsWithoutData.length > 0) {
        console.info(
          `[sales-map city] ${regionFilter}: ${polygonsWithoutData.length}/${regionPolygons.length} ilde Pernod müşterisi yok →`,
          polygonsWithoutData
            .map((f) => String((f.properties ?? {}).name ?? ""))
            .join(", "),
        );
      }

      // Seçili bölgenin illerini al, her birine k_color, k_deltaPct enjekte et
      const enriched: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: regionPolygons.map((f) => {
          const provNorm = String((f.properties ?? {}).province_norm ?? "");
          const provName = String((f.properties ?? {}).name ?? "");
          const agg = cityAgg.get(provNorm);
          const deltaPct =
            agg && agg.ciroPrev > 0
              ? ((agg.ciro - agg.ciroPrev) / agg.ciroPrev) * 100
              : null;
          // hasData ayrımı:
          //   2 = aktif (ciro30 > 0) — tam YoY rengi
          //   1 = pasif (müşteri var ama son 30g satış yok) — gri ama görünür
          //   0 = bayisiz (hiç müşteri yok) — silik
          let hasData = 0;
          if (agg && agg.ciro > 0) hasData = 2;
          else if (agg) hasData = 1;
          return {
            ...f,
            properties: {
              ...(f.properties ?? {}),
              k_color: cityDeltaColor(deltaPct),
              k_deltaPct: deltaPct,
              k_hasData: hasData,
              k_ciro: agg?.ciro ?? 0,
              k_ciroPrev: agg?.ciroPrev ?? 0,
              k_rawSehir: agg?.rawSehir ?? provName,
            },
          };
        }),
      };

      // Centroid + etiket — hasData ayrımına göre 3 farklı alt-metin
      const centroidFeatures: GeoJSON.Feature[] = [];
      for (const f of enriched.features) {
        const c = featureCentroid(f.geometry);
        if (!c) continue;
        const props = f.properties as {
          name?: string;
          k_deltaPct?: number | null;
          k_hasData?: number;
          k_ciroPrev?: number;
        };
        const dp = props.k_deltaPct;
        const hd = props.k_hasData ?? 0;
        let sub: string;
        if (hd === 0) {
          sub = "bayisiz";
        } else if (hd === 1) {
          // Müşteri var, 30g satış yok → eğer önceki yıl satış varsa -%100
          sub = props.k_ciroPrev && props.k_ciroPrev > 0
            ? "satış durdu"
            : "satış yok";
        } else {
          sub = dp == null
            ? "yeni satış" // ciro > 0 ama ciroPrev = 0 → yeni başlamış
            : `${dp >= 0 ? "+" : ""}%${dp.toFixed(0)} YoY`;
        }
        centroidFeatures.push({
          type: "Feature",
          properties: {
            name: props.name ?? "",
            sub,
            hasData: hd,
          },
          geometry: { type: "Point", coordinates: c },
        });
      }
      const centroids: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: centroidFeatures,
      };

      const existing = map.getSource(CITY_SRC) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existing) existing.setData(enriched);
      else map.addSource(CITY_SRC, { type: "geojson", data: enriched });

      const existingCent = map.getSource(CITY_CENTROIDS_SRC) as
        | maplibregl.GeoJSONSource
        | undefined;
      if (existingCent) existingCent.setData(centroids);
      else
        map.addSource(CITY_CENTROIDS_SRC, { type: "geojson", data: centroids });

      if (map.getLayer("city-fill")) map.removeLayer("city-fill");
      map.addLayer({
        id: "city-fill",
        type: "fill",
        source: CITY_SRC,
        paint: {
          "fill-color": ["get", "k_color"],
          // hasData: 2=aktif (tam YoY rengi), 1=müşteri var ama satış yok
          // (silik), 0=bayisiz (çok silik gri)
          "fill-opacity": [
            "match",
            ["get", "k_hasData"],
            2, 0.65,
            1, 0.3,
            0.12,
          ],
        },
      });

      if (map.getLayer("city-outline")) map.removeLayer("city-outline");
      map.addLayer({
        id: "city-outline",
        type: "line",
        source: CITY_SRC,
        paint: {
          "line-color": "#44403c",
          "line-width": 1.2,
          "line-opacity": 0.6,
        },
      });

      if (map.getLayer("city-label")) map.removeLayer("city-label");
      map.addLayer({
        id: "city-label",
        type: "symbol",
        source: CITY_CENTROIDS_SRC,
        layout: {
          "text-field": ["concat", ["get", "name"], "\n", ["get", "sub"]],
          "text-size": 12,
          "text-font": ["Open Sans Semibold"],
          "text-anchor": "center",
          "text-letter-spacing": 0.04,
          "text-allow-overlap": false,
        },
        paint: {
          // hasData 2 → tam kontrast, 1 → orta, 0 → silik
          "text-color":
            typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme") === "dark"
              ? [
                  "match",
                  ["get", "hasData"],
                  2, "#fafafa",
                  1, "#d4d4d8",
                  "#71717a",
                ]
              : [
                  "match",
                  ["get", "hasData"],
                  2, "#0f172a",
                  1, "#44403c",
                  "#a8a29e",
                ],
          "text-halo-color":
            typeof document !== "undefined" &&
            document.documentElement.getAttribute("data-theme") === "dark"
              ? "#0a0a0b"
              : "#ffffff",
          "text-halo-width": 2.5,
          "text-halo-blur": 0.4,
        },
      });

      // Hover cursor + click → view=customer&sehir=X
      const setCursor = (cursor: string) => {
        map.getCanvas().style.cursor = cursor;
      };
      map.on("mouseenter", "city-fill", () => setCursor("pointer"));
      map.on("mouseleave", "city-fill", () => setCursor(""));
      map.on("click", "city-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const props = f.properties as {
          name?: string;
          k_rawSehir?: string;
          k_hasData?: number;
        };
        // Bayisiz illere tıklama anlamsız drill yapmasın — pas geç
        if ((props.k_hasData ?? 0) === 0) return;
        // rawSehir varsa onu kullan (customer.sehir tam karşılığı); yoksa
        // geojson "name" alanını (genelde Türkçe karakterli il adı)
        const sehirParam = props.k_rawSehir || props.name || "";
        if (!sehirParam) return;
        const { router: rt, pathname: pn, sp: sParams } = navRef.current;
        const params = new URLSearchParams(sParams.toString());
        params.delete("view"); // customer'a dön
        params.delete("region"); // region kalkar, sehir devreye girer
        params.set("sehir", sehirParam);
        rt.push(`${pn}?${params.toString()}`);
      });
    };

    const tryApply = () => {
      if (applied || cancelled) return;
      if (map.isStyleLoaded()) {
        applied = true;
        void apply();
        return;
      }
      timer = setTimeout(tryApply, 100);
    };
    tryApply();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      try {
        if (map.getLayer("city-label")) map.removeLayer("city-label");
        if (map.getLayer("city-outline")) map.removeLayer("city-outline");
        if (map.getLayer("city-fill")) map.removeLayer("city-fill");
        if (map.getSource(CITY_CENTROIDS_SRC)) map.removeSource(CITY_CENTROIDS_SRC);
        if (map.getSource(CITY_SRC)) map.removeSource(CITY_SRC);
      } catch {
        // yut
      }
    };
    // citiesKey city dataları değiştiğinde effect'i yeniden tetikler.
  }, [viewMode, mapReady, regionFilter, citiesKey]);

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
