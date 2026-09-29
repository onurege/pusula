/**
 * Merkezi admin-gate middleware factory (Security H3) — `/api/admin/*`
 * altındaki her yeni route için `isAdminUser` kontrolünü elle tekrarlamayı
 * önler (bkz. `server.ts` `app.use("/api/admin/*", createAdminGate(...))`).
 *
 * Ayrı dosyaya çıkarılma sebebi (Metz — test edilebilirlik): `server.ts`
 * import edildiğinde `serve()` gerçek bir TCP portu dinlemeye başlıyor ve
 * gece cron'unu planlıyor — bu modülü doğrudan import edip unit test etmek
 * ağır/yan-etkili olurdu. Bu dosya SIFIR yan etkiye sahip saf bir middleware
 * fabrikası; `server.ts`'in geri kalanına dokunmadan izole test edilebilir
 * (bkz. `__tests__/admin-gate.test.ts`).
 */
import type { MiddlewareHandler } from "hono";
import { verifySession, isAdminUser } from "@enroute/core";

/** `server.ts`'teki `tokenFromRequest` ile AYNI imza — enjekte edilir,
 *  kopyalanmaz (tek gerçek kaynak `server.ts`'te kalır). */
export type TokenExtractor = (c: {
  req: { header: (k: string) => string | undefined };
}) => string | null;

export type AdminGateVariables = { adminUsername: string };

/**
 * Oturum yoksa 401, oturum var ama admin değilse 403 döner; admin ise
 * doğrulanmış kullanıcı adını `adminUsername` context değişkenine yazıp
 * `next()`'e geçer (audit-trail actor'ı için — endpoint'ler `c.get(...)`
 * ile okur, client body'sinden ASLA).
 */
export function createAdminGate(
  tokenFromRequest: TokenExtractor,
): MiddlewareHandler<{ Variables: AdminGateVariables }> {
  return async (c, next) => {
    const session = await verifySession(tokenFromRequest(c));
    if (!session) return c.json({ error: "Oturum gerekli" }, 401);
    if (!isAdminUser(session.username)) return c.json({ error: "Yetki yok" }, 403);
    c.set("adminUsername", session.username);
    return next();
  };
}
