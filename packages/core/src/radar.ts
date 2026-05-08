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

export type AnomalySpec = {
  /** Column with the entity name (e.g. distribütör adı). */
  labelColumn: string;
  /** Column with the current-period numeric value. */
  currentColumn: string;
  /** Column with the baseline / expected value. */
  baselineColumn: string;
  /** Column with the % change vs baseline (signed). */
  deltaPctColumn: string;
  /** Unit for current/baseline (e.g. "₺"). */
  unit?: string;
  /** Drop rows with absolute %change below this. */
  minAbsDeltaPct?: number;
  /** Cap how many anomalies the UI shows. */
  topN?: number;
  /** Threshold in absolute %change for tone classification. */
  thresholds?: { warn?: number; bad?: number };
};

export type RadarBlock = {
  id: string;
  title: string;
  /** Optional plain-Turkish description for the dashboard. */
  description?: string;
  /** Parameterized SQL — use @from, @to, etc. */
  sql: string;
  /** How the dashboard should render the result (table is the default). */
  display?: "table" | "chart" | "kpi-row" | "anomalies";
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
  /** For display=anomalies: how to interpret rows. */
  anomalySpec?: AnomalySpec;
  /** When true, generate a 1-2 sentence Turkish "Smart Narrative" paragraph
   *  for this block from its rows. Defaults to true for chart and table
   *  blocks; KPI rows and anomaly blocks already speak for themselves.  */
  narrative?: boolean;
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

export type AnomalyItem = {
  id: string;
  label: string;
  current: number;
  baseline: number;
  deltaPct: number;
  unit?: string;
  tone: RadarTone;
  /** Self-contained question seed for click-to-explain drill-down. */
  explainPrompt: string;
};

export type RadarBlockResult = {
  id: string;
  title: string;
  description?: string;
  display: "table" | "chart" | "kpi-row" | "anomalies";
  chart?: ChartSpec;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  kpis?: Kpi[];
  anomalies?: AnomalyItem[];
  /** 1-2 sentence Turkish smart-narrative paragraph for chart/table blocks. */
  narrative?: string;
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

function projectAnomalies(
  block: RadarBlock,
  rows: Record<string, unknown>[],
): AnomalyItem[] {
  if (!block.anomalySpec) return [];
  const spec = block.anomalySpec;
  const minAbs = spec.minAbsDeltaPct ?? 0;
  const topN = spec.topN ?? 5;
  const thresholdWarn = spec.thresholds?.warn ?? 10;
  const thresholdBad = spec.thresholds?.bad ?? 25;

  const items: AnomalyItem[] = [];
  for (const r of rows) {
    const label = String(r[spec.labelColumn] ?? "—");
    const current = numericOr(r[spec.currentColumn], 0);
    const baseline = numericOr(r[spec.baselineColumn], 0);
    const deltaPct = numericOr(r[spec.deltaPctColumn], 0);
    if (Math.abs(deltaPct) < minAbs) continue;

    let tone: RadarTone = "neutral";
    if (Math.abs(deltaPct) >= thresholdBad) tone = deltaPct < 0 ? "bad" : "good";
    else if (Math.abs(deltaPct) >= thresholdWarn)
      tone = deltaPct < 0 ? "warn" : "good";

    items.push({
      id: `${block.id}:${label}`,
      label,
      current,
      baseline,
      deltaPct,
      unit: spec.unit,
      tone,
      // Targeted prompt — tells the agent exactly which entity to drill into,
      // which dimensions to break by, and what shape the answer should take.
      // Without this scaffolding the agent tends to produce a generic "top
      // customers" listing and ignore the actual question.
      explainPrompt:
        `Univera ERP'de \"${label}\" adlı distribütörün cirosu son dönem ${formatTrNumber(current)}${spec.unit ? " " + spec.unit : ""}, geçmiş ortalamasına göre beklenen ${formatTrNumber(baseline)}${spec.unit ? " " + spec.unit : ""} olduğu hâlde gerçekleşmesi ${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%. ` +
        `Önce TBLDIST tablosunda TXTAD = '${label.replace(/'/g, "''")}' olan distribütörün LNGKOD'unu bul, sonra son 7 gün vs önceki 30 günün haftalık ortalamasını **müşteri grubu, ürün grubu veya marka kırılımında** karşılaştır (TBLMUSTERIGRUP / TBLURUNGRUP / ilgili marka tablosu kullanarak). Düşüş veya artışın hangi 1-2 segmentte yoğunlaştığını bul. ` +
        `Cevabını 2-3 cümlelik Türkçe yönetici diliyle ver: somut segment adlarını ve sayıları yaz (\"X kanalında %Y düşüş\"). Eğer veri segmentlere ayrılamıyorsa açıkça \"segment kırılımına ulaşılamadı\" de.`,
    });
  }
  items.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
  return items.slice(0, topN);
}

function numericOr(v: unknown, fallback: number): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string" && v !== "" && !isNaN(Number(v))) return Number(v);
  return fallback;
}

function formatTrNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(0) + "k";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 });
}

