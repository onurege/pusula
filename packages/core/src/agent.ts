import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type Part,
  type Tool,
} from "@google/generative-ai";
import { runReadOnly } from "./db.js";
import { formatRetrievalForPrompt, retrieve } from "./retrieve.js";
import { loadSnapshot } from "./snapshot.js";

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  if (client) return client;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  client = new GoogleGenerativeAI(key);
  return client;
}

export type AgentStep =
  | { kind: "tool_call"; tool: string; args: Record<string, unknown> }
  | { kind: "tool_result"; tool: string; ok: boolean; summary: string }
  | { kind: "final"; sql: string; brief: string }
  | { kind: "give_up"; reason: string };

export type AgentResult = {
  steps: AgentStep[];
  final?: { sql: string; brief: string };
  retrievedTables: string[];
  /** Sample rows from the final successful SQL execution. */
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
};

const AGENT_SYSTEM = `
Sen Univera ERP veritabanı üzerinde Türkçe iş soruları için rapor üreten bir
veri-analizi ajanısın. Halüsinasyona kesinlikle yer yok — şema bilgisi ancak
\`retrieve_schema\` çağrısıyla, sorgu doğrulaması ancak \`run_sql\` çağrısıyla
gelir. Tablo veya kolon adı uydurma; bağlamda yoksa o yoktur.

ÇALIŞMA YÖNTEMİN:

1. Önce \`retrieve_schema\` ile kullanıcının talebine uygun tablo(ları) bul.
   Gerekirse farklı sözcüklerle birden fazla kez çağır (ör. "satış", "fatura",
   "distribütör"). Her çağrıda en fazla 8-10 tablo iste.
2. Bağlamdan uygun tabloları seç. _YEDEK / _OLD / _BAK / _BIRLESTIRME(DETAY) /
   _<tarih> ile biten tablolardan KAÇIN — bunlar yedek/arşiv'tir, ana tablo değil.
3. \`run_sql\` ile sorguyu çalıştır. Sorgu kuralları:
   - Yalnızca SELECT. INSERT/UPDATE/DELETE/DDL yasak.
   - \`SELECT TOP\` ile satır sayısını sınırla (default 100, en fazla 1000).
   - Distribütör/müşteri/ürün sorgularında **kod yanında ad döndür** —
     gerekirse bağlamdaki ana entity tablosuna INNER JOIN yap (TXTAD/TXTUNVAN).
   - "Satış / ciro / hasılat" sorgularında COUNT yerine SUM(DBLNETTUTAR /
     DBLBRUTTUTAR / DBLTUTAR) kullan. Sadece kayıt sayısı istenmişse COUNT.
   - Aktiflik filtresi gerekirse \`BYTDURUM = 0\` (aktif) ekle.
4. Hata gelirse (Invalid object name / Invalid column name): hatayı oku,
   bağlamı tekrar gözden geçir, gerekirse \`retrieve_schema\` ile yeni tablo ara,
   sorguyu düzelt ve \`run_sql\`'i tekrar çağır. En fazla 4 kez dene.
5. Sonuç boş döndü mü? Tarih aralığını veya filtreleri gevşet, farklı bir
   tablo dene. Yine de boşsa kullanıcıya boş olduğunu açıkça söyle.
6. SQL çalışıp anlamlı sonuç dönünce \`finalize\` çağır:
   - \`sql\`: çalıştığı son SELECT.
   - \`brief\`: 3-5 cümlelik Türkçe iş özeti. Sonuç boşsa "veri çıkmadı"
     diyerek dürüstçe belirt; doluysa en üst 1-2 satırı somut adlarıyla
     zikret. SQL veya teknik jargon yok.

Kısa düşün, çok adımdan kaçın. 6 tool çağrısından sonra hâlâ bitmediyse
\`finalize\` ile elindeki en iyi sonucu sun.
`.trim();

const TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "retrieve_schema",
        description:
          "Univera şemasından bir Türkçe iş sorusuna uygun tabloları getirir. Tablo açıklamaları, kolonlar (tipleriyle), birincil anahtarlar ve 1-hop FK komşuları döner.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: {
              type: SchemaType.STRING,
              description: "Türkçe veya İngilizce bir iş sorusu / anahtar sözcükler",
            },
            topK: {
              type: SchemaType.NUMBER,
              description: "Döndürülecek tablo sayısı (default 8, en fazla 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "run_sql",
        description:
          "MSSQL Univera üzerinde tek bir SELECT çalıştırır. Read-only — INSERT/UPDATE/DELETE/DDL reddedilir. Default 500 satır, 60s timeout.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            sql: { type: SchemaType.STRING },
          },
          required: ["sql"],
        },
      },
      {
        name: "finalize",
        description:
          "Çalışan SQL ve Türkçe brifing hazır olduğunda son sonucu sun. Bu çağrıdan sonra tool döngüsü biter.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            sql: { type: SchemaType.STRING },
            brief: { type: SchemaType.STRING },
          },
          required: ["sql", "brief"],
        },
      },
    ],
  },
];

const MAX_ITERATIONS = 8;
const RETRIEVE_TOPK_CAP = 20;

