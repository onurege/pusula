import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  closePool,
  formatRetrievalForPrompt,
  getReport,
  listReports,
  loadSnapshot,
  retrieve,
  runReadOnly,
  runReport,
  saveReport,
} from "@enroute/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

const server = new McpServer({
  name: "enroute-rag",
  version: "0.1.0",
});

server.registerTool(
  "retrieve_schema",
  {
    title: "Retrieve schema",
    description:
      "Search the Univera schema for tables relevant to a Turkish business question. Returns top-k tables with descriptions, columns, primary keys, and 1-hop FK neighbors as a single Markdown context block ready to drop into a prompt.",
    inputSchema: {
      query: z.string().describe("Turkish or English business question"),
      topK: z.number().int().min(1).max(40).optional(),
    },
  },
  async ({ query, topK }) => {
    const snap = await loadSnapshot({ repoRoot: REPO_ROOT });
    const results = retrieve(query, snap, {
      topK: topK ?? 10,
      expandFkNeighbors: true,
    });
    if (results.length === 0) {
      return {
        content: [
          { type: "text", text: `Sorgu için eşleşen tablo bulunamadı: "${query}"` },
        ],
      };
    }
    const summary =
      `Top ${results.length} tablo:\n` +
      results
        .map((r, i) => `  ${i + 1}. ${r.table.fullName} (score=${r.score})`)
        .join("\n");
    return {
      content: [
        { type: "text", text: summary },
        { type: "text", text: formatRetrievalForPrompt(results) },
      ],
    };
  },
);

server.registerTool(
  "run_sql",
  {
    title: "Run read-only SQL",
    description:
      "Execute a read-only SELECT against Univera. Hard-rejects INSERT/UPDATE/DELETE/DDL even if the connection user technically allowed them. Default LIMIT 1000 rows, 30s timeout.",
    inputSchema: {
      query: z.string().describe("SELECT statement"),
      limit: z.number().int().min(1).max(10_000).optional(),
      timeoutMs: z.number().int().min(1000).max(120_000).optional(),
    },
  },
  async ({ query, limit, timeoutMs }) => {
    const result = await runReadOnly(query, { limit, timeoutMs });
    const head = result.rows.slice(0, 20);
    const cols =
      head.length > 0 && head[0]
        ? Object.keys(head[0])
        : [];
    const tableMd = renderMarkdownTable(cols, head);
    const stats = `rows=${result.rowCount}${result.truncated ? ` (truncated to ${result.rows.length})` : ""}, ${result.durationMs}ms`;
    return {
      content: [
        { type: "text", text: `${stats}\n\n${tableMd}` },
      ],
    };
  },
);

server.registerTool(
  "list_reports",
  {
    title: "List saved reports",
    description: "Return all saved reports (id, name, last update).",
    inputSchema: {},
  },
  async () => {
    const reports = await listReports(REPO_ROOT);
    if (reports.length === 0) {
      return { content: [{ type: "text", text: "Kayıtlı rapor yok." }] };
    }
    const lines = reports.map(
      (r) => `- **${r.id}** — ${r.name}${r.description ? ` — ${r.description}` : ""}  _(updated ${r.updatedAt})_`,
    );
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "get_report",
  {
    title: "Get one report",
    description: "Fetch a saved report's metadata, SQL, brief, and latest run snapshot.",
    inputSchema: {
      id: z.string().describe("Report id"),
    },
  },
  async ({ id }) => {
    const r = await getReport(REPO_ROOT, id);
    if (!r) {
      return {
        content: [{ type: "text", text: `Rapor bulunamadı: ${id}` }],
      };
    }
    const parts: string[] = [];
    parts.push(`# ${r.name}`);
    if (r.description) parts.push(r.description);
    parts.push(`\n## SQL\n\n\`\`\`sql\n${r.sql}\n\`\`\``);
    if (r.brief) parts.push(`\n## Brief\n\n${r.brief}`);
    if (r.latestRun) {
      parts.push(
        `\n## Son çalıştırma\n- ${r.latestRun.startedAt}, ${r.latestRun.durationMs}ms, ${r.latestRun.rowCount} satır${r.latestRun.truncated ? " (truncated)" : ""}`,
      );
      const cols = r.latestRun.sampleRows[0]
        ? Object.keys(r.latestRun.sampleRows[0])
        : [];
      parts.push(renderMarkdownTable(cols, r.latestRun.sampleRows.slice(0, 10)));
    }
    return { content: [{ type: "text", text: parts.join("\n") }] };
  },
);

server.registerTool(
  "save_report",
  {
    title: "Save a report",
    description:
      "Create or update a saved report. Provide name + sql at minimum. Pass `id` to update an existing report.",
    inputSchema: {
      name: z.string(),
      sql: z.string(),
      description: z.string().optional(),
      brief: z.string().optional(),
      userPrompt: z.string().optional(),
      retrievedTables: z.array(z.string()).optional(),
      id: z.string().optional(),
    },
  },
  async ({ name, sql, description, brief, userPrompt, retrievedTables, id }) => {
    const report = await saveReport(
      REPO_ROOT,
      { name, sql, description, brief, userPrompt, retrievedTables },
      id,
    );
    return {
      content: [
        { type: "text", text: `Kaydedildi: ${report.id} — ${report.name}` },
      ],
    };
  },
);

server.registerTool(
  "run_report",
  {
    title: "Run a saved report",
    description: "Execute a saved report's SQL and persist a run snapshot. Returns row stats + first rows.",
    inputSchema: {
      id: z.string(),
      limit: z.number().int().min(1).max(10_000).optional(),
    },
  },
  async ({ id, limit }) => {
    const { result, run } = await runReport(REPO_ROOT, id, { limit });
    const cols =
      run.sampleRows[0] ? Object.keys(run.sampleRows[0]) : [];
    const tableMd = renderMarkdownTable(cols, run.sampleRows.slice(0, 20));
    const stats = `${run.rowCount} satır${run.truncated ? " (truncated)" : ""}, ${run.durationMs}ms`;
    return {
      content: [
        { type: "text", text: `${stats}\n\n${tableMd}` },
        { type: "text", text: `(run cache: data/reports/${id}/runs/latest.json, fetched ${result.rows.length} rows total)` },
      ],
    };
  },
);

function renderMarkdownTable(cols: string[], rows: Record<string, unknown>[]): string {
  if (cols.length === 0 || rows.length === 0) return "(boş sonuç)";
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${cols.map((c) => formatCell(r[c])).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].join("\n");
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  const s = String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
}

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(`[enroute-mcp] ready, repoRoot=${REPO_ROOT}\n`);

process.on("SIGINT", async () => {
  await closePool().catch(() => {});
  process.exit(0);
});
