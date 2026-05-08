import { GoogleGenerativeAI } from "@google/generative-ai";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
  client = new GoogleGenerativeAI(apiKey);
  return client;
}

export async function embed(text: string): Promise<number[]> {
  const modelName = process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004";
  const model = getClient().getGenerativeModel({ model: modelName });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // Gemini's batchEmbedContents accepts up to 100 requests per call.
  const modelName = process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004";
  const model = getClient().getGenerativeModel({ model: modelName });
  const out: number[][] = [];
  const batchSize = 100;
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const result = await model.batchEmbedContents({
      requests: slice.map((t) => ({
        content: { role: "user", parts: [{ text: t }] },
      })),
    });
    for (const e of result.embeddings) out.push(e.values);
  }
  return out;
}

/**
 * "Try again later" / "high demand" / 429 / 503 — anything that screams
 * Google capacity issue rather than a real prompt problem. Used to gate
 * automatic retries inside generate().
 */
export function isTransientGeminiError(err: unknown): boolean {
  const msg = (err as Error | undefined)?.message ?? "";
  return /\b(503|429)\b|high demand|service unavailable|temporarily|rate.?limit|overloaded/i.test(
    msg,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Standard primary→primary-retry→fallback attempt schedule shared by both
 * `generate()` and `runAgent()`. Yields a (modelName, label) pair after the
 * appropriate sleep so callers only need to wrap their own generateContent
 * call in a try/catch and check isTransientGeminiError.
 */
export async function* geminiAttempts(): AsyncGenerator<{
  model: string;
  label: string;
}> {
  const primary = process.env.GEMINI_GENERATION_MODEL ?? "gemini-2.5-flash-lite";
  const fallback =
    process.env.GEMINI_GENERATION_FALLBACK_MODEL ?? "gemini-2.5-flash";
  const schedule: { model: string; delayMs: number; label: string }[] = [
    { model: primary, delayMs: 0, label: "primary" },
    { model: primary, delayMs: 800, label: "primary-retry" },
    { model: fallback, delayMs: 1600, label: "fallback" },
  ];
  for (const a of schedule) {
    if (a.delayMs > 0) await sleep(a.delayMs);
    yield { model: a.model, label: a.label };
  }
}

export async function generate(
  systemInstruction: string,
  userPrompt: string,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  let lastErr: unknown = null;
  for await (const { model: modelName } of geminiAttempts()) {
    try {
      const model = getClient().getGenerativeModel({
        model: modelName,
        systemInstruction,
      });
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxOutputTokens ?? 2048,
        },
      });
      return result.response.text();
    } catch (err) {
      lastErr = err;
      // Anything that's not a capacity / rate-limit issue won't get better
      // by retrying on the same model. Bail out immediately so the user
      // sees the real error (bad prompt, bad credentials, malformed schema).
      if (!isTransientGeminiError(err)) throw err;
    }
  }
  throw lastErr ?? new Error("Gemini generate failed without an error");
}