const NARRATIVE_SYSTEM = `
Sen Türkçe konuşan kıdemli bir satış analisti asistanısın. Sana bir radar bloğunun
başlığı, açıklaması ve sonuç satırları verilecek. **Tek bir** 1-2 cümlelik Türkçe
paragraf üret. Yönetici hızla okuyup karar versin diye yaz.

KURALLAR:
- Liste/grafik veriyse: en üstteki 1-2 ismi (TXTAD/TXTUNVAN/ad) somut zikret ve
  **karşılaştırmalı bir bakış** kat: "ilk 3 toplam pastanın %Y'si", "X, ikincinin
  iki katı", "ilk üçten sonra kuyruk hızla iniyor" gibi.
- Trend grafiğiyse: yön ne (yükseliş/düşüş/dalgalı), tepe ve dip günleri zikret.
- Sayıları kompakt yaz: 12.456.789 yerine "12,5 Mn", 1.310.000.000 yerine "1,31 Mr".
  Para birimi varsa sonuna ekle (₺).
- Mümkünse mini bir aksiyon ipucu ver: "ikinci yarıdaki düşüşe odaklan", "ilk 3'e
  yatırım, kuyrukta zaten kayıp az" gibi. Yapay olmasın, doğal kal.
- Veri boş veya 1-2 satırsa çok kısa, dürüst bir cümle yaz.
- SQL veya teknik jargon yok. Tek paragraf, maks 320 karakter.
`.trim();

async function generateBlockNarrative(
  block: RadarBlock,
  result: { rows: Record<string, unknown>[]; rowCount: number },
): Promise<string | undefined> {
  if (block.narrative === false) return undefined;
  if (block.display === "kpi-row" || block.display === "anomalies") return undefined;
  if (result.rows.length === 0) return undefined;
  const rowsText = result.rows
    .slice(0, 8)
    .map((r) => Object.entries(r).map(([k, v]) => `${k}=${formatVal(v)}`).join(", "))
    .join("\n");
  try {
    const text = await generate(
      NARRATIVE_SYSTEM,
      `Blok: ${block.title}\n${block.description ? `Açıklama: ${block.description}\n` : ""}Toplam satır: ${result.rowCount}\n\nSatırlar:\n${rowsText}\n\nKısa Türkçe paragraf:`,
      { temperature: 0.25, maxOutputTokens: 220 },
    );
    return text.trim();
  } catch {
    return undefined;
  }
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return v.toLocaleString("tr-TR");
  return String(v);
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
    if (display === "anomalies") out.anomalies = projectAnomalies(block, result.rows);
    out.narrative = await generateBlockNarrative(block, result);
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
Sen Türkçe konuşan kıdemli bir satış-analizi asistanısın. Yöneticiye sabah brifingi
veriyorsun. Sana bir radar raporunun KPI'ları, sapmaları ve listeleri verilecek.

ÇIKTI YAPISI — TAM 3 KISIM:

1. **HEADLINE** (tek cümle): Dönemin ana metriğini ve yönünü ver. Örnek:
   "Son 30 günde toplam ciro 1,31 Mr ₺; 22.350 fatura ile 43 aktif distribütör
   sahada." Sayıları kompakt yaz (Mn/Mr), para birimi ile.

2. **DİKKAT** (2-3 madde, başına \"⚠ \" koy): En kritik sapmaları somut adlarıyla
   ver. \"X distribütörü %38 düştü\" + 1 cümle olası sebep ipucu. Sapma yoksa bu
   kısmı atla.

3. **BUGÜN** (1-2 madde, başına \"→ \" koy): Yöneticinin **bugün** atması gereken
   somut adımı yaz. \"X'i ara\", \"Y bölge sorumlusuyla görüş\", \"Z markasının
   önümüzdeki sevkiyatını gözden geçir\" gibi. Genel \"strateji geliştirilmeli\"
   tavsiyesi YASAK — somut, isim/eylem içermeli.

KURALLAR:
- Sayılar her zaman kompakt: 12,5 Mn yerine 12.456.789 yazma.
- İlk 1-2 ismi her bölümde adlarıyla (TXTAD/TXTUNVAN) zikret.
- 0 satır → \"Veri çıkmadı, dönem aralığını genişletin\" de, halüsinasyon yapma.
- Sade yönetici dili, jargon ve SQL yok. Markdown başlık kullanma — düz metin,
  bölümler arasında boş satır.
- Toplam 5-7 cümleden uzun olmasın.
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
