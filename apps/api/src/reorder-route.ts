/**
 * `/api/reorder/customer` route factory — v2 (walletGap/peerCrossSell)
 * `customerInScope` 403 + audit-log ekler (kardeş uç `/api/map/customers/:id/
 * sales` deseniyle BİREBİR, bkz. `server.ts` o uç için yazılan yorum).
 *
 * Ayrı dosyaya çıkarılma sebebi (Metz — test edilebilirlik, `admin-gate.ts`
 * ile AYNI gerekçe): `server.ts` import edildiğinde `serve()` gerçek bir TCP
 * portu dinlemeye başlıyor ve gece cron'unu planlıyor — bu modülü doğrudan
 * import edip route-seviyesinde entegrasyon testi yazmak ağır/yan-etkili
 * olurdu. Bu dosya bağımlılıkları ENJEKTE EDİLEN saf bir handler fabrikası;
 * `server.ts`'in geri kalanına dokunmadan izole test edilebilir (bkz.
 * `__tests__/reorder-route.test.ts`).
 *
 * Cohort (ek-grup) SUNUCUDA türetilir — bu route hiçbir zaman client'tan bir
 * ekGrupKod/cohort parametresi ALMAZ; `getCustomerReorder` çağrısı YALNIZ
 * `musteriKod` + sunucunun çözdüğü `scope` ile yapılır (Faz 0 C2).
 */
import type { Context } from "hono";
import type { ReorderResult, TenantScope } from "@enroute/core";

export type ReorderRouteDeps = {
  scopeFromRequest: (c: Context) => Promise<TenantScope>;
  customerInScope: (musteriKod: number, allowedDistKods: number[] | null | undefined) => boolean;
  getCustomerReorder: (options: {
    musteriKod: number;
    allowedDistKods?: number[] | null;
    distId?: number | null;
  }) => Promise<ReorderResult>;
  scopeSingleDistId: (scope: TenantScope) => number | null;
  checkRateLimit: (bucket: string, ip: string, max: number, windowMs: number) => boolean;
  clientIp: (c: Context) => string;
  heavyRateLimit: number;
  rateLimitWindowMs: number;
};

/**
 * `verifySession`/`resolveTenantScope`/`customerInScope`/`getCustomerReorder`
 * hepsi enjekte edilir (server.ts'teki GERÇEK implementasyonlar) — bu dosya
 * SIFIR yan etkiye sahip, testte hepsi `vi.fn()` ile sahtelenebilir.
 */
export function createReorderCustomerHandler(deps: ReorderRouteDeps) {
  return async (c: Context) => {
    if (!deps.checkRateLimit("heavy", deps.clientIp(c), deps.heavyRateLimit, deps.rateLimitWindowMs)) {
      return c.json({ error: "Çok fazla istek. Lütfen bir dakika sonra tekrar deneyin." }, 429);
    }

    let scope: TenantScope;
    try {
      scope = await deps.scopeFromRequest(c);
    } catch (err) {
      if ((err as Error).message === "UNAUTHENTICATED") return c.json({ error: "Oturum gerekli" }, 401);
      console.error("[/api/reorder/customer] scope resolution failed:", err);
      return c.json({ error: "Yetki kapsamı çözülemedi" }, 500);
    }

    const musteriKodRaw = c.req.query("musteriKod");
    const musteriKod = musteriKodRaw != null ? parseInt(musteriKodRaw, 10) : NaN;
    if (!Number.isFinite(musteriKod)) {
      return c.json({ error: "musteriKod zorunlu" }, 400);
    }

    // Kardeş uç `/api/map/customers/:id/sales`/`:id/foresight` ile BİREBİR
    // desen: dist kullanıcı BAŞKA dist'in müşterisini göremez. Var olmayan
    // musteriKod zaten `customerInScope`'ta `true` döner (mirror'da yok) —
    // asıl veri sorgusu boş sonuç üretir, ayrı bir 404 GEREKMEZ (v1 ile aynı).
    if (!deps.customerInScope(musteriKod, scope.distKods)) {
      // Audit-log: reddedilen kapsam-dışı erişim denemesi — hangi dist
      // scope'unun hangi müşteriye erişmeye çalıştığı (client body'sinden
      // DEĞİL, sunucunun çözdüğü `scope`'tan) log'a düşer.
      console.warn(
        `[audit] /api/reorder/customer 403 — musteriKod=${musteriKod} scope.distKods=${JSON.stringify(
          scope.distKods,
        )}`,
      );
      return c.json({ error: "Bu müşteriye erişim yetkiniz yok" }, 403);
    }

    try {
      const result = await deps.getCustomerReorder({
        musteriKod,
        allowedDistKods: scope.distKods,
        distId: deps.scopeSingleDistId(scope),
      });
      return c.json(result);
    } catch (err) {
      console.error("[/api/reorder/customer] failed:", err);
      return c.json({ error: "Sipariş önerisi hesaplanamadı" }, 500);
    }
  };
}
