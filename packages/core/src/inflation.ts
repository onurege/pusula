import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

export type InflationData = {
  /** YYYY-MM → kümülatif TÜFE endeks değeri */
  monthlyIndex: Record<string, number>;
};

let cache: InflationData | null = null;

export async function loadInflation(): Promise<InflationData> {
  if (cache) return cache;
  try {
    const raw = await readFile(
      path.join(REPO_ROOT, "data/inflation/tufe-tr.json"),
      "utf-8",
    );
    cache = JSON.parse(raw) as InflationData;
  } catch (err) {
    console.warn("[inflation] tufe-tr.json yüklenemedi, multiplier=1 kullanılacak:", err);
    cache = { monthlyIndex: {} };
  }
  return cache;
}

/**
 * Geçmiş bir tarihteki nominal değeri bugünün parasına çevirmek için multiplier.
 *
 * Örnek: 2025 Nisan endeksi 151.20, 2026 Mayıs endeksi 183.20
 *   multiplier = 183.20 / 151.20 ≈ 1.212
 *   Yani 2025 Nisan'daki 100k ₺ bugün 121.2k ₺'ye karşılık geliyor.
 */
export function getMultiplier(
  pastYyyymm: string,
  currentYyyymm: string,
  data: InflationData,
): number {
  const past = data.monthlyIndex[pastYyyymm];
  const current = data.monthlyIndex[currentYyyymm];
  if (!past || !current || past <= 0) return 1;
  return current / past;
}

/** YYYY-MM formatında bugünün ayını döndürür. */
export function currentYyyymm(today: Date = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

/** Bir tarihten önce N gün geriye giderek YYYY-MM döndürür. */
export function yyyymmDaysAgo(days: number, today: Date = new Date()): string {
  const d = new Date(today.getTime() - days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Bir tarihten N yıl geriye + offset gün ile YYYY-MM döndürür. */
export function yyyymmYearsAgo(years: number, today: Date = new Date()): string {
  const d = new Date(today.getTime() - years * 365 * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
