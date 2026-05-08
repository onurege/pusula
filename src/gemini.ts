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

export async function generate(
  systemInstruction: string,
  userPrompt: string,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  const modelName = process.env.GEMINI_GENERATION_MODEL ?? "gemini-2.5-flash";
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
}
