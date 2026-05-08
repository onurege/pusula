import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

// Always look for .env at the repo root, regardless of cwd. `dotenv/config`
// resolves relative to cwd, which broke `npm run -w apps/api dev` (cwd became
// apps/api) and `tsx watch` invocations from other directories.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
loadDotenv({ path: path.join(REPO_ROOT, ".env") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { z } from "zod";
import {
  closePool,
  formatRetrievalForPrompt,
  getCustomerSales,
  getMapFacets,
  getRadarDefinition,
  getReport,
  getSyncStatus,
  listMapCustomers,
  listRadarDefinitions,
  listReports,
  loadSnapshot,
  retrieve,
  runAgent,
  runRadar,
  runReadOnly,
  runReport,
  saveReport,
  syncMapData,
} from "@enroute/core";

const app = new Hono();
app.use("/api/*", cors({ origin: ["http://localhost:3000", "http://127.0.0.1:3000"] }));

app.get("/api/health", (c) =>
  c.json({ ok: true, repoRoot: REPO_ROOT, db: process.env.MSSQL_DATABASE }),
);

const RetrieveBody = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(40).default(10),
});

app.post("/api/retrieve", async (c) => {
  const body = RetrieveBody.parse(await c.req.json());
  const snap = await loadSnapshot({ repoRoot: REPO_ROOT });
  const results = retrieve(body.query, snap, {
    topK: body.topK,
    expandFkNeighbors: true,
  });
  return c.json({
    results: results.map((r) => ({
      fullName: r.table.fullName,
      label: r.table.label,
      description: r.table.description,
      score: r.score,
      reasons: r.reasons,
      primaryKeys: r.table.primaryKeys,
      columns: r.table.columns.map((cl) => ({
        name: cl.name,
        dataType: cl.dataType,
        isNullable: cl.isNullable,
        isPrimaryKey: cl.isPrimaryKey,
        description: cl.description,
        label: cl.label,
      })),
      fkNeighbors: r.fkNeighbors,
    })),
    promptContext: formatRetrievalForPrompt(results),
  });
});

const RunSqlBody = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(10_000).default(1000),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
});

