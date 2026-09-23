import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createReorderCustomerHandler, type ReorderRouteDeps } from "../reorder-route.js";

/**
 * `admin-gate.test.ts`/`setup-gate.test.ts` ile AYNI gerekçe (bkz. o
 * dosyaların başlık yorumu): `server.ts` import edilince gerçek TCP portu
 * dinlemeye başlar — bu test `reorder-route.ts`'in SAF, bağımlılıkları
 * ENJEKTE EDİLEN handler fabrikasını izole eder, `server.ts`'e HİÇ dokunmaz.
 * Tüm bağımlılıklar `vi.fn()` — gerçek DB/oturum/scope çözümü YOK.
 */
function buildDeps(overrides: Partial<ReorderRouteDeps> = {}): ReorderRouteDeps {
  return {
    scopeFromRequest: vi.fn().mockResolvedValue({ type: "merkez", distKods: null, cities: null }),
    customerInScope: vi.fn().mockReturnValue(true),
    getCustomerReorder: vi.fn().mockResolvedValue({
      musteriKod: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      overdue: [],
      winBack: [],
      crossSell: [],
      ozet: { toplamGecikmis: 0, toplamWinback: 0, toplamCross: 0 },
    }),
    scopeSingleDistId: vi.fn().mockReturnValue(null),
    checkRateLimit: vi.fn().mockReturnValue(true),
    clientIp: vi.fn().mockReturnValue("127.0.0.1"),
    heavyRateLimit: 20,
    rateLimitWindowMs: 60_000,
    ...overrides,
  };
}

function buildTestApp(deps: ReorderRouteDeps) {
  const app = new Hono();
  app.get("/api/reorder/customer", createReorderCustomerHandler(deps));
  return app;
}

describe("createReorderCustomerHandler — /api/reorder/customer (route entegrasyonu)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rate limit aşılmışsa 429 döner, scope/DB'ye HİÇ gidilmez", async () => {
    const deps = buildDeps({ checkRateLimit: vi.fn().mockReturnValue(false) });
    const res = await buildTestApp(deps).request("/api/reorder/customer?musteriKod=1");
    expect(res.status).toBe(429);
    expect(deps.scopeFromRequest).not.toHaveBeenCalled();
  });

  it("oturum yoksa (UNAUTHENTICATED) 401 döner", async () => {
    const deps = buildDeps({
      scopeFromRequest: vi.fn().mockRejectedValue(new Error("UNAUTHENTICATED")),
    });
    const res = await buildTestApp(deps).request("/api/reorder/customer?musteriKod=1");
    expect(res.status).toBe(401);
  });

  it("scope çözümü BEKLENMEYEN bir hatayla patlarsa 500 + jenerik mesaj (ham hata SIZMAZ)", async () => {
    const deps = buildDeps({
      scopeFromRequest: vi.fn().mockRejectedValue(new Error("mssql connection refused")),
    });
    const res = await buildTestApp(deps).request("/api/reorder/customer?musteriKod=1");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string; musteriKod?: number };
    expect(body.error).not.toMatch(/mssql/i);
  });

  it("musteriKod eksik/geçersizse 400 döner", async () => {
    const deps = buildDeps();
    const res = await buildTestApp(deps).request("/api/reorder/customer");
    expect(res.status).toBe(400);
    expect(deps.customerInScope).not.toHaveBeenCalled();
  });

  it("customerInScope false → 403 DÖNER VE audit-log yazılır (kardeş uç deseniyle birebir)", async () => {
    const deps = buildDeps({ customerInScope: vi.fn().mockReturnValue(false) });
    const res = await buildTestApp(deps).request("/api/reorder/customer?musteriKod=777");
    expect(res.status).toBe(403);
    expect(deps.getCustomerReorder).not.toHaveBeenCalled();
    // Audit-log: reddedilen erişim console.warn'a düşer, musteriKod'u içerir.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("777"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("403"));
  });

  it("SUNUCU-OTORİTER scope wiring: getCustomerReorder'a YALNIZ scope.distKods/scopeSingleDistId geçilir — client musteriKod DIŞINDA hiçbir kapsam bilgisi ENJEKTE EDEMEZ", async () => {
    const scope = { type: "dist" as const, distKods: [4, 7], cities: null };
    const deps = buildDeps({
      scopeFromRequest: vi.fn().mockResolvedValue(scope),
      scopeSingleDistId: vi.fn().mockReturnValue(null),
    });
    // Client sözde bir "ekGrupKod"/"distKod" query param'ı gönderse bile
    // (aşağıda `&distKod=999&ekGrupKod=SAHTE`) handler bunları OKUMAZ —
    // yalnız `musteriKod` parse edilir, geri kalan HER ŞEY `scope`'tan gelir.
    const res = await buildTestApp(deps).request(
      "/api/reorder/customer?musteriKod=42&distKod=999&ekGrupKod=SAHTE",
    );
    expect(res.status).toBe(200);
    expect(deps.getCustomerReorder).toHaveBeenCalledWith({
      musteriKod: 42,
      allowedDistKods: scope.distKods,
      distId: null,
    });
  });

  it("başarılı yol: 200 + getCustomerReorder sonucu döner", async () => {
    const deps = buildDeps();
    const res = await buildTestApp(deps).request("/api/reorder/customer?musteriKod=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: string; musteriKod?: number };
    expect(body.musteriKod).toBe(1);
  });

  it("getCustomerReorder patlarsa 500 + jenerik mesaj (ham DB hatası SIZMAZ)", async () => {
    const deps = buildDeps({
      getCustomerReorder: vi.fn().mockRejectedValue(new Error("mssql timeout")),
    });
    const res = await buildTestApp(deps).request("/api/reorder/customer?musteriKod=1");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string; musteriKod?: number };
    expect(body.error).not.toMatch(/mssql/i);
    expect(errorSpy).toHaveBeenCalled();
  });
});
