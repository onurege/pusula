const API_URL = process.env.ENROUTE_API_URL ?? "http://localhost:8080";

export type ReportSummary = {
  id: string;
  name: string;
  description?: string;
  userPrompt?: string;
  createdAt: string;
  updatedAt: string;
  retrievedTables?: string[];
};

export type ReportRun = {
  reportId: string;
  startedAt: string;
  durationMs: number;
  rowCount: number;
  truncated: boolean;
  sampleRows: Record<string, unknown>[];
};

export type Report = ReportSummary & {
  sql: string;
  brief?: string;
  latestRun?: ReportRun;
};

export type RetrievedTable = {
  fullName: string;
  label?: string;
  description?: string;
  score: number;
  reasons: string[];
  primaryKeys: string[];
  columns: Array<{
    name: string;
    dataType: string;
    isNullable: boolean;
    isPrimaryKey: boolean;
    description?: string;
    label?: string;
  }>;
  fkNeighbors: Array<{ table: string; via: string }>;
};

export type GenerateReportResponse = {
  sql: string;
  brief: string;
  result: {
    rowCount: number;
    truncated: boolean;
    durationMs: number;
    rows: Record<string, unknown>[];
  };
  retrieved: Array<{ fullName: string; score: number; description?: string }>;
  savedId?: string;
};

/**
 * API domain'lerini path'ten çıkar — her domain için ayrı `revalidateTag`
 * çağrısı yapılabilir. Saha DB mirror'ı (SQLite) gece cron'da tazelendiği
 * için RAM Data Cache 5 dk boyunca tutulur; bu sayede sayfa-to-sayfa geçiş
 * 60sn yerine <1sn'ye düşer.
 *
 * Bilinçli olarak coarse-grained: `/api/map/*` hepsi tek "map" tag'i;
 * GlobalRefreshButton tek `revalidateTag("map")` ile her şeyi tazeler.
 */
function inferCacheTag(path: string): string {
  if (path.startsWith("/api/map")) return "map";
  if (path.startsWith("/api/komuta")) return "komuta";
  if (path.startsWith("/api/reports")) return "reports";
  if (path.startsWith("/api/radars")) return "radar";
  if (path.startsWith("/api/retrieve")) return "schema";
  return "default";
}

const AUTH_COOKIE = "enroute_auth";

/**
 * Server component bağlamında gelen isteğin auth cookie'sini oku. Hono API'ye
 * `Authorization: Bearer` olarak iletilir → sunucu-otoriter dist filtresi.
 * Client bağlamında next/headers yoktur; sessizce null döner.
 */
