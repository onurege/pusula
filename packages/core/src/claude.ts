/**
 * Claude (Anthropic) metin üretimi — `gemini.ts:generate` ile aynı imza,
 * ama Anthropic SDK üzerinden. Şimdilik yalnızca Komuta "günün AI yorumu"
 * (brief) bunu kullanır; embeddings ve diğer generate() çağrıları Gemini'de
 * kalır (bilinçli — yalnızca brief taşındı).
 *
 * Model env ile ayarlanır (CLAUDE_BRIEF_MODEL); varsayılan claude-haiku-4-5
 * (brief basit bir 3-paragraf özet — en ucuz model yeterli). Anahtar:
 * ANTHROPIC_API_KEY.
 */
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY");
    }
    client = new Anthropic(); // anahtarı ANTHROPIC_API_KEY env'inden okur
  }
  return client;
}

/**
 * Sistem talimatı + kullanıcı prompt'undan düz metin üretir.
 * `gemini.ts:generate` ile aynı çağrı imzası (temperature Claude'da yok sayılır;
 * güncel modeller temperature parametresini reddediyor).
 */
export async function generateClaude(
  systemInstruction: string,
  userPrompt: string,
  options: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  const model = process.env.CLAUDE_BRIEF_MODEL?.trim() || "claude-haiku-4-5";
  const res = await getClient().messages.create({
    model,
    max_tokens: options.maxOutputTokens ?? 1024,
    system: systemInstruction,
    messages: [{ role: "user", content: userPrompt }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
