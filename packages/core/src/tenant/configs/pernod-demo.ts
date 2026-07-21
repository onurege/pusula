import type { TenantConfig } from "../types";
import { PERNOD_CONFIG } from "./pernod";

/**
 * Pernod OFFLINE snapshot tenant'ı — MSSQL'e erişimi OLMAYAN bir sunucuda
 * gerçek Pernod verisini göstermek için.
 *
 * Kullanım senaryosu: sunucunun bulutistan Pernod MSSQL'ine ağ erişimi yok.
 * Gerçek veri, erişimi olan bir makinede `data/local.sqlite`'a senkronlanır
 * (map_customers + v7 komuta snapshot), dosya sunucuya kopyalanır. Bu tenant
 * o snapshot'ı CACHE-ONLY servis eder:
 *   - Branding + birim/vergi/marka yapısı = Pernod (spread ile birebir).
 *   - `demoData: true` → statik login (DEMO_LOGIN_USER/PASSWORD, MSSQL auth yok)
 *     + night-refresh & force-refresh KAPALI (MSSQL yok, snapshot ezilmesin).
 *
 * Çalışan ekranlar: Komuta (cache) + Harita (map_customers mirror). Canlı MSSQL
 * isteyen ekranlar (risk/ziyaret/raporlar) bu modda boştur.
 *
 * `TENANT=pernod-demo` ile aktive edilir. Gerçek online Pernod (`pernod`)
 * dokunulmaz — o hâlâ MSSQL auth + canlı refresh kullanır.
 */
export const PERNOD_DEMO_CONFIG: TenantConfig = {
  ...PERNOD_CONFIG,
  id: "pernod-demo",
  // sqliteFileName "local.sqlite" — Pernod snapshot'ı (spread'den gelir).
  demoData: true,
};
