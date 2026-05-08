import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runReadOnly, type RunResult } from "./db.js";

export type ReportMeta = {
  id: string;
  name: string;
  description?: string;
  /** Free-form Turkish business prompt the user originally supplied. */
  userPrompt?: string;
  createdAt: string;
  updatedAt: string;
  /** Tables surfaced by retrieval at creation time (audit trail). */
  retrievedTables?: string[];
};

export type ReportRun = {
  reportId: string;
  startedAt: string;
  durationMs: number;
  rowCount: number;
  truncated: boolean;
  /** First N rows; full result lives next to runs as JSONL when needed. */
  sampleRows: Record<string, unknown>[];
};

export type Report = ReportMeta & {
  sql: string;
  brief?: string;
  latestRun?: ReportRun;
};

function reportsDir(repoRoot: string): string {
  return path.join(repoRoot, "data/reports");
}

function reportDir(repoRoot: string, id: string): string {
  return path.join(reportsDir(repoRoot), id);
}

export async function ensureReportsDir(repoRoot: string): Promise<void> {
  await mkdir(reportsDir(repoRoot), { recursive: true });
}

export async function listReports(repoRoot: string): Promise<ReportMeta[]> {
  await ensureReportsDir(repoRoot);
  const entries = await readdir(reportsDir(repoRoot), { withFileTypes: true });
  const out: ReportMeta[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const metaPath = path.join(reportDir(repoRoot, e.name), "meta.json");
    try {
      const raw = await readFile(metaPath, "utf-8");
      out.push(JSON.parse(raw) as ReportMeta);
    } catch {
      continue;
    }
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export async function getReport(
  repoRoot: string,
  id: string,
): Promise<Report | null> {
  const dir = reportDir(repoRoot, id);
  try {
    const meta = JSON.parse(
      await readFile(path.join(dir, "meta.json"), "utf-8"),
    ) as ReportMeta;
    const sql = await readFile(path.join(dir, "query.sql"), "utf-8");
    let brief: string | undefined;
    try {
      brief = await readFile(path.join(dir, "brief.md"), "utf-8");
    } catch {
      brief = undefined;
    }
    let latestRun: ReportRun | undefined;
    try {
      latestRun = JSON.parse(
        await readFile(path.join(dir, "runs/latest.json"), "utf-8"),
      ) as ReportRun;
    } catch {
      latestRun = undefined;
    }
    return { ...meta, sql, brief, latestRun };
  } catch {
    return null;
  }
}

export type SaveReportInput = {
  name: string;
  description?: string;
  userPrompt?: string;
  sql: string;
  brief?: string;
  retrievedTables?: string[];
};

export async function saveReport(
  repoRoot: string,
  input: SaveReportInput,
  existingId?: string,
): Promise<Report> {
  const id = existingId ?? deriveId(input.name);
  const now = new Date().toISOString();
  const dir = reportDir(repoRoot, id);
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, "runs"), { recursive: true });

  const existing = existingId ? await getReport(repoRoot, id) : null;
  const meta: ReportMeta = {
    id,
    name: input.name,
    description: input.description,
    userPrompt: input.userPrompt ?? existing?.userPrompt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    retrievedTables: input.retrievedTables ?? existing?.retrievedTables,
  };
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  await writeFile(path.join(dir, "query.sql"), input.sql, "utf-8");
  if (input.brief !== undefined) {
    await writeFile(path.join(dir, "brief.md"), input.brief, "utf-8");
  }
  return { ...meta, sql: input.sql, brief: input.brief, latestRun: existing?.latestRun };
}

function deriveId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const hash = createHash("sha256").update(name + ":" + Date.now()).digest("hex").slice(0, 6);
  return slug ? `${slug}-${hash}` : `report-${randomUUID().slice(0, 8)}`;
}

export async function runReport(
  repoRoot: string,
  id: string,
  options: { sampleRows?: number; limit?: number; timeoutMs?: number } = {},
): Promise<{ result: RunResult; run: ReportRun }> {
  const report = await getReport(repoRoot, id);
  if (!report) throw new Error(`Report not found: ${id}`);

  const started = new Date().toISOString();
  const startMs = Date.now();
  const result = await runReadOnly(report.sql, {
    limit: options.limit ?? 1000,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
  const durationMs = Date.now() - startMs;
  const sampleRows = options.sampleRows ?? 50;

  const run: ReportRun = {
    reportId: id,
    startedAt: started,
    durationMs,
    rowCount: result.rowCount,
    truncated: result.truncated,
    sampleRows: result.rows.slice(0, sampleRows),
  };
  const dir = reportDir(repoRoot, id);
  await mkdir(path.join(dir, "runs"), { recursive: true });
  await writeFile(
    path.join(dir, "runs/latest.json"),
    JSON.stringify(run, null, 2),
    "utf-8",
  );
  return { result, run };
}

export async function deleteReport(
  repoRoot: string,
  id: string,
): Promise<boolean> {
  const dir = reportDir(repoRoot, id);
  try {
    await stat(dir);
  } catch {
    return false;
  }
  // Soft-delete: rename to .trash so the user (not us) can purge.
  const trashDir = path.join(reportsDir(repoRoot), `.trash-${Date.now()}-${id}`);
  await mkdir(trashDir, { recursive: true });
  await writeFile(
    path.join(trashDir, "deleted.json"),
    JSON.stringify({ originalId: id, deletedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
  return true;
}