app.post("/api/run-sql", async (c) => {
  try {
    const body = RunSqlBody.parse(await c.req.json());
    const result = await runReadOnly(body.query, {
      limit: body.limit,
      timeoutMs: body.timeoutMs,
    });
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/reports", async (c) => {
  const reports = await listReports(REPO_ROOT);
  return c.json({ reports });
});

app.get("/api/reports/:id", async (c) => {
  const r = await getReport(REPO_ROOT, c.req.param("id"));
  if (!r) return c.json({ error: "not found" }, 404);
  return c.json(r);
});

const SaveReportBody = z.object({
  name: z.string().min(1),
  sql: z.string().min(1),
  description: z.string().optional(),
  brief: z.string().optional(),
  userPrompt: z.string().optional(),
  retrievedTables: z.array(z.string()).optional(),
  id: z.string().optional(),
});

app.post("/api/reports", async (c) => {
  const body = SaveReportBody.parse(await c.req.json());
  const report = await saveReport(REPO_ROOT, body, body.id);
  return c.json(report);
});

app.post("/api/reports/:id/run", async (c) => {
  try {
    const id = c.req.param("id");
    const limitParam = c.req.query("limit");
    const { result, run } = await runReport(REPO_ROOT, id, {
      limit: limitParam ? parseInt(limitParam, 10) : undefined,
    });
    return c.json({ run, fullResult: { rowCount: result.rowCount, truncated: result.truncated } });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

const GenerateReportBody = z.object({
  prompt: z.string().min(1),
  /** If true, persist the generated report after running it. */
  save: z.boolean().default(false),
  /** Optional explicit name; auto-generated if omitted. */
  name: z.string().optional(),
});

app.post("/api/reports/generate", async (c) => {
  try {
    const body = GenerateReportBody.parse(await c.req.json());

    // Run the Gemini function-calling agent. It is the agent — not us — that
    // calls retrieve_schema, run_sql, and finalize. We only map the result.
    const agentRun = await runAgent(body.prompt);

    if (!agentRun.final) {
      const lastError = [...agentRun.steps]
        .reverse()
        .find((s) => s.kind === "tool_result" && !s.ok);
      return c.json(
        {
          error:
            "Ajan finalize çağrısı yapamadı; üretim adımları sınırı aşıldı.",
          lastError: lastError && lastError.kind === "tool_result" ? lastError.summary : undefined,
          steps: agentRun.steps,
        },
        400,
      );
    }

    let savedId: string | undefined;
    if (body.save) {
      const name = body.name ?? body.prompt.slice(0, 60);
      const saved = await saveReport(REPO_ROOT, {
        name,
        sql: agentRun.final.sql,
        userPrompt: body.prompt,
        brief: agentRun.final.brief,
        retrievedTables: agentRun.retrievedTables,
      });
      await runReport(REPO_ROOT, saved.id, { limit: 500 });
      savedId = saved.id;
    }

    return c.json({
      sql: agentRun.final.sql,
      brief: agentRun.final.brief,
      result: {
        rowCount: agentRun.rowCount,
        truncated: agentRun.truncated,
        durationMs: agentRun.durationMs,
        rows: agentRun.rows.slice(0, 100),
      },
      retrieved: agentRun.retrievedTables.map((fullName) => ({
        fullName,
        score: 0,
        description: undefined,
      })),
      steps: agentRun.steps,
      savedId,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/radars", async (c) => {
  const defs = await listRadarDefinitions(REPO_ROOT);
  return c.json({
    radars: defs.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      tagline: d.tagline,
      defaultParams: d.defaultParams,
    })),
  });
});

app.get("/api/radars/:id", async (c) => {
  const def = await getRadarDefinition(REPO_ROOT, c.req.param("id"));
  if (!def) return c.json({ error: "not found" }, 404);
  return c.json(def);
});

app.post("/api/radars/:id/run", async (c) => {
  try {
    const def = await getRadarDefinition(REPO_ROOT, c.req.param("id"));
    if (!def) return c.json({ error: "not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      if (typeof v === "string" || typeof v === "number") params[k] = v;
    }
    const run = await runRadar(def, params);
    return c.json(run);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// Click-to-explain: a radar anomaly (or any chart cell) hands its self-contained
// "explainPrompt" to the same agent loop that powers /reports/generate. The
// agent retrieves schema, runs SQL, and returns a Turkish 2-3 sentence cause.
app.post("/api/radars/:id/explain", async (c) => {
  try {
    const body = (await c.req.json()) as { question?: string };
    const question = body.question?.trim();
    if (!question) {
      return c.json({ error: "question required" }, 400);
    }
    const agentRun = await runAgent(question);
    if (!agentRun.final) {
      // Agent loop exhausted MAX_ITERATIONS or gave up without a successful
      // SQL. Surface the last few step summaries so the dashboard panel can
      // show *why* — silent "ok with no brief" is the worst possible UX.
      const lastSteps = agentRun.steps.slice(-6).map((s) => {
        if (s.kind === "tool_call") return `→ ${s.tool}(${JSON.stringify(s.args).slice(0, 200)})`;
        if (s.kind === "tool_result")
          return `   ${s.ok ? "✓" : "✗"} ${s.tool}: ${s.summary}`;
        if (s.kind === "give_up") return `× model verdi: ${s.reason}`;
        if (s.kind === "final") return `✓ finalize`;
        return "";
      });
      console.error("[/api/radars/:id/explain] agent produced no final answer:", lastSteps);
      return c.json(
        {
          error:
            "Agent yanıt üretemedi (tablo bulunamadı veya sorgu döngüsü sonuçsuz bitti). Son adımlar:\n" +
            lastSteps.join("\n"),
        },
        502,
      );
    }
    return c.json({
      question,
      brief: agentRun.final.brief,
      sql: agentRun.final.sql,
      rowCount: agentRun.rowCount,
      sampleRows: agentRun.rows.slice(0, 8),
      steps: agentRun.steps,
    });
  } catch (err) {
    console.error("[/api/radars/:id/explain] failed:", err);
    return c.json({ error: (err as Error).message }, 400);
  }
});

// All map reads go through the SQLite mirror — no in-memory cache layer
// needed, because the mirror IS the cache. The mirror only refreshes
// when /api/map/sync is called (via the "Verileri yenile" button).

app.get("/api/map/customers", async (c) => {
  try {
    const sehir = c.req.query("sehir") ?? undefined;
    const distKodRaw = c.req.query("distKod");
    const distKod = distKodRaw ? parseInt(distKodRaw, 10) : undefined;
    const salesFilterRaw = c.req.query("salesFilter");
    const salesFilter: "with" | "without" | undefined =
      salesFilterRaw === "with" || salesFilterRaw === "without"
        ? salesFilterRaw
        : undefined;
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

    const customers = listMapCustomers(REPO_ROOT, { sehir, distKod, salesFilter, limit });
    return c.json({ count: customers.length, customers });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/map/facets", (c) => {
  try {
    return c.json(getMapFacets(REPO_ROOT));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/map/sync-status", (c) => {
  try {
    return c.json(getSyncStatus(REPO_ROOT));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/map/sync", async (c) => {
  try {
    const status = await syncMapData(REPO_ROOT);
    return c.json(status);
  } catch (err) {
    // Log the full stack server-side so we can inspect it in the API log,
    // and bubble both the message AND the first stack frame back to the
    // dashboard so the inline error panel actually points somewhere useful.
    console.error("[/api/map/sync] failed:", err);
    const e = err as Error;
    const firstFrame = e.stack?.split("\n").slice(0, 3).join("\n") ?? "";
    return c.json(
      {
        error: e.message,
        stack: firstFrame,
      },
      500,
    );
  }
});

app.get("/api/map/customers/:id/sales", async (c) => {
  try {
    const id = parseInt(c.req.param("id"), 10);
    if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
    const distKodRaw = c.req.query("distKod");
    const distKod = distKodRaw ? parseInt(distKodRaw, 10) : null;
    const daysRaw = c.req.query("days");
    const days = daysRaw ? parseInt(daysRaw, 10) : 30;
    const sales = await getCustomerSales(id, distKod, days);
    return c.json(sales);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

const PORT = parseInt(process.env.API_PORT ?? "8080", 10);
serve({ fetch: app.fetch, port: PORT });
console.log(`[enroute-api] listening on http://localhost:${PORT}`);

process.on("SIGINT", async () => {
  await closePool().catch(() => {});
  process.exit(0);
});
