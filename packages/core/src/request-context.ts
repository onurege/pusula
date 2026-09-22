/**
 * İstek-bazlı bağlam (AsyncLocalStorage) — çok-DB seçimi için.
 *
 * Aynı Insider kurulumunda login'de birden çok veritabanı seçilebildiğinde
 * (Panorama'nın "şirket" seçicisi gibi; bkz. `TenantConfig.databases`), her
 * isteğin HANGİ DB'ye ait olduğunu, `getPool()`/`getLocalDb()` çağıran onlarca
 * fonksiyonun imzasına dokunmadan taşımanın tek temiz yolu budur.
 *
 * Akış:
 *   - API login handler'ı, doğrulanmış `dbId`'yi `runWithDbId` içinde
 *     `authenticateUser`'a sarar → auth sorgusu SEÇİLEN DB'ye gider.
 *   - Auth middleware, JWT'deki `dbId`'yi okur ve isteğin geri kalanını
 *     `runWithDbId(session.dbId, next)` ile sarar → tüm alt sorgular o DB'ye.
 *   - `getPool()` / `getLocalDb()`, `getActiveDbId()` ile aktif dbId'yi okur.
 *
 * Bağlam YOKSA (server boot warm, gece job'ı, veya `databases` tanımlı olmayan
 * tek-DB tenant'lar) `getActiveDbId()` `undefined` döner → çağıranlar bugünkü
 * varsayılan (tek) DB'yi kullanır. Böylece davranış birebir korunur.
 *
 * GÜVENLİK: burada saklanan yalnız bir `dbId` STRING'idir — ham database adı
 * DEĞİL. Ham database adına çeviri `resolveDatabaseName()` içinde, yalnız
 * tenant config'indeki allowlist'e karşı yapılır (fail-closed). Böylece
 * istekten gelen bir değer doğrudan bağlantı config'ine sızamaz.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestDbContext = {
  /** Login'de seçilen veritabanı kimliği (`TenantConfig.databases[].id`). */
  dbId?: string;
};

const storage = new AsyncLocalStorage<RequestDbContext>();

/**
 * `fn`'i, verilen `dbId` aktif olacak şekilde çalıştırır. `dbId` null/undefined
 * ise bağlam boş kurulur (varsayılan DB davranışı). Senkron veya async `fn`
 * ile çalışır (AsyncLocalStorage async zinciri korur).
 */
export function runWithDbId<T>(dbId: string | null | undefined, fn: () => T): T {
  return storage.run({ dbId: dbId ?? undefined }, fn);
}

/** Aktif isteğin seçili dbId'si; bağlam yoksa `undefined`. */
export function getActiveDbId(): string | undefined {
  return storage.getStore()?.dbId;
}