async function readAuthToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return store.get(AUTH_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isReadOp = method === "GET" || method === "HEAD";
  // refresh=1 query param → SQLite cache'i bypass eden istek; Next.js Data
  // Cache'i de bypass etmeli ki taze sonuç dönsün.
  const isForceRefresh = path.includes("refresh=1");

  // Auth token varsa Bearer olarak ilet. Token'lı istekler kullanıcıya-özel
  // (dist kullanıcı alt küme görür); Next Data Cache URL bazlı olduğundan
  // token'lı okumalar CACHE'LENMEMELİ — aksi halde bir kullanıcının cevabı
  // başkasına sızar. Bu yüzden token varken no-store zorlanır.
  const token = await readAuthToken();

  // Cache stratejisi:
  //   - Yazma / refresh=1 / token'lı istek → no-store
  //   - Diğer (anonim) okumalar → 5 dk revalidate + domain tag
  const cacheConfig: RequestInit = isReadOp && !isForceRefresh && !token
    ? {
        next: {
          revalidate: 300,
          tags: [inferCacheTag(path)],
        },
      }
    : { cache: "no-store" };

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    ...cacheConfig,
  });
  if (!res.ok) {
    const text = await res.text();
    // If the body is JSON with an error/stack pair, surface them readably;
    // otherwise just include the raw text.
    let detail = text;
    try {
      const j = JSON.parse(text) as { error?: string; stack?: string };
      detail = [j.error, j.stack].filter(Boolean).join("\n");
    } catch {
      /* leave as-is */
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function listReports(): Promise<ReportSummary[]> {
  const data = await request<{ reports: ReportSummary[] }>("/api/reports");
  return data.reports;
}

export async function getReport(id: string): Promise<Report> {
  return request<Report>(`/api/reports/${encodeURIComponent(id)}`);
}

export async function runReport(id: string, limit = 1000): Promise<{ run: ReportRun }> {
  return request<{ run: ReportRun }>(`/api/reports/${encodeURIComponent(id)}/run?limit=${limit}`, {
    method: "POST",
  });
}

export async function generateReport(prompt: string, save: boolean): Promise<GenerateReportResponse> {
  return request<GenerateReportResponse>("/api/reports/generate", {
    method: "POST",
    body: JSON.stringify({ prompt, save }),
  });
}

export async function retrieveSchema(query: string, topK = 8): Promise<{ results: RetrievedTable[]; promptContext: string }> {
  return request("/api/retrieve", {
    method: "POST",
    body: JSON.stringify({ query, topK }),
  });
}

export type RadarSummary = {
  id: string;
  title: string;
  description: string;
  tagline?: string;
  defaultParams?: Record<string, string | number>;
};

export type RadarKpi = {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  delta?: number;
  tone: "good" | "warn" | "bad" | "neutral";
  hint?: string;
};

export type RadarChartSpec =
  | { kind: "bar"; xKey: string; yKey: string; orientation?: "vertical" | "horizontal" }
  | { kind: "line"; xKey: string; yKey: string }
  | { kind: "pie"; nameKey: string; valueKey: string };

export type AnomalyItem = {
  id: string;
  label: string;
  current: number;
  baseline: number;
  deltaPct: number;
  unit?: string;
  tone: "good" | "warn" | "bad" | "neutral";
  explainPrompt: string;
};

export type RadarBlockResult = {
  id: string;
  title: string;
  description?: string;
  display: "table" | "chart" | "kpi-row" | "anomalies";
  chart?: RadarChartSpec;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  kpis?: RadarKpi[];
  anomalies?: AnomalyItem[];
  narrative?: string;
  error?: string;
};

export type ExplainResponse = {
  question: string;
  brief?: string;
  sql?: string;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  steps: unknown[];
};

export async function explainOnRadar(
  radarId: string,
  question: string,
): Promise<ExplainResponse> {
  return request<ExplainResponse>(`/api/radars/${encodeURIComponent(radarId)}/explain`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

/** @deprecated Eski 4-tier model. Yeni UI `RiskTierV2` kullanır. */
export type RiskTier = "high" | "medium" | "low" | "active";

/** Composite Risk Score tier'ları (0..100 skoru bucket'lar). */
export type RiskTierV2 =
  | "healthy"
  | "watch"
  | "risk"
  | "critical"
  | "unknown";

export type RiskComponentKey =
  | "momentum"
  | "behavioral"
  | "payment"
  | "engagement";

export type CustomerRiskScore = {
  /** 0..100 ya da yetersiz veri için null. */
  score: number | null;
  tier: RiskTierV2;
  /** Her bileşen 0..100 veya hesap edilemediyse null. */
  components: Record<RiskComponentKey, number | null>;
  /** UI'da kart altında bullet listesi olarak gösterilen kısa açıklamalar. */
  reasons: string[];
};

export type MapCustomer = {
  id: number;
  distKod: number | null;
  unvan: string;
  kisaAd: string | null;
  adres: string | null;
  sehir: string | null;
  ilce: string | null;
  distributor: string | null;
  bolge: string | null;
  lat: number;
  lng: number;
  hasSales: boolean;
  daysSinceLastSale: number | null;
  daysSinceLastVisit: number | null;
  ciro30: number;
  ciroPrev30: number;
  /** @deprecated Eski 4-tier alan. Yeni UI `riskScore.tier` kullanır. */
  riskTier: RiskTier;
  /** Composite Risk Score — 0..100 + bileşenler + sebepler. */
  riskScore: CustomerRiskScore;
};

export async function listMapCustomers(params: {
  sehir?: string;
  distKod?: number;
  bolge?: string;
  region?: string;
  salesFilter?: "with" | "without";
  /** @deprecated Yeni UI `tier` kullanır. */
  riskTier?: RiskTier;
  /** Composite Risk Score tier filter. */
  tier?: RiskTierV2;
  minDaysSinceVisit?: number;
  limit?: number;
} = {}): Promise<{ count: number; customers: MapCustomer[] }> {
  const qp = new URLSearchParams();
  if (params.sehir) qp.set("sehir", params.sehir);
  if (typeof params.distKod === "number") qp.set("distKod", String(params.distKod));
  if (params.bolge) qp.set("bolge", params.bolge);
  if (params.region) qp.set("region", params.region);
  if (params.salesFilter) qp.set("salesFilter", params.salesFilter);
  if (params.riskTier) qp.set("riskTier", params.riskTier);
  if (params.tier) qp.set("tier", params.tier);
  if (typeof params.minDaysSinceVisit === "number") qp.set("minDaysSinceVisit", String(params.minDaysSinceVisit));
  if (typeof params.limit === "number") qp.set("limit", String(params.limit));
  return request(`/api/map/customers?${qp.toString()}`);
}

// -- BÖLGE BAZLI GÖRÜNÜM ---------------------------------------------------

export type MapRegion = {
  bolge: string;
  musteriSayisi: number;
  /** @deprecated Eski 4-tier dağılımı. UI cutover sonrası kaldırılır. */
  high: number;
  medium: number;
  active: number;
  low: number;
  /** Composite Risk Score tier dağılımı — yeni model. */
  critical: number;
  risk: number;
  watch: number;
  healthy: number;
  unknown: number;
  lat: number;
  lng: number;
  ciro30: number;
  color: string;
  provinces: string[];
};

// Şehir bazlı YoY (son 30g vs geçen yıl aynı 30g) — /map view=city için.
export type MapCityYoY = {
  sehir: string;
  sehirNorm: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
};

export async function listMapCityYoY(params: {
  region?: string;
} = {}): Promise<{ count: number; cities: MapCityYoY[] }> {
  const qp = new URLSearchParams();
  if (params.region) qp.set("region", params.region);
  const qs = qp.toString();
  return request(`/api/map/cities${qs ? `?${qs}` : ""}`);
}

export async function listMapRegions(params: {
  sehir?: string;
  distKod?: number;
  salesFilter?: "with" | "without";
  /** @deprecated Yeni UI `tier` kullanır. */
  riskTier?: RiskTier;
  tier?: RiskTierV2;
  minDaysSinceVisit?: number;
} = {}): Promise<{ count: number; regions: MapRegion[] }> {
  const qp = new URLSearchParams();
  if (params.sehir) qp.set("sehir", params.sehir);
  if (typeof params.distKod === "number") qp.set("distKod", String(params.distKod));
  if (params.salesFilter) qp.set("salesFilter", params.salesFilter);
  if (params.riskTier) qp.set("riskTier", params.riskTier);
  if (params.tier) qp.set("tier", params.tier);
  if (typeof params.minDaysSinceVisit === "number") qp.set("minDaysSinceVisit", String(params.minDaysSinceVisit));
  return request(`/api/map/regions?${qp.toString()}`);
}

export type CustomerSales = {
  ciro30: number;
  fatura30: number;
  sonFaturaTarihi: string | null;

  ziyaret30: number;
  rutIciZiyaret: number;
  rutDisiZiyaret: number;
  sonZiyaretTarihi: string | null;

  tahsilatNakit: number;
  tahsilatCek: number;
  tahsilatSenet: number;
  tahsilatKK: number;

  ziyaretFaturaSayisi: number;
  ziyaretIrsaliyeSayisi: number;
  ziyaretSiparisSayisi: number;
};

export async function getCustomerSales(
  id: number,
  distKod: number | null,
  days = 30,
  options: { refresh?: boolean } = {},
): Promise<CustomerSales> {
  const qp = new URLSearchParams();
  if (typeof distKod === "number") qp.set("distKod", String(distKod));
  qp.set("days", String(days));
  if (options.refresh) qp.set("refresh", "1");
  return request(`/api/map/customers/${id}/sales?${qp.toString()}`);
}

export type ForesightEvent = {
  date: string;
  name: string;
  kind: string;
  daysAhead: number;
  category_hints?: string[];
};

export type ForesightYoy = {
  urunGrubu: string | null;
  ciro: number;
  miktar: number;
};

export type ForesightDropped = {
  urunGrubu: string;
  baselineCiro: number;
  baselineMiktar: number;
  recentCiro: number;
  daysSinceLast: number | null;
  urgency: "high" | "medium" | "low";
};

export type ForesightRiskFlag = {
  kind: "dropped-high-value";
  urunGrubu: string;
  baselineCiro: number;
  daysSinceLast: number | null;
  message: string;
};

export type ForesightCohort = {
  urunGrubu: string;
  cohortBuyerCount: number;
  cohortTotalBuyers: number;
  cohortCiro: number;
};

export type ForesightResult = {
  customerId: number;
  generatedAt: string;
  events: ForesightEvent[];
  yoy: ForesightYoy[];
  dropped: ForesightDropped[];
  cohort: ForesightCohort[];
  riskFlags: ForesightRiskFlag[];
  brief: string;
  actions: string[];
};

// Komuta Köprüsü types ------------------------------------------------------

export type KomutaKpiCard = {
  id: string;
  label: string;
  value: number;
  format: "currency" | "count" | "percent" | "compact";
  unit?: string;
  delta?: number;
  deltaSub?: string;
};

export type KomutaCityBreakdown = {
  sehir: string;
  /** Diacritic-strip normalize edilmiş il adı (örn. "İSTANBUL" → "ISTANBUL")
   *  — geojson feature `properties.name`/`properties.shapeName` ile eşleşmek için. */
  sehirNorm: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
};

export type KomutaRegionRow = {
  /** Klasik 7 bölge + Kıbrıs (Marmara/Ege/Akdeniz/İç Anadolu/Karadeniz/
   *  Doğu Anadolu/Güneydoğu Anadolu/Kıbrıs) — backend müşteri şehri →
   *  master JSON ile bu adlardan birine map eder. */
  bolge: string;
  ciro: number;
  ciroPrev: number;
  deltaPct: number | null;
  /** Master JSON'dan gelen bölge rengi — /map sayfası ile aynı palette. */
  color: string;
  /** Bu bölgeye agrege edilen Pernod şehirlerinin listesi (debug/tooltip). */
  sehirler: string[];
  /** Bölge içindeki her şehrin YoY kırılımı — Komuta haritası drill-down
   *  modunda şehirler bu kırılımdan boyanır. */
  cities: KomutaCityBreakdown[];
};

export type KomutaChannelSlice = {
  name: string;
  ciro: number;
  pct: number;
  color: string;
};

export type KomutaChannelMonthlyRow = {
  yyyymm: string;
  ay: string;
  kanal: string;
  ciro: number;
};

export type KomutaMonthlyBar = {
  yyyymm: string;
  ay: string;
  ciro: number;
  ciroPrev: number | null;
  isRamazan: boolean;
  isCurrent: boolean;
  isSummer: boolean;
};

export type ProductTier = "luxury" | "premium" | "core" | "value";

export type KomutaMatrixRow = {
  grup: string;
  tier: ProductTier;
  buAy: number;
  gecenAy: number;
  ucAyOnce: number;
  gecenYil: number;
  ikiYilOnce: number;
  yoyPct: number | null;
  trend: "rocket" | "up" | "flat" | "down";
};

export type KomutaHeatmapCell = {
  bolge: string;
  grup: string;
  yoyPct: number | null;
  bucket: "fire" | "hot" | "warm" | "flat" | "cool" | "cold";
};

export type KomutaHeatmapRow = {
  bolge: string;
  distSayisi: number;
  cells: KomutaHeatmapCell[];
  rowAvgPct: number | null;
};

export type KomutaRep = {
  ad: string;
  distributor: string | null;
  ciro: number;
  faturaSayisi: number;
  rank: number;
};

export type KomutaTopDist = {
  ad: string;
  bolge: string | null;
  ciro: number;
  faturaSayisi: number;
  rank: number;
};

export type KomutaPortfolioRow = {
  grup: string;
  tier: ProductTier;
  bu: number;
  oneYearAgo: number;
  twoYearsAgo: number;
  yoyPct: number | null;
  twoYrPct: number | null;
};

export type KomutaUpcomingEvent = {
  name: string;
  date: string;
  daysAhead: number;
  kind: string;
  yoyImpact?: number;
};

/** TL (currency, ₺) ya da 9LE (9-Liter-Equivalent volume). Tüm value alanları
 *  bu birimde gelir; snapshot.unit alanı UI'da suffix formatlamasını sürer. */
export type ValueUnit = "tl" | "9le";

export type KomutaSnapshot = {
  generatedAt: string;
  reelTL: boolean;
  otvNet: boolean;
  otvAvgRate: number | null;
  demoDate: string | null;
  /** Snapshot'taki tüm value'ların birimi — UI suffix'i bundan beslenir. */
  unit: ValueUnit;
  kpis: KomutaKpiCard[];
  regions: KomutaRegionRow[];
  channels: KomutaChannelSlice[];
  channelMonthly: KomutaChannelMonthlyRow[];
  /** Pernod Müşteri Tipi (TBLMUSTERIEKSAHA saha 8) × 12 ay stacked breakdown. */
  channelByType: KomutaChannelMonthlyRow[];
  monthlyTrend: KomutaMonthlyBar[];
  upcomingEvent: KomutaUpcomingEvent | null;
  matrix: KomutaMatrixRow[];
  heatmap: KomutaHeatmapRow[];
  reps: KomutaRep[];
  topDists: KomutaTopDist[];
  portfolio: KomutaPortfolioRow[];
  brief?: string;
};

export async function getKomutaSnapshot(
  options: {
    refresh?: boolean;
    reelTL?: boolean;
    otvNet?: boolean;
    unit?: ValueUnit;
  } = {},
): Promise<KomutaSnapshot> {
  const qp = new URLSearchParams();
  if (options.refresh) qp.set("refresh", "1");
  if (options.reelTL) qp.set("reel", "1");
  if (options.otvNet) qp.set("otv", "1");
  if (options.unit === "9le") qp.set("unit", "9le");
  const qs = qp.toString() ? `?${qp.toString()}` : "";
  return request<KomutaSnapshot>(`/api/komuta${qs}`);
}

// -- FINANS AGENTı ---------------------------------------------------------

export type FinanceFactor = {
  ad: string;
  buDonem: number;
  gecenYil: number;
  delta: number;
  yoyPct: number | null;
  contributionPct: number;
};

export type FinanceFacts = {
  region: string;
  /** Eğer analiz tek bir ürün grubuna fokuslandıysa onun adı. */
  productGroup?: string;
  buDonem: number;
  gecenYil: number;
  delta: number;
  yoyPct: number | null;
  distFactors: FinanceFactor[];
  channelFactors: FinanceFactor[];
  productFactors: FinanceFactor[];
  customers: { aktifBu: number; aktifGecen: number; kaybedilen: number };
};

export type FinanceAnalysis = {
  region: string;
  generatedAt: string;
  facts: FinanceFacts;
  markdown: string;
};

export async function getFinanceAnalysis(
  region: string,
  options: { refresh?: boolean; productGroup?: string } = {},
): Promise<FinanceAnalysis> {
  const qp = new URLSearchParams();
  if (options.refresh) qp.set("refresh", "1");
  if (options.productGroup) qp.set("productGroup", options.productGroup);
  const qs = qp.toString() ? `?${qp.toString()}` : "";
  return request<FinanceAnalysis>(
    `/api/komuta/finance/${encodeURIComponent(region)}${qs}`,
  );
}

export async function getCustomerForesight(
  id: number,
  label: string,
  windowDays = 14,
  options: { refresh?: boolean } = {},
): Promise<ForesightResult> {
  const qs = options.refresh ? "?refresh=1" : "";
  return request(`/api/map/customers/${id}/foresight${qs}`, {
    method: "POST",
    body: JSON.stringify({ label, windowDays, refresh: options.refresh ?? false }),
  });
}

export type MapFacets = {
  cities: string[];
  distributors: { lngKod: number; ad: string }[];
};

export async function getMapFacets(): Promise<MapFacets> {
  return request("/api/map/facets");
}

export type MapSyncStatus = {
  lastSyncAt: string | null;
  durationMs: number;
  customerCount: number;
  cityCount: number;
  distCount: number;
};

export async function getMapSyncStatus(): Promise<MapSyncStatus> {
  return request("/api/map/sync-status");
}

export async function triggerMapSync(): Promise<MapSyncStatus> {
  return request("/api/map/sync", { method: "POST" });
}

export type RadarRun = {
  id: string;
  title: string;
  description: string;
  generatedAt: string;
  params: Record<string, string | number>;
  blocks: RadarBlockResult[];
  brief?: string;
};

export async function listRadars(): Promise<RadarSummary[]> {
  const data = await request<{ radars: RadarSummary[] }>("/api/radars");
  return data.radars;
}

export async function runRadarApi(
  id: string,
  params: Record<string, string | number> = {},
  options: { refresh?: boolean } = {},
): Promise<RadarRun> {
  const qs = options.refresh ? "?refresh=1" : "";
  return request<RadarRun>(`/api/radars/${encodeURIComponent(id)}/run${qs}`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// -- WIETNAUER / V3 -----------------------------------------------------------
// V3 IA: her dashboard kendi sayfası. Wietnauer'ın 7-madde dashboard listesine
// karşılık gelen endpoint'ler. Tenant config'ten brandTable + strategicBrands
// okur, tenant başına farklı SQL çalışır.

export type WietnauerTopDistributor = {
  id: number;
  ad: string;
  bolge: string | null;
  ciro: number;
  faturaSayisi: number;
  /** md23: portföydeki aktif müşteri sayısı (BYTDURUM=0) */
  aktifMusteriSayi: number;
  /** md23: FKMS — son 30g fatura kesilen distinct müşteri */
  fkms: number;
  /** md23: FKMS / aktif müşteri (%) — 30g portföy kapsaması */
  kapsamPct: number;
  payPct: number;
  rank: number;
};

export type WietnauerBrandContribution = {
  marka: string;
  markaKod: string;
  ciro: number;
  musteriSayi: number;
  payPct: number;
  rank: number;
  isStratejik: boolean;
};

export type WietnauerDiscountKpi = {
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  faturaCount: number;
  aktifMusteriCount: number;
};

export type WietnauerYonetimSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  topDistributors: WietnauerTopDistributor[];
  brands: WietnauerBrandContribution[];
  discount: WietnauerDiscountKpi;
};

export async function getWietnauerYonetim(
  options: { refresh?: boolean } = {},
): Promise<WietnauerYonetimSnapshot> {
  const qs = options.refresh ? "?refresh=1" : "";
  return request<WietnauerYonetimSnapshot>(`/api/wietnauer/yonetim${qs}`);
}

// V3 Dashboards — paralel agent'lar dolduruyor.
// Tip her sayfa kendi türünü declare etsin diye `unknown` döner;
// agent'lar page.tsx içinde kendi type guard'larını yazar.
async function fetchV3<T = unknown>(name: string, refresh = false): Promise<T> {
  const qs = refresh ? "?refresh=1" : "";
  return request<T>(`/api/wietnauer/${name}${qs}`);
}
export const getWietnauerMarka = <T = unknown>(o: { refresh?: boolean } = {}) =>
  fetchV3<T>("marka", o.refresh);
export const getWietnauerAktivasyon = <T = unknown>(o: { refresh?: boolean } = {}) =>
  fetchV3<T>("aktivasyon", o.refresh);
export const getWietnauerIskonto = <T = unknown>(o: { refresh?: boolean } = {}) =>
  fetchV3<T>("iskonto", o.refresh);
export const getWietnauerSegment = <T = unknown>(o: { refresh?: boolean } = {}) =>
  fetchV3<T>("segment", o.refresh);
// `getWietnauerSaha` typed signature aşağıda; jenerik kalmasın diye burada
// kaldırılmıştır.
export const getWietnauerSatis = <T = unknown>(o: { refresh?: boolean } = {}) =>
  fetchV3<T>("satis", o.refresh);
// Stok endpoint'i distId query param'ı destekler — UI dropdown'undan gelir.
// distId verilmezse portföy toplamı, verilirse o distribütörün kırılımı döner.
export const getWietnauerStok = <T = unknown>(
  o: { refresh?: boolean; distId?: number | null } = {},
) => {
  const params = new URLSearchParams();
  if (o.refresh) params.set("refresh", "1");
  if (o.distId != null) params.set("distId", String(o.distId));
  const qs = params.toString();
  return request<T>(`/api/wietnauer/stok${qs ? `?${qs}` : ""}`);
};

// -- WIETNAUER / V3 / Dashboard #2 — Satış Performansı -----------------------
// Tipler `packages/core/src/wietnauer-satis.ts` ile aynaya yansıtılır. Snapshot
// JSON üzerinden geldiği için Date alanı yok; tüm tarihler string.

export type SatisDistRow = {
  id: number;
  ad: string;
  region: string | null;
  ciro: number;
  /** md26: son 30g hacim (70cl eşdeğer) */
  hacim: number;
  musteriSayi: number;
  faturaSayi: number;
  ortSepet: number;
  prevCiro: number;
  deltaPct: number;
  rank: number;
};

export type SatisRepRow = {
  id: number;
  ad: string;
  distAd: string | null;
  region: string | null;
  ciro: number;
  musteriSayi: number;
  faturaSayi: number;
  ortSepet: number;
  prevCiro: number;
  deltaPct: number;
  rank: number;
};

export type DropSizeRow = {
  id: number;
  ad: string;
  region: string | null;
  ciro: number;
  musteriSayi: number;
  dropSize: number;
  rank: number;
};

export type NewCustomerRow = {
  distId: number;
  distAd: string;
  region: string | null;
  yeniMusteriSayi: number;
  yeniMusteriCiro: number;
};

export type AvgOrderTrendPoint = {
  ay: string;
  ayBaslangic: string;
  ortSepet: number;
  faturaSayi: number;
  toplamCiro: number;
};

export type WietnauerSatisSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  distLeaderboard: SatisDistRow[];
  repLeaderboard: SatisRepRow[];
  dropSize: DropSizeRow[];
  newCustomers: {
    items: NewCustomerRow[];
    totalYeniMusteri: number;
    totalYeniCiro: number;
  };
  avgOrderTrend: AvgOrderTrendPoint[];
};

// -- WIETNAUER / V3 / Dashboard #8 — Stok Tükenme ---------------------------

export type StockRiskTier = "critical" | "risk" | "watch" | "healthy" | "unknown";

export type DemandPattern = "smooth" | "intermittent" | "erratic" | "lumpy" | "unknown";

export type StockConfidence = "high" | "medium" | "low";

export type LeadTimeSource = "dist-table" | "default";

export type StockDataQuality =
  | "ok"
  | "no-demand"
  | "no-stock-signal"
  | "negative-stock"
  | "turnover-unreliable";

export type WietnauerStockSkuRow = {
  skuId: number;
  skuCode: string;
  skuName: string;
  brand: string | null;
  category: string | null;
  distId: number;
  distName: string;
  region: string | null;
  onHandQty: number;
  soldQty90d: number;
  avgDailyQty: number;
  soldQty180d: number;
  demandDays180: number;
  avgDemandInterval: number | null;
  demandCv2: number | null;
  demandPattern: DemandPattern;
  crostonDailyQty: number;
  trendFactor: number;
  seasonalityFactor: number;
  seasonalityReason: string | null;
  forecastDailyQty: number;
  daysLeft: number | null;
  estimatedStockoutDate: string | null;
  turnover90d: number | null;
  stockStartQty: number;
  stockEndQty: number;
  avgStockQty: number;
  openOrderQty: number;
  inventoryPositionQty: number;
  projectedDaysLeft: number | null;
  projectedStockoutDate: string | null;
  lastInboundDate: string | null;
  lastInboundDays: number | null;
  leadTimeDays: number;
  leadTimeSource: LeadTimeSource;
  safetyStockQty: number;
  reorderPointQty: number;
  reorderGapQty: number;
  stockConfidence: StockConfidence;
  stockConfidenceScore: number;
  netSignalPct: number | null;
  lowConfidence: boolean;
  riskTier: StockRiskTier;
  dataQuality: StockDataQuality;
};

export type WietnauerStockBrandSummary = {
  brand: string;
  skuCount: number;
  criticalCount: number;
  riskCount: number;
  watchCount: number;
  healthyCount: number;
  unknownCount: number;
  totalOnHandQty: number;
  totalSoldQty90d: number;
  avgDaysLeft: number | null;
};

export type WietnauerStockDistributorSummary = {
  distId: number;
  distName: string;
  region: string | null;
  skuCount: number;
  criticalCount: number;
  riskCount: number;
  watchCount: number;
  healthyCount: number;
  unknownCount: number;
  totalOnHandQty: number;
  totalSoldQty90d: number;
};

export type WietnauerStockSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  windowDays: 90;
  distFilter: {
    distId: number;
    distName: string;
    region: string | null;
  } | null;
  distributors: WietnauerStockDistributorSummary[];
  totals: {
    activeSkuCount: number;
    soldSkuCount90d: number;
    positiveStockSkuCount: number;
    criticalSkuCount: number;
    riskSkuCount: number;
    watchSkuCount: number;
    healthySkuCount: number;
    unknownSkuCount: number;
    negativeStockSkuCount: number;
    noDemandSkuCount: number;
    turnoverComputableSkuCount: number;
    lowConfidenceSkuCount: number;
    lowConfidenceRatePct: number;
    incomingOrderSkuCount: number;
    totalIncomingQty: number;
    leadTimeConfiguredSkuCount: number;
  };
  critical: WietnauerStockSkuRow[];
  items: WietnauerStockSkuRow[];
  brandSummary: WietnauerStockBrandSummary[];
  quality: {
    stockSignalSkuCount: number;
    zeroStockSkuCount: number;
    negativeStockSkuCount: number;
    turnoverUnreliableSkuCount: number;
    incomingOrderSkuCount: number;
    leadTimeConfiguredSkuCount: number;
    snapshotTablesEmpty: boolean;
  };
};

// -- WIETNAUER / V3 / Dashboard #5 — Distribütör & Saha Operasyon -----------
// Tipler `packages/core/src/wietnauer-saha.ts` ile aynaya yansıtılır.

export type SahaVisitDailyRow = {
  gun: string;
  toplam: number;
  rutIci: number;
  rutDisi: number;
};

export type SahaCoverageSegment = {
  segment: string;
  ziyaretEdilen: number;
  aktif: number;
  kapsamaPct: number;
};

export type SahaRepRow = {
  repId: number;
  ad: string;
  distributor: string | null;
  ziyaret: number;
  uniqueMusteri: number;
  /** md41: son 30g fatura kesilen distinct müşteri (aktif müşteri) */
  aktifMusteri: number;
  siparisliZiyaret: number;
  donusumPct: number;
  rutDisiPct: number;
  rank: number;
};

export type SahaConversionRow = {
  tip: "Rut İçi" | "Rut Dışı";
  ziyaret: number;
  siparisli: number;
  faturali: number;
  irsaliyeli: number;
  donusumPct: number;
};

export type SahaDistributorRow = {
  distKod: number;
  distributor: string;
  bolge: string | null;
  aktifTemsilci: number;
  ziyaret: number;
  kapsananMusteri: number;
  donusumPct: number;
  rank: number;
};

export type SahaVisitKpi = {
  son7gZiyaret: number;
  son7gUniqueMusteri: number;
  son7gAktifTemsilci: number;
  son7gDonusumPct: number;
};

export type WietnauerSahaSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  visitDaily: SahaVisitDailyRow[];
  kpi: SahaVisitKpi;
  coverage: {
    totalZiyaretEdilen: number;
    totalAktif: number;
    kapsamaPct: number;
    segments: SahaCoverageSegment[];
  };
  reps: SahaRepRow[];
  conversion: SahaConversionRow[];
  distributors: SahaDistributorRow[];
};

export async function getWietnauerSaha(
  options: { refresh?: boolean } = {},
): Promise<WietnauerSahaSnapshot> {
  const qs = options.refresh ? "?refresh=1" : "";
  return request<WietnauerSahaSnapshot>(`/api/wietnauer/saha${qs}`);
}
