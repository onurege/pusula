import { generate } from "./gemini.js";
import type { SchemaSnapshot, TableInfo } from "./types.js";

const SYSTEM_INSTRUCTION = `
Sen bir kıdemli DBA ve Türkçe iş analizi uzmanısın. Sana Univera ERP veritabanından bir tablo veriliyor:
ad, kolonlar, sample satırlar ve FK komşuları. Görevin tek bir Türkçe cümlede bu tablonun **iş anlamını**
özetlemek. SQL veya teknik jargon kullanma. Eğer tablo amacı belirsizse, "Belirsiz: " ile başla.
`.trim();

export type EnrichOptions = {
  /** Skip tables that already have a non-empty description. */
  skipExisting?: boolean;
  /** Max tables to enrich in a run (for testing). */
  limit?: number;
  /** Concurrency for Gemini calls. */
  concurrency?: number;
  /** Sample rows to include in the prompt (capped). */
  sampleRowsInPrompt?: number;
  /** Progress callback for CLI display. */
  onProgress?: (done: number, total: number, table: string) => void;
};

function summarizeSampleRows(
  rows: Record<string, unknown>[] | undefined,
  cap: number,
): string {
  if (!rows || rows.length === 0) return "(örnek satır yok)";
  return rows
    .slice(0, cap)
    .map((r, i) => {
      const fields = Object.entries(r)
        .slice(0, 8)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(", ");
      return `  [${i + 1}] ${fields}`;
    })
    .join("\n");
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + "…" : s;
}

function buildPrompt(
  table: TableInfo,
  sampleCap: number,
  fkNeighbors: string[],
): string {
  const colLines = table.columns
    .slice(0, 25)
    .map((c) => `  - ${c.name} (${c.dataType}${c.isPrimaryKey ? ", PK" : ""}${c.isNullable ? "" : ", NOT NULL"})${c.label ? ` — ${c.label}` : ""}`)
    .join("\n");
  const fkLines = fkNeighbors.length > 0 ? fkNeighbors.map((n) => `  - ${n}`).join("\n") : "  (yok)";
  const samples = summarizeSampleRows(table.sampleRows, sampleCap);

  return `Tablo: ${table.fullName}
Mevcut açıklama: ${table.description ?? "(yok)"}

Kolonlar (ilk 25):
${colLines}

FK komşuları:
${fkLines}

Örnek satırlar:
${samples}

İş anlamı (1 Türkçe cümle):`;
}

async function pool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onItemDone?: (index: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= items.length) return;
          results[i] = await worker(items[i]!, i);
          onItemDone?.(i);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

export async function enrichSnapshot(
  snapshot: SchemaSnapshot,
  options: EnrichOptions = {},
): Promise<SchemaSnapshot> {
  const skipExisting = options.skipExisting ?? true;
  const concurrency = options.concurrency ?? 4;
  const sampleCap = options.sampleRowsInPrompt ?? 3;

  const fkByTable = new Map<string, string[]>();
  for (const fk of snapshot.foreignKeys) {
    const k1 = fk.fromTable;
    const k2 = fk.toTable;
    const v1 = `${k1}.${fk.fromColumn} → ${k2}.${fk.toColumn}`;
    if (!fkByTable.has(k1)) fkByTable.set(k1, []);
    if (!fkByTable.has(k2)) fkByTable.set(k2, []);
    fkByTable.get(k1)!.push(v1);
    fkByTable.get(k2)!.push(v1);
  }

  const candidates = snapshot.tables.filter((t) => !skipExisting || !t.description);
  const limited = options.limit ? candidates.slice(0, options.limit) : candidates;

  let done = 0;
  await pool(
    limited,
    async (table) => {
      const prompt = buildPrompt(table, sampleCap, fkByTable.get(table.fullName) ?? []);
      try {
        const text = await generate(SYSTEM_INSTRUCTION, prompt, { temperature: 0.1, maxOutputTokens: 512 });
        table.description = text.trim();
      } catch (err) {
        table.description = `[enrich-failed] ${(err as Error).message}`;
      }
    },
    concurrency,
    () => {
      done++;
      options.onProgress?.(done, limited.length, "");
    },
  );

  return snapshot;
}
