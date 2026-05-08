import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { runReadOnly } from "./db.js";
import { generate } from "./gemini.js";

export type RadarTone = "good" | "warn" | "bad" | "neutral";

export type Kpi = {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  delta?: number;
  tone: RadarTone;
  hint?: string;
};

export type ChartSpec =
  | {
      kind: "bar";
      xKey: string;
      yKey: string;
      labelKey?: string;
      orientation?: "vertical" | "horizontal";
    }
  | {
      kind: "line";
      xKey: string;
      yKey: string;
      labelKey?: string;
    }
  | {
      kind: "pie";
      nameKey: string;
      valueKey: string;
    };

export type RadarBlock = {
  id: string;
  title: string;
  /** Optional plain-Turkish description for the dashboard. */
  description?: string;
  /** Parameterized SQL — use @from, @to, etc. */
  sql: string;
  /** How the dashboard should render the result (table is the default). */
  display?: "table" | "chart" | "kpi-row";
  chart?: ChartSpec;
  /** For kpi-row: how to project rows into Kpi[]. */
  kpiMapping?: Array<{
    id: string;
    label: string;
    valueColumn: string;
    unit?: string;
    deltaColumn?: string;
    /** Tone rule: thresholds in target units. */
    tone?: { good?: number; warn?: number; bad?: number; direction?: "asc" | "desc" };
  }>;
};

export type RadarDefinition = {
  id: string;
  title: string;
  description: string;
  /** Free-text hint surfaced as the page header. */
  tagline?: string;
  /** Default parameter values; merged with user-supplied params at run time. */
  defaultParams?: Record<string, string | number>;
  blocks: RadarBlock[];
  briefPrompt?: string;
};

export type RadarBlockResult = {
  id: string;
  title: string;
  description?: string;
  display: "table" | "chart" | "kpi-row";
  chart?: ChartSpec;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  kpis?: Kpi[];
  error?: string;
};

export type RadarRun = {
  id: string;
  title: string;
  description: string;
  generatedAt: string;
  params: Record<string, string | number>;
  blocks: RadarBlockResult[];
  brief?: string;
};

const PARAM_RE = /@([A-Za-z_]\w*)/g;

