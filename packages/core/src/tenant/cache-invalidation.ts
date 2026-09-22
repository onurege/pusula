/**
 * Müşteri kırılımı boyutunu KULLANAN domain cache'lerinin senkron invalidation
 * kancası (Faz 0 B1).
 *
 * Neden gerekli: `withCache` her fetcher dosyasında literal bir `CACHE_VERSION`
 * ile anahtarlanır (örn. wietnauer-segment.ts "v7", komuta.ts "facets-v4").
 * Bu literal'lar şema DEĞİŞTİĞİNDE elle artırılır — ama runtime mapping
 * override'ı (Dalga 2'nin config-save endpoint'i) bir literal DEĞİL, disk
 * override'ı değiştirir; `CACHE_VERSION` sabit kaldığı için `withCache` eski
 * eşlemeyle üretilmiş satırları servis etmeye DEVAM eder. Kullanıcı gece
 * yarısı otomatik yenilemeye kadar (ya da elle "Verileri Yenile"ye basana
 * kadar) bayat veri görür.
 *
 * Çözüm: config-save endpoint'i override'ı yazdıktan HEMEN SONRA bu
 * fonksiyonu çağırır — ilgili tüm domain'lerin cache'i senkron temizlenir,
 * bir sonraki istek taze veriyle yeniden ısınır. "Verileri Yenile" butonu
 * yalnız pro-aktif re-warm için kalır, invalidation'ın KENDİSİ için gerekmez.
 *
 * Bu dalga yalnız fonksiyonu hazırlar — çağıran endpoint Dalga 2'de gelir.
 */
import { cachedClear } from "../cache";

/**
 * Müşteri kırılımı boyutunu okuyan fetcher dosyalarının `CACHE_DOMAIN`
 * sabitleri (bkz. her dosyanın kendi `const CACHE_DOMAIN = "..."` satırı).
 * Yeni bir dosya bu boyutu kullanmaya başlarsa buraya da eklenmeli —
 * `resolveIdentifier` gibi merkezi değil çünkü cache domain'i SQL değil,
 * `withCache` anahtarlama sözleşmesi; ileride bir registry'ye taşınabilir.
 */
export const CUSTOMER_BREAKDOWN_CACHE_DOMAINS = [
  "komuta",
  "wietnauer-saha",
  "wietnauer-iskonto",
  "wietnauer-aktivasyon",
  "wietnauer-segment",
] as const;

/** İlgili tüm domain cache'lerini temizler — bir sonraki istek taze üretir. */
export function invalidateCustomerBreakdownCaches(): void {
  for (const domain of CUSTOMER_BREAKDOWN_CACHE_DOMAINS) cachedClear(domain);
}

/**
 * Ürün/marka kırılımı boyutunu (`tenant.brandTable`/`brandJoinColumn` →
 * `dimensions.productBreakdown`) okuyan fetcher dosyalarının `CACHE_DOMAIN`
 * sabitleri. `wietnauer-metrics.ts`'in kendi `CACHE_DOMAIN` sabiti
 * `"wietnauer"` (dosya adıyla eşleşmiyor — mevcut kod, değiştirilmedi).
 */
export const PRODUCT_BREAKDOWN_CACHE_DOMAINS = [
  "komuta",
  "wietnauer-marka",
  "wietnauer-segment",
  "wietnauer-aktivasyon",
  "wietnauer-stok",
  "wietnauer",
  "wietnauer-iskonto",
] as const;

/** İlgili tüm domain cache'lerini temizler — bir sonraki istek taze üretir. */
export function invalidateProductBreakdownCaches(): void {
  for (const domain of PRODUCT_BREAKDOWN_CACHE_DOMAINS) cachedClear(domain);
}

/**
 * Bölge kırılımı boyutunu (`tenant.distRegionTable`/`distRegionColumn` →
 * `dimensions.regionBreakdown`) okuyan fetcher dosyalarının `CACHE_DOMAIN`
 * sabitleri.
 */
export const REGION_BREAKDOWN_CACHE_DOMAINS = ["komuta", "wietnauer-saha", "wietnauer-stok"] as const;

/** İlgili tüm domain cache'lerini temizler — bir sonraki istek taze üretir. */
export function invalidateRegionBreakdownCaches(): void {
  for (const domain of REGION_BREAKDOWN_CACHE_DOMAINS) cachedClear(domain);
}
