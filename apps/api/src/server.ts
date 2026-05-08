import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { z } from "zod";
import {
  closePool,
  formatRetrievalForPrompt,
  generate,
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

const SQL_GEN_SYSTEM = `
Sen kıdemli bir Türkçe-konuşan veri analistisin. Sana Univera ERP şemasından
ilgili tabloların açıklamaları + kolonları + FK ilişkileri verilecek (\"BAĞLAM\").

KURALLAR:

1. **Yalnızca BAĞLAM'da gözüken tabloları kullan.** Asla başka bir tablo adı
   uydurma, hatırından isim üretme. Tablo adı bağlamda yoksa o tablo yoktur.
2. **Tek bir SELECT** üret. Asla INSERT/UPDATE/DELETE/DDL kullanma.
3. Bağlamda iki tablo aynı amaca hizmet ediyorsa kanonik olanı seç:
   - _YEDEK / _OLD / _BAK / _TEMP / _ARSIV / _BIRLESTIRME(DETAY) ile biten
     tablolardan KAÇIN — bunlar yedek/arşiv/birleştirme tablolarıdır.
   - Tarih son ekli kopyalar (TBLXXX_20230704, TBLXXX240315) yerine ana tabloyu kullan.
4. **Sadece kod gösterme.** Distribütör/müşteri/ürün gibi entity'leri hem koduyla hem
   **adı (TXTAD/TXTUNVAN)** ile döndür. Bunun için bağlamdaki ana entity tablosuna
   INNER JOIN ekle (kolon ve FK bilgisi bağlamda var).
5. **"Satış/ciro" sorularında COUNT yerine SUM** kullan. Tipik kolonlar:
   DBLNETTUTAR, DBLBRUTTUTAR, DBLTUTAR, DBLMIKTAR. Sadece kayıt sayısı istenmişse COUNT olur.
6. Aktiflik filtresi gerekirse \`BYTDURUM = 0\` aktif demektir.
7. Sonuç sınırla: \`SELECT TOP 100\`, \`SELECT TOP 1000\` gibi. Default 100.
8. Türkçe sütun aliasları kullan, sayısal alanlarda \`ISNULL\` ile NULL koru.
9. Sadece bir SQL bloğu döndür: \`\`\`sql ... \`\`\`. Başka açıklama yazma.
`.trim();

const BRIEF_SYSTEM = `
Sen Pernod Ricard distribütör verisini Türkçe yorumlayan bir analiz asistanısın.
Kullanıcının talebi ve sorgu sonucu örnek satırları sana verilecek. 3-5 cümlelik
kısa, eyleme dönük bir özet yaz: ne çıktı, hangi tablo/kanal öne çıkıyor,
kullanıcı için bir sonraki adım önerisi.

ÖNEMLİ:
- Eğer **0 satır** döndüyse, "veri çıkmadı" olduğunu açıkça söyle. Halüsinasyon yapma —
  "ilk 10'u belirledik" gibi yanlış bir özet yazma. Olası nedenler: filtre çok dar,
  yanlış tablo seçimi, demo verisinde ilgili dönem boş. Kullanıcıya tarih aralığını
  genişletmeyi veya farklı tablo denemeyi öner.
- Eğer veri varsa: en üst 1-2 satırı somut adlarıyla zikret (ör. "Distribütör X 12.4M ile
  başta, ardından Y 9.1M"). Sayıları binlik ayraçla ve birim varsa belirterek yaz.
- SQL veya teknik jargon yazma.
`.trim();

app.post("/api/reports/generate", async (c) => {
  try {
    const body = GenerateReportBody.parse(await c.req.json());

    const snap = await loadSnapshot({ repoRoot: REPO_ROOT });
    const retrieved = retrieve(body.prompt, snap, { topK: 10, expandFkNeighbors: true });
    const promptContext = formatRetrievalForPrompt(retrieved);

    const allowedTables = retrieved.map((r) => r.table.fullName);

    const firstAttempt = await generate(
      SQL_GEN_SYSTEM,
      `BAĞLAM:\n\n${promptContext}\n\nKullanıcı talebi: ${body.prompt}\n\nSorguyu yaz:`,
      { temperature: 0.1, maxOutputTokens: 1024 },
    );
    let sql = extractSql(firstAttempt);
    let result;
    try {
      result = await runReadOnly(sql, { limit: 500, timeoutMs: 60_000 });
    } catch (err) {
      // One-shot recovery: feed the SQL error back to the model along with the
      // exact list of tables it is allowed to reference. Most "Invalid object
      // name" / "Invalid column name" errors come from the LLM hallucinating a
      // name that wasn't in the retrieved context.
      const errMsg = (err as Error).message;
      const recoveryPrompt = `Önceki sorgu MSSQL hatası verdi:

HATA: ${errMsg}

ÖNCEKİ SORGU:
\`\`\`sql
${sql}
\`\`\`

KURAL: Sorguda yalnızca aşağıdaki tablolar kullanılabilir, başka tablo adı uydurma:
${allowedTables.map((t) => `- ${t}`).join("\n")}

BAĞLAM (kolonlar ve FK'ler):

${promptContext}

Kullanıcı talebi: ${body.prompt}

Düzeltilmiş sorguyu \`\`\`sql ... \`\`\` bloğunda döndür:`;
      const retryText = await generate(SQL_GEN_SYSTEM, recoveryPrompt, {
        temperature: 0.1,
        maxOutputTokens: 1024,
      });
      sql = extractSql(retryText);
      result = await runReadOnly(sql, { limit: 500, timeoutMs: 60_000 });
    }

    const sampleSummary =
      result.rows.length === 0
        ? "(SONUÇ BOŞ — 0 satır döndü. Bu bir uyarı: özette \"belirledik / bulduk\" deme, veri olmadığını açıkça söyle.)"
        : result.rows
            .slice(0, 10)
            .map((r) =>
              Object.entries(r)
                .map(([k, v]) => `${k}=${formatVal(v)}`)
                .join(", "),
            )
            .join("\n");
    const brief = await generate(
      BRIEF_SYSTEM,
      `Talep: ${body.prompt}\n\nSorgu sonucu (toplam ${result.rowCount} satır):\n${sampleSummary}\n\nKısa özet:`,
      { temperature: 0.3, maxOutputTokens: 512 },
    );

    let savedId: string | undefined;
    if (body.save) {
      const name = body.name ?? body.prompt.slice(0, 60);
      const saved = await saveReport(REPO_ROOT, {
        name,
        sql,
        userPrompt: body.prompt,
        brief,
        retrievedTables: retrieved.map((r) => r.table.fullName),
      });
      // Persist a run snapshot so the dashboard can show a result on first open.
      await runReport(REPO_ROOT, saved.id, { limit: 500 });
      savedId = saved.id;
    }

    return c.json({
      sql,
      brief,
      result: {
        rowCount: result.rowCount,
        truncated: result.truncated,
        durationMs: result.durationMs,
        rows: result.rows.slice(0, 100),
      },
      retrieved: retrieved.map((r) => ({
        fullName: r.table.fullName,
        score: r.score,
        description: r.table.description,
      })),
      savedId,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

function extractSql(text: string): string {
  const fence = text.match(/```sql\s*([\s\S]*?)```/i);
  if (fence && fence[1]) return fence[1].trim();
  const generic = text.match(/```\s*([\s\S]*?)```/);
  if (generic && generic[1]) return generic[1].trim();
  return text.trim();
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length > 30 ? s.slice(0, 30) + "…" : s;
}

const PORT = parseInt(process.env.API_PORT ?? "8080", 10);
serve({ fetch: app.fetch, port: PORT });
console.log(`[enroute-api] listening on http://localhost:${PORT}`);

process.on("SIGINT", async () => {
  await closePool().catch(() => {});
  process.exit(0);
});
