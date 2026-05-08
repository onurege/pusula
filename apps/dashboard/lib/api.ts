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
    throw new Error(`API ${res.status}: ${text}`);
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
