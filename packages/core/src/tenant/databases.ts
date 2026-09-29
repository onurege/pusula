/**
 * Çok-DB (login'de DB seçimi) — paylaşılan doğrulama + env ayrıştırma. Aynı
 * MSSQL sunucusu/kimliği, farklı `database`. İki kaynak bunu kullanır:
 *   - `index.ts` (env fallback: `${ID}_DATABASES`),
 *   - `databases-config.ts` (admin konfigüratörden kodsuz kayıt).
 * Regex'ler ve doğrulama TEK yerde (Metz DRY) — biri güncellenip diğeri
 * unutulmasın.
 */
import type { TenantDatabase } from "./types";

/** dbId: URL/JWT güvenli kısa kimlik. */
export const DB_ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
/** database adı: savunma-derinliği (bağlantı parametresi; SQL'e interpolate edilmez). */
export const DB_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_$-]{0,62}$/;

/** Etiketten geçerli bir dbId türet (kayıtta id verilmezse). */
export function slugifyDbId(label: string): string {
  const s = label
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 31);
  return s || "db";
}

/**
 * `${ID}_DATABASES` env'inden liste. Biçim: virgülle ayrık `id:label:database`
 * (label'da iki nokta olabilir: ilk=id, son=database, ortası=label). Geçersiz
 * girdiler ATLANIR; ≥2 geçerli eleman yoksa `undefined` (tek-DB).
 */
export function parseDatabasesEnv(rawId: string): TenantDatabase[] | undefined {
  const raw = process.env[`${rawId.toUpperCase().replace(/-/g, "_")}_DATABASES`];
  if (!raw || !raw.trim()) return undefined;
  const list: TenantDatabase[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const parts = entry.split(":").map((s) => s.trim());
    if (parts.length < 3) continue;
    const id = parts[0] ?? "";
    const database = parts[parts.length - 1] ?? "";
    const label = parts.slice(1, -1).join(":").trim();
    if (!DB_ID_RE.test(id) || !DB_NAME_RE.test(database) || !label) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    list.push({ id, label, database });
  }
  return list.length >= 2 ? list : undefined;
}

export type DatabaseInput = { id?: string; label?: string; database?: string };

/**
 * Admin'den gelen ham listeyi doğrula + normalize et (kaydetmeden ÖNCE).
 * Geçersizse THROW — fail-closed; sessizce atlamaz, kaydeden net hata alır.
 * `id` verilmezse etiketten türetilir. Boş dizi geçerli (çok-DB'yi kapatır).
 */
export function validateDatabaseList(input: unknown): TenantDatabase[] {
  if (!Array.isArray(input)) throw new Error("Veritabanı listesi bir dizi olmalı.");
  const out: TenantDatabase[] = [];
  const seen = new Set<string>();
  for (const rawItem of input) {
    const item = (rawItem ?? {}) as DatabaseInput;
    const label = (item.label ?? "").trim();
    const database = (item.database ?? "").trim();
    if (!label) throw new Error("Her satırda bir etiket (görünen ad) zorunlu.");
    if (!DB_NAME_RE.test(database)) {
      throw new Error(`Geçersiz veritabanı adı: "${database}". Yalnız harf/rakam/_-$ (en çok 63 karakter).`);
    }
    const id = ((item.id ?? "").trim() || slugifyDbId(label));
    if (!DB_ID_RE.test(id)) throw new Error(`Geçersiz kimlik: "${id}".`);
    if (seen.has(id)) throw new Error(`Yinelenen kimlik: "${id}" — her satır benzersiz olmalı.`);
    seen.add(id);
    out.push({ id, label, database });
  }
  return out;
}
