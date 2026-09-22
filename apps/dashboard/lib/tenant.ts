/**
 * Dashboard tarafı tenant config wrapper'ı — server components için.
 *
 * Server component'lerden direkt `getTenantConfig()` çağrılır. Client
 * component'ler için `<TenantProvider>` + `useTenant()` hook'u kullanılır
 * (apps/dashboard/components/tenant-provider.tsx).
 *
 * `TENANT` env var:
 *   - Boş veya tanımsız → "pernod" (default, canlı sistem davranışı)
 *   - "fmcg-demo" → karma FMCG demo data
 *   - Bilinmeyen → console.warn + Pernod default
 *
 * `isTenantFullyMissing()` (Faz A Dalga 2 — güvenli setup modu): boş
 * sunucuda `TENANT=<yeni>` ile açılışta tanım yoksa `getTenantConfig()`
 * THROW eder; bu fonksiyon THROW ETMEDEN önce kontrol imkanı verir. Kök
 * layout (`app/layout.tsx`) bunu kullanır — bkz. o dosyanın üst yorumu.
 */
export { getTenantConfig, listTenantIds, isTenantFullyMissing } from "@enroute/core/tenant";
export type {
  TenantConfig,
  Industry,
  VolumeUnit,
  TaxToggle,
  TenantLabels,
} from "@enroute/core/tenant";
