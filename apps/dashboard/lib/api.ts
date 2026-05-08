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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
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

export type MapCustomer = {
  id: number;
  distKod: number | null;
  unvan: string;
  kisaAd: string | null;
  adres: string | null;
  sehir: string | null;
  ilce: string | null;
  distributor: string | null;
  lat: number;
  lng: number;
  hasSales: boolean;
};

export async function listMapCustomers(params: {
  sehir?: string;
  distKod?: number;
  salesFilter?: "with" | "without";
  limit?: number;
} = {}): Promise<{ count: number; customers: MapCustomer[] }> {
  const qp = new URLSearchParams();
  if (params.sehir) qp.set("sehir", params.sehir);
  if (typeof params.distKod === "number") qp.set("distKod", String(params.distKod));
  if (params.salesFilter) qp.set("salesFilter", params.salesFilter);
  if (typeof params.limit === "number") qp.set("limit", String(params.limit));
  return request(`/api/map/customers?${qp.toString()}`);
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
): Promise<CustomerSales> {
  const qp = new URLSearchParams();
  if (typeof distKod === "number") qp.set("distKod", String(distKod));
  qp.set("days", String(days));
  return request(`/api/map/customers/${id}/sales?${qp.toString()}`);
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

export async function runRadarApi(id: string, params: Record<string, string | number> = {}): Promise<RadarRun> {
  return request<RadarRun>(`/api/radars/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: JSON.stringify(params),
  });
}