export async function runAgent(userPrompt: string): Promise<AgentResult> {
  const modelName = process.env.GEMINI_GENERATION_MODEL ?? "gemini-2.5-flash-lite";
  const model = getClient().getGenerativeModel({
    model: modelName,
    systemInstruction: AGENT_SYSTEM,
    tools: TOOLS,
  });

  const contents: Content[] = [
    { role: "user", parts: [{ text: userPrompt }] },
  ];
  const steps: AgentStep[] = [];
  const retrievedTables = new Set<string>();
  let lastRunRows: Record<string, unknown>[] = [];
  let lastRunRowCount = 0;
  let lastRunTruncated = false;
  let lastRunDuration = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const result = await model.generateContent({
      contents,
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    });

    const candidate = result.response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    contents.push({ role: "model", parts });

    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: { name: string; args: Record<string, unknown> } } =>
        Boolean((p as Part).functionCall),
    );

    if (functionCalls.length === 0) {
      const text = parts.map((p) => ("text" in p ? p.text : "")).join("").trim();
      steps.push({ kind: "give_up", reason: text || "model returned no tool call and no text" });
      break;
    }

    const responseParts: Part[] = [];
    let finalized = false;

    for (const call of functionCalls) {
      const { name, args } = call.functionCall;
      steps.push({ kind: "tool_call", tool: name, args });

      try {
        if (name === "retrieve_schema") {
          const query = String(args.query ?? "");
          const topK = Math.min(Number(args.topK ?? 8), RETRIEVE_TOPK_CAP);
          const snap = await loadSnapshot();
          const results = retrieve(query, snap, { topK, expandFkNeighbors: true });
          for (const r of results) retrievedTables.add(r.table.fullName);
          const summary = `Bulunan ${results.length} tablo:\n` +
            results.map((r) => `- ${r.table.fullName} (score=${r.score})`).join("\n");
          steps.push({
            kind: "tool_result",
            tool: name,
            ok: true,
            summary: `${results.length} table(s)`,
          });
          responseParts.push({
            functionResponse: {
              name,
              response: {
                tableList: summary,
                detailedContext: formatRetrievalForPrompt(results),
                allowedTables: results.map((r) => r.table.fullName),
              },
            },
          });
        } else if (name === "run_sql") {
          const sql = String(args.sql ?? "");
          const startedAt = Date.now();
          try {
            const out = await runReadOnly(sql, { limit: 500, timeoutMs: 60_000 });
            lastRunRows = out.rows;
            lastRunRowCount = out.rowCount;
            lastRunTruncated = out.truncated;
            lastRunDuration = Date.now() - startedAt;
            const sample = out.rows
              .slice(0, 10)
              .map((r) => Object.entries(r).map(([k, v]) => `${k}=${formatVal(v)}`).join(", "))
              .join("\n");
            steps.push({
              kind: "tool_result",
              tool: name,
              ok: true,
              summary: `${out.rowCount} satır, ${lastRunDuration}ms`,
            });
            responseParts.push({
              functionResponse: {
                name,
                response: {
                  rowCount: out.rowCount,
                  truncated: out.truncated,
                  durationMs: lastRunDuration,
                  sampleRows: sample || "(boş sonuç)",
                  hint:
                    out.rowCount === 0
                      ? "Sonuç boş. Tarih aralığını veya filtreleri gevşetmeyi, farklı bir tablo denemeyi düşün."
                      : "Sorgu çalıştı. Sonuç anlamlıysa finalize çağır.",
                },
              },
            });
          } catch (err) {
            const errMsg = (err as Error).message;
            lastRunDuration = Date.now() - startedAt;
            steps.push({
              kind: "tool_result",
              tool: name,
              ok: false,
              summary: errMsg.slice(0, 200),
            });
            responseParts.push({
              functionResponse: {
                name,
                response: {
                  error: errMsg,
                  hint:
                    "Hatadan ders çıkar. Tablo/kolon adı bağlamda var mıydı? Gerekirse retrieve_schema ile yeniden ara, sonra düzeltilmiş SELECT ile tekrar dene.",
                },
              },
            });
          }
        } else if (name === "finalize") {
          const sql = String(args.sql ?? "");
          const brief = String(args.brief ?? "");
          steps.push({ kind: "final", sql, brief });
          finalized = true;
          responseParts.push({
            functionResponse: { name, response: { ok: true } },
          });
          return {
            steps,
            final: { sql, brief },
            retrievedTables: [...retrievedTables],
            rows: lastRunRows,
            rowCount: lastRunRowCount,
            truncated: lastRunTruncated,
            durationMs: lastRunDuration,
          };
        } else {
          steps.push({
            kind: "tool_result",
            tool: name,
            ok: false,
            summary: `unknown tool: ${name}`,
          });
          responseParts.push({
            functionResponse: { name, response: { error: `unknown tool: ${name}` } },
          });
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        steps.push({ kind: "tool_result", tool: name, ok: false, summary: errMsg });
        responseParts.push({
          functionResponse: { name, response: { error: errMsg } },
        });
      }
    }

    if (finalized) break;

    contents.push({ role: "function", parts: responseParts });
  }

  return {
    steps,
    retrievedTables: [...retrievedTables],
    rows: lastRunRows,
    rowCount: lastRunRowCount,
    truncated: lastRunTruncated,
    durationMs: lastRunDuration,
  };
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length > 30 ? s.slice(0, 30) + "…" : s;
}
