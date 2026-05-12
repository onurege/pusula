import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

export type OtvData = {
  byKeyword: Record<string, number>;
  byTier: Partial<Record<"luxury" | "premium" | "core" | "value", number>>;
  fallback: number;
};

let cache: OtvData | null = null;

export async function loadOtv(): Promise<OtvData> {
  if (cache) return cache;
  try {
    const raw = await readFile(
      path.join(REPO_ROOT, "data/tax/otv-rates.json"),
      "utf-8",
    );
    cache = JSON.parse(raw) as OtvData;
  } catch (err) {
    console.warn("[otv] otv-rates.json yüklenemedi, fallback 0 kullanılır:", err);
    cache = { byKeyword: {}, byTier: {}, fallback: 0 };
  }
  return cache;
}

function trUpperNorm(s: string): string {
  return s
    .replace(/i/g, "İ")
    .replace(/ı/g, "I")
    .toUpperCase()
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ç/g, "C")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ö/g, "O");
}

/**
 * Ürün grubu adından + tier'ından ÖTV oranını çıkarır.
 * Sıra: byKeyword → byTier → fallback.
 * Dönüş: 0-1 arası ondalık (örn. 0.70 = %70 ÖTV).
 */
export function getOtvRate(
  groupName: string,
  tier: "luxury" | "premium" | "core" | "value",
  data: OtvData,
): number {
  const upper = trUpperNorm(groupName);
  for (const [kw, rate] of Object.entries(data.byKeyword)) {
    if (upper.includes(trUpperNorm(kw))) return rate;
  }
  return data.byTier[tier] ?? data.fallback;
}
