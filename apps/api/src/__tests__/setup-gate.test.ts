import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@enroute/core` mock'lanır — `admin-gate.test.ts` ile AYNI desen (bkz. o
 * dosyanın başlık yorumu): `server.ts`'i (gerçek TCP portu dinleyen, ağır
 * modül) DEĞİL, `setup-gate.ts`'in izole middleware fabrikasını test eder.
 */
vi.mock("@enroute/core", () => ({
  isSetupModeActive: vi.fn(),
  verifySetupToken: vi.fn(),
  SETUP_TOKEN_HEADER: "x-setup-token",
}));

import { Hono } from "hono";
import { isSetupModeActive, verifySetupToken } from "@enroute/core";
import { createSetupGate } from "../setup-gate.js";

function buildTestApp() {
  const app = new Hono();
  app.use("/api/setup/*", createSetupGate());
  app.post("/api/setup/tenant", (c) => c.json({ ok: true }));
  return app;
}

describe("createSetupGate — /api/setup/* dar kapı (Faz 0 Bootstrap sözleşmesi, H-1 fail-closed)", () => {
  beforeEach(() => {
    vi.mocked(isSetupModeActive).mockReset();
    vi.mocked(verifySetupToken).mockReset();
  });

  it("setup modu aktif DEĞİLSE 404 döner (401 DEĞİL — varlığı bile ifşa etmez), verifySetupToken hiç çağrılmaz", async () => {
    vi.mocked(isSetupModeActive).mockReturnValue(false);
    const res = await buildTestApp().request("/api/setup/tenant", {
      method: "POST",
      headers: { "x-setup-token": "herhangi-bir-deger" },
    });
    expect(res.status).toBe(404);
    expect(verifySetupToken).not.toHaveBeenCalled();
  });

  it("setup modu aktifken token eksikse 401 döner", async () => {
    vi.mocked(isSetupModeActive).mockReturnValue(true);
    vi.mocked(verifySetupToken).mockReturnValue(false);
    const res = await buildTestApp().request("/api/setup/tenant", { method: "POST" });
    expect(res.status).toBe(401);
    expect(verifySetupToken).toHaveBeenCalledWith(undefined);
  });

  it("setup modu aktifken token YANLIŞSA 401 döner", async () => {
    vi.mocked(isSetupModeActive).mockReturnValue(true);
    vi.mocked(verifySetupToken).mockReturnValue(false);
    const res = await buildTestApp().request("/api/setup/tenant", {
      method: "POST",
      headers: { "x-setup-token": "yanlis-token" },
    });
    expect(res.status).toBe(401);
  });

  it("setup modu aktif VE token DOĞRUYSA route handler'a ulaşır (200)", async () => {
    vi.mocked(isSetupModeActive).mockReturnValue(true);
    vi.mocked(verifySetupToken).mockReturnValue(true);
    const res = await buildTestApp().request("/api/setup/tenant", {
      method: "POST",
      headers: { "x-setup-token": "dogru-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(verifySetupToken).toHaveBeenCalledWith("dogru-token");
  });

  it("her istekte CANLI kontrol eder — art arda iki farklı sonuç (in-memory bayrak yok)", async () => {
    const app = buildTestApp();
    vi.mocked(isSetupModeActive).mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(verifySetupToken).mockReturnValue(true);

    const first = await app.request("/api/setup/tenant", {
      method: "POST",
      headers: { "x-setup-token": "dogru-token" },
    });
    expect(first.status).toBe(200);

    const second = await app.request("/api/setup/tenant", {
      method: "POST",
      headers: { "x-setup-token": "dogru-token" },
    });
    expect(second.status).toBe(404); // tenant tamamlandı — sonraki istek otomatik kapandı
  });
});
