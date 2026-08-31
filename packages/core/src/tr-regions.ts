/**
 * Türkiye'nin 7 klasik coğrafi bölgesi (+ Kıbrıs) için il → bölge eşlemesi.
 *
 * Bizim DB'mizdeki `sehir` alanı (TBLMUSTERI.TXTSEHIR) il adıdır; buradaki
 * yardımcılar TR diacritic-strip + upper normalize sonrası eşleştirir.
 *
 * Master: data/geo/tr-province-region.json
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

export type RegionInfo = {
  region: string;
  color: string;
};

export type RegionMaster = {
  /** province (normalized) → { region, color } */
  byProvince: Map<string, RegionInfo>;
  /** region name → list of provinces (normalized) + display props */
  byRegion: Map<
    string,
    { color: string; centroid: [number, number]; provinces: string[] }
  >;
};

let cached: RegionMaster | null = null;

/**
 * TR diacritic strip + uppercase. "İstanbul" → "ISTANBUL".
 * Karşılaştırma her zaman bu fonksiyondan geçer.
 */
export function normalizeProvince(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/İ/g, "I")
    .replace(/ı/g, "I")
    .replace(/I/g, "I")
    .replace(/i/g, "I")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "S")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/ü/g, "U")
    .replace(/Ö/g, "O")
    .replace(/ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "C")
    .toUpperCase()
    .trim();
}

export async function loadRegionMaster(): Promise<RegionMaster> {
  if (cached) return cached;
  const filePath = path.join(REPO_ROOT, "data/geo/tr-province-region.json");
  const raw = await readFile(filePath, "utf-8");
  const json = JSON.parse(raw) as {
    regions: Record<
      string,
      { color: string; centroid?: [number, number]; provinces: string[] }
    >;
  };

  const byProvince = new Map<string, RegionInfo>();
  const byRegion = new Map<
    string,
    { color: string; centroid: [number, number]; provinces: string[] }
  >();

  for (const [regionName, info] of Object.entries(json.regions)) {
    const normProvinces: string[] = [];
    for (const p of info.provinces) {
      const norm = normalizeProvince(p);
      byProvince.set(norm, { region: regionName, color: info.color });
      normProvinces.push(norm);
    }
    byRegion.set(regionName, {
      color: info.color,
      centroid: info.centroid ?? [35, 39],
      provinces: normProvinces,
    });
  }

  cached = { byProvince, byRegion };
  return cached;
}

/** Bir il (sehir) için klasik bölge adı. Eşleşmezse null döner. */
export async function regionForCity(
  city: string | null | undefined,
): Promise<string | null> {
  const master = await loadRegionMaster();
  const norm = normalizeProvince(city);
  if (!norm) return null;
  return master.byProvince.get(norm)?.region ?? null;
}

/**
 * Alias → kanonik (geojson'da bulunan) il adı eşlemesi.
 *
 * Master JSON tarihsel/alternatif isimleri de provinces listesinde tutar
 * (örn. "AFYONKARAHISAR" ve "AFYON" ayrı entry). Customer.TXTSEHIR herhangi
 * birini içerebilir. Ama tr-provinces.geojson'da TR'nin 81 ilinin sadece
 * KANONİK adı var (TÜİK convention). Bu yüzden customer match'i sonrası
 * canonical'a çevirmek gerek, yoksa polygon lookup başarısız → harita
 * "bayisiz" gösterir.
 */
const ALIAS_TO_CANONICAL: Record<string, string> = {
  AFYONKARAHISAR: "AFYON",
  ICEL: "MERSIN",
  "K.MARAS": "KAHRAMANMARAS",
  KMARAS: "KAHRAMANMARAS",
  URFA: "SANLIURFA",
};

/** Alias varsa geojson kanonik adına çevir. Yoksa girdiyi olduğu gibi döner. */
export function canonicalProvince(norm: string): string {
  return ALIAS_TO_CANONICAL[norm] ?? norm;
}

/** Sync versiyonu — master önceden load edilmişse hızlı. Yoksa null. */
export function regionForCitySync(
  city: string | null | undefined,
  master: RegionMaster,
): string | null {
  const norm = normalizeProvince(city);
  if (!norm) return null;
  return master.byProvince.get(norm)?.region ?? null;
}
