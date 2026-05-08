import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type Part,
  type Tool,
} from "@google/generative-ai";
import { runReadOnly } from "./db.js";
import { generate } from "./gemini.js";
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

UNIVERA KURALLARI (her sorguda uygula):

1. **TBLMSDFATURA hem satış hem alış hem iade içerir.** Belge türü ayrımı
   \`BYTTUR\` kolonundadır:
   - 0 = Satış (Satış cirosu için TEK kullanılması gereken)
   - 1 = Alış · 2-4 = Müşteri/Tedarikçi İade · 5-6 = Hizmet
   - 98 = Alış İade · 99 = Satış İade
   "Satış" / "ciro" sorularında **mutlaka \`BYTTUR = 0\`** koy.
2. **\`BYTDURUM = 0\` onaylı/aktif belge.** İptal edilmiş belgeleri saymak için
   her satış sorgusunda da bu filtre olur. Distribütör tarafında da \`TBLDIST.BYTDURUM = 0\`
   aktif distribütörü temsil eder.
3. **Tutar kolonları:** TBLMSDFATURA.DBLNETTUTAR (fatura net tutarı). Ürün bazlı
   detayda TBLMSDBELGEDETAY.DBLNETFIYAT × DBLMIKTAR. TBLMSDBELGEDETAY'da
   DBLNETTUTAR YOKTUR.
4. **JOIN yolları:**
   - Fatura → Distribütör: \`TBLMSDFATURA.LNGDISTKOD = TBLDIST.LNGKOD\`
   - Fatura → Müşteri: \`TBLMSDFATURA.LNGMUSTERIKOD = TBLMUSTERI.LNGKOD\`
   - Fatura → Detay: TBLMSDBELGEDETAY üç kolonla bağlanır:
     \`LNGYIL, LNGFATURAKOD = TBLMSDFATURA.LNGBELGEKOD, LNGDISTKOD\`
   - Detay → Ürün: \`TBLMSDBELGEDETAY.LNGURUNKOD = TBLURUN.LNGKOD\`
5. **Ad sütunları:** Distribütör \`TBLDIST.TXTAD\`, müşteri \`TBLMUSTERI.TXTUNVAN\`
   veya \`TXTKISAAD\`, ürün \`TBLURUN.TXTAD\`. Asla sadece kod döndürme.
6. **Ürün GRUBU adı için TBLURUN tek başına yetmez.** \`TXTURUNGRUPADI\` kolonu
   YOKTUR. TBLURUN'da yalnızca \`TXTURUNGRUPKOD\` (varchar) var; grubun adı
   TBLURUNGRUP'tedir:
   \`\`\`sql
   INNER JOIN TBLURUNGRUP g
     ON g.TXTKOD = TBLURUN.TXTURUNGRUPKOD
    AND g.LNGDISTKOD = TBLURUN.LNGDISTKOD
   -- ürün grubunun adı: g.TXTAD
   \`\`\`
7. **TBLMSDBELGEDETAY tutar kolonları:** \`DBLFATURANETFIYAT\` YOKTUR.
   Mevcut olanlar: \`DBLNETFIYAT\` (iskontolu birim fiyat), \`DBLBIRIMFIYAT\`
   (ham birim fiyat), \`DBLMIKTAR\`. Ürün bazlı ciro:
   \`SUM(TBLMSDBELGEDETAY.DBLNETFIYAT * TBLMSDBELGEDETAY.DBLMIKTAR)\`.

HAZIR SORGU TARİFLERİ (kullanıcı talebine göre uyarla, kolon adlarını
değiştirme):

A) Müşterinin son N gün **ürün grubu kırılımı**:
   \`\`\`sql
   SELECT TOP 5
     g.TXTAD AS UrunGrubu,
     SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS Ciro,
     SUM(d.DBLMIKTAR) AS Miktar
   FROM dbo.TBLMSDFATURA f
   INNER JOIN dbo.TBLMSDBELGEDETAY d
     ON d.LNGYIL = f.LNGYIL
    AND d.LNGFATURAKOD = f.LNGBELGEKOD
    AND d.LNGDISTKOD = f.LNGDISTKOD
   INNER JOIN dbo.TBLURUN u
     ON u.LNGKOD = d.LNGURUNKOD
   INNER JOIN dbo.TBLURUNGRUP g
     ON g.TXTKOD = u.TXTURUNGRUPKOD
    AND g.LNGDISTKOD = u.LNGDISTKOD
   WHERE f.LNGMUSTERIKOD = <KOD>
     AND f.BYTTUR = 0 AND f.BYTDURUM = 0
     AND f.TRHISLEMTARIHI >= DATEADD(day, -<GUN>, GETDATE())
   GROUP BY g.TXTAD
   ORDER BY Ciro DESC;
   \`\`\`

B) Müşterinin son N gün **ürün** kırılımı:
   Aynı join yolu, GROUP BY u.TXTAD ile.

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
   tablo dene. Yine de boşsa finalize çağır ve brief'te "veri çıkmadı" de.
6. SQL çalışıp anlamlı sonuç dönünce \`finalize\` çağır:
   - \`sql\`: çalıştığı son SELECT.
   - \`brief\`: 3-5 cümlelik Türkçe iş özeti. Sonuç boşsa "veri çıkmadı"
     diyerek dürüstçe belirt; doluysa en üst 1-2 satırı somut adlarıyla
     zikret. SQL veya teknik jargon yok.

ÇOK ÖNEMLİ — VAZGEÇME:
- Her turda **mutlaka** bir tool çağırırsın: retrieve_schema, run_sql veya finalize.
- Asla kullanıcıya soru sorma, asla "yardım edemiyorum" deme, asla text mesajı dönme.
- Kolon adı yanlışsa: hata mesajını oku, retrieve_schema ile aynı tabloyu yeniden iste,
  detayda kolon listesini gör, doğru kolonla run_sql'i tekrar dene.
- 6 tool çağrısından sonra hâlâ bitmediyse \`finalize\` ile elindeki en iyi durumu sun.
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
  // Tracks every table the agent has seen across all retrieve_schema calls,
  // upper-cased for case-insensitive comparison against generated SQL.
  const allowedUpper = new Set<string>();
  let lastSuccessfulSql: string | null = null;
  let lastRunRows: Record<string, unknown>[] = [];
  let lastRunRowCount = 0;
  let lastRunTruncated = false;
  let lastRunDuration = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const result = await model.generateContent({
      contents,
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      // Force the model to emit a function call every turn. Without this it
      // tends to bail out with apologetic Turkish text after one tool error,
      // which collapses the agent loop. With ANY it must call retrieve_schema,
      // run_sql, or finalize — never give up by chatting back.
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingMode.ANY },
      },
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
          for (const r of results) {
            retrievedTables.add(r.table.fullName);
            allowedUpper.add(r.table.fullName.toUpperCase());
          }
          const allowedSoFar = [...allowedUpper].sort();
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
                criticalRule:
                  "Aşağıdaki ALLOWED_TABLES listesi dışındaki bir tabloyu run_sql'e koyma — uydurma sayılır ve reddedilir.",
                allowedTablesThisCall: results.map((r) => r.table.fullName),
                allowedTablesCumulative: allowedSoFar,
                detailedContext: formatRetrievalForPrompt(results),
              },
            },
          });
        } else if (name === "run_sql") {
          const sql = String(args.sql ?? "");

          // Pre-validate referenced tables against everything the agent has
          // retrieved so far. This catches hallucinated names without paying
          // a MSSQL round-trip (and prevents the model from trying random
          // table names like TBLSATIS / TBLSATISFATURADETAY on every loop).
          const referenced = extractTableRefs(sql);
          const unknown = referenced.filter((t) => !allowedUpper.has(t.toUpperCase()));
          if (unknown.length > 0) {
            steps.push({
              kind: "tool_result",
              tool: name,
              ok: false,
              summary: `Pre-validation: bilinmeyen tablo(lar) ${unknown.join(", ")}`,
            });
            responseParts.push({
              functionResponse: {
                name,
                response: {
                  error: `Sorgu retrieve_schema'dan dönmemiş tablo(ları) içeriyor: ${unknown.join(", ")}. Bu tablolar uydurma; var olduğundan emin değilsin.`,
                  allowedTablesCumulative: [...allowedUpper].sort(),
                  hint:
                    "İki yol: (1) yine de bu konuda tablo aramak istersen retrieve_schema'yı farklı bir Türkçe terimle çağır; (2) elindeki listeden uygun tabloyu seçip SQL'i yeniden yaz.",
                },
              },
            });
            continue;
          }

          const startedAt = Date.now();
          try {
            const out = await runReadOnly(sql, { limit: 500, timeoutMs: 60_000 });
            lastSuccessfulSql = sql;
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

  // Loop ended without an explicit finalize. If we have a successful SQL on
  // record, treat its result as the answer and synthesize a brief — it is
  // strictly better than throwing away a working query just because the
  // model forgot to call finalize at the end.
  if (lastSuccessfulSql) {
    const sample =
      lastRunRows.length === 0
        ? "(SONUÇ BOŞ — 0 satır)"
        : lastRunRows
            .slice(0, 10)
            .map((r) =>
              Object.entries(r)
                .map(([k, v]) => `${k}=${formatVal(v)}`)
                .join(", "),
            )
            .join("\n");
    let brief: string;
    try {
      brief = await generate(
        `Sen Türkçe bir analiz asistanısın. Sana bir kullanıcı talebi ve sorgu sonucundan örnek satırlar verilecek. 3-5 cümle Türkçe iş özeti yaz. 0 satırsa "veri çıkmadı" de, halüsinasyon yapma. Veri varsa en üst 1-2 satırı somut adlarıyla zikret. Teknik jargon yok.`,
        `Talep: ${userPrompt}\n\nSonuç (toplam ${lastRunRowCount} satır):\n${sample}\n\nKısa Türkçe özet:`,
        { temperature: 0.3, maxOutputTokens: 512 },
      );
    } catch {
      brief = lastRunRowCount === 0
        ? "Sorgu çalıştı ancak 0 satır döndü. Veri yok ya da filtreler çok dar."
        : `Sorgu çalıştı, ${lastRunRowCount} satır döndü.`;
    }
    steps.push({ kind: "final", sql: lastSuccessfulSql, brief });
    return {
      steps,
      final: { sql: lastSuccessfulSql, brief: brief.trim() },
      retrievedTables: [...retrievedTables],
      rows: lastRunRows,
      rowCount: lastRunRowCount,
      truncated: lastRunTruncated,
      durationMs: lastRunDuration,
    };
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

/**
 * Pull table names out of FROM / JOIN clauses. Naive but enough for our
 * pre-validation: matches `[schema].[table]`, `schema.table`, or `table`,
 * with optional aliases. Nested parens (subqueries) are tolerated because
 * the regex matches occurrences anywhere in the string.
 */
function extractTableRefs(sql: string): string[] {
  const out: string[] = [];
  const stripped = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /\b(?:FROM|JOIN)\s+\[?(\w+)\]?(?:\s*\.\s*\[?(\w+)\]?)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const a = m[1];
    const b = m[2];
    if (b) out.push(`${a}.${b}`);
    else if (a) out.push(`dbo.${a}`);
  }
  return out;
}