function applyParams(
  sql: string,
  params: Record<string, string | number>,
): string {
  return sql.replace(PARAM_RE, (_, name: string) => {
    const v = params[name];
    if (v === undefined) {
      throw new Error(`Missing radar parameter: @${name}`);
    }
    if (typeof v === "number") return String(v);
    // Quote strings with single-quote escape; intended for ISO dates / regions.
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

function deriveTone(
  value: number | undefined,
  rule: NonNullable<NonNullable<RadarBlock["kpiMapping"]>[number]["tone"]>,
): RadarTone {
  if (value === undefined || isNaN(value)) return "neutral";
  const dir = rule.direction ?? "asc"; // asc means "higher is better"
  const good = rule.good;
  const warn = rule.warn;
  const bad = rule.bad;
  if (dir === "asc") {
    if (good !== undefined && value >= good) return "good";
    if (bad !== undefined && value <= bad) return "bad";
    if (warn !== undefined && value <= warn) return "warn";
  } else {
    if (good !== undefined && value <= good) return "good";
    if (bad !== undefined && value >= bad) return "bad";
    if (warn !== undefined && value >= warn) return "warn";
  }
  return "neutral";
}

function projectKpis(
  block: RadarBlock,
  rows: Record<string, unknown>[],
): Kpi[] | undefined {
  if (!block.kpiMapping || rows.length === 0) return undefined;
  const r0 = rows[0] ?? {};
  return block.kpiMapping.map((m) => {
    const raw = r0[m.valueColumn];
    const value =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw !== ""
        ? Number(raw)
        : (raw as number | string | undefined) ?? "—";
    const numericValue = typeof value === "number" ? value : Number(value);
    const tone = m.tone ? deriveTone(numericValue, m.tone) : "neutral";
    const delta =
      m.deltaColumn && typeof r0[m.deltaColumn] === "number"
        ? (r0[m.deltaColumn] as number)
        : undefined;
    return {
      id: m.id,
      label: m.label,
      value: typeof value === "number" || typeof value === "string" ? value : "—",
      unit: m.unit,
      delta,
      tone,
    };
  });
}

export async function runRadarBlock(
  block: RadarBlock,
  params: Record<string, string | number>,
): Promise<RadarBlockResult> {
  const display = block.display ?? "table";
  try {
    const sql = applyParams(block.sql, params);
    const startedAt = Date.now();
    const result = await runReadOnly(sql, { limit: 1000, timeoutMs: 60_000 });
    const durationMs = Date.now() - startedAt;
    const out: RadarBlockResult = {
      id: block.id,
      title: block.title,
      description: block.description,
      display,
      chart: block.chart,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      durationMs,
    };
    if (display === "kpi-row") out.kpis = projectKpis(block, result.rows);
    return out;
  } catch (err) {
    return {
      id: block.id,
      title: block.title,
      description: block.description,
      display,
      chart: block.chart,
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: 0,
      error: (err as Error).message,
    };
  }
}

const DEFAULT_BRIEF_SYSTEM = `
Sen Türkçe konuşan bir analitik asistanısın. Sana bir radar raporunun KPI ve liste
çıktıları verilecek. 3-5 cümlelik kısa, eyleme dönük bir yönetici özeti yaz:
- En öne çıkan 1-2 sayıyı somut olarak zikret (binlik ayraçla, varsa para birimiyle).
- Listede ilk 1-2 satırı somut adlarıyla (TXTAD/TXTUNVAN) söyle.
- Veri boş veya çok azsa "veri yetersiz" diye dürüstçe belirt; halüsinasyon yapma.
- SQL veya teknik jargon yazma. Yöneticiye doğrudan hitap et.
`.trim();

function summarizeBlocksForBrief(blocks: RadarBlockResult[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.error) {
      parts.push(`### ${b.title}\nHATA: ${b.error}`);
      continue;
    }
    if (b.display === "kpi-row" && b.kpis) {
      const lines = b.kpis.map(
        (k) => `${k.label}: ${formatValue(k.value)}${k.unit ? ` ${k.unit}` : ""}`,
      );
      parts.push(`### KPI\n${lines.join("\n")}`);
    } else {
      const head = b.rows
        .slice(0, 5)
        .map((r) => Object.entries(r).map(([k, v]) => `${k}=${formatValue(v)}`).join(", "))
        .join("\n");
      parts.push(`### ${b.title} (toplam ${b.rowCount} satır)\n${head || "(boş)"}`);
    }
  }
  return parts.join("\n\n");
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return v.toLocaleString("tr-TR");
  return String(v);
}

export async function runRadar(
  def: RadarDefinition,
  paramsIn: Record<string, string | number> = {},
): Promise<RadarRun> {
  const params = { ...(def.defaultParams ?? {}), ...paramsIn };
  const blocks: RadarBlockResult[] = [];
  for (const block of def.blocks) {
    blocks.push(await runRadarBlock(block, params));
  }

  let brief: string | undefined;
  try {
    const summary = summarizeBlocksForBrief(blocks);
    brief = await generate(
      def.briefPrompt ?? DEFAULT_BRIEF_SYSTEM,
      `Radar: ${def.title}\nDönem parametreleri: ${JSON.stringify(params)}\n\n${summary}\n\nYönetici özeti:`,
      { temperature: 0.3, maxOutputTokens: 700 },
    );
  } catch (err) {
    brief = `(brief üretilemedi: ${(err as Error).message})`;
  }

  return {
    id: def.id,
    title: def.title,
    description: def.description,
    generatedAt: new Date().toISOString(),
    params,
    blocks,
    brief,
  };
}

export async function listRadarDefinitions(repoRoot: string): Promise<RadarDefinition[]> {
  const dir = path.join(repoRoot, "data/radars");
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const out: RadarDefinition[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await readFile(path.join(dir, name), "utf-8");
      out.push(JSON.parse(raw) as RadarDefinition);
    } catch {
      continue;
    }
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

export async function getRadarDefinition(
  repoRoot: string,
  id: string,
): Promise<RadarDefinition | null> {
  const file = path.join(repoRoot, "data/radars", `${id}.json`);
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as RadarDefinition;
  } catch {
    return null;
  }
}
