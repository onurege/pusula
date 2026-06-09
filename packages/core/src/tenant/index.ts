import type { TenantConfig } from "./types";
import { PERNOD_CONFIG } from "./configs/pernod";
import { FMCG_DEMO_CONFIG } from "./configs/fmcg-demo";

export type { TenantConfig, Industry, VolumeUnit, TaxToggle, TenantLabels } from "./types";

/**
 * Bilinen tüm tenant config'leri — id ile lookup map'i.
 *
 * Yeni tenant eklemek için:
 *   1. `configs/<isim>.ts` oluştur
 *   2. Buraya import et + map'e ekle
 *   3. `TENANT=<isim>` env var ile aktive et
 */
const REGISTRY: Record<string, TenantConfig> = {
  pernod: PERNOD_CONFIG,
  "fmcg-demo": FMCG_DEMO_CONFIG,
};

/**
 * Default tenant — `TENANT` env var boşken veya bilinmeyen değerken bu döner.
 *
 * Pernod canlı sistemi etkilenmesin diye explicit olarak Pernod default.
 * Yeni tenant eklendiğinde bu değer asla değişmemeli (geriye uyumluluk).
 */
const DEFAULT_TENANT_ID = "pernod";

let cachedConfig: TenantConfig | null = null;
let cachedEnvValue: string | undefined = undefined;

/**
 * Aktif tenant config'ini döner. `process.env.TENANT` her seferinde okunur
 * (yalnızca değer değişirse cache invalidate edilir — geri kalan çağrılar
 * sabit map lookup).
 *
 * Bilinmeyen TENANT değeri: console.warn + Pernod default. Bu sayede typo
 * canlı sistemi düşürmez, sadece log'da görünür.
 */
export function getTenantConfig(): TenantConfig {
  const envValue = process.env.TENANT;
  if (cachedConfig && cachedEnvValue === envValue) return cachedConfig;

  const id = envValue?.trim() || DEFAULT_TENANT_ID;
  const config = REGISTRY[id];

  if (!config) {
    console.warn(
      `[tenant] Bilinmeyen TENANT="${envValue}" — default "${DEFAULT_TENANT_ID}" kullanılıyor. ` +
        `Mevcut id'ler: ${Object.keys(REGISTRY).join(", ")}`,
    );
    cachedConfig = REGISTRY[DEFAULT_TENANT_ID]!;
  } else {
    cachedConfig = config;
  }
  cachedEnvValue = envValue;
  return cachedConfig;
}

/**
 * Cache'i sıfırla — test runner'da TENANT'ı runtime'da değiştirmek için.
 * Production'da gerekmez (env var process boyunca sabittir).
 */
export function clearTenantCache(): void {
  cachedConfig = null;
  cachedEnvValue = undefined;
}

/**
 * Kayıtlı tüm tenant id'lerini listele — runtime tenant switcher (Faz 3)
 * dropdown'unda kullanılır.
 */
export function listTenantIds(): string[] {
  return Object.keys(REGISTRY);
}
