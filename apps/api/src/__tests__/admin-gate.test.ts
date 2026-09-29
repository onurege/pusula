import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `@enroute/core` mock'lanır — bu test `server.ts`'i (gerçek TCP portu
 * dinleyen, gece cron'u planlayan ağır modül) DEĞİL, `admin-gate.ts`'in
 * (server.ts'in GERÇEKTEN kullandığı) izole middleware fabrikasını test
 * eder. Bkz. `admin-gate.ts` dosya başı yorumu — bu ayrıştırmanın nedeni.
 */
vi.mock("@enroute/core", () => ({
  verifySession: vi.fn(),
  isAdminUser: vi.fn(),
}));

import { Hono } from "hono";
import { isAdminUser, verifySession } from "@enroute/core";
import { createAdminGate, type AdminGateVariables } from "../admin-gate.js";

function buildTestApp() {
  const app = new Hono<{ Variables: AdminGateVariables }>();
  app.use("/api/admin/*", createAdminGate(() => "dummy-token"));
  app.get("/api/admin/ping", (c) => c.json({ ok: true, actor: c.get("adminUsername") }));
  return app;
}

describe("createAdminGate — /api/admin/* merkezi gate (Security H3)", () => {
  beforeEach(() => {
    vi.mocked(verifySession).mockReset();
    vi.mocked(isAdminUser).mockReset();
  });

  it("oturum yoksa 401 döner (admin-olmayan/anonim istek)", async () => {
    vi.mocked(verifySession).mockResolvedValue(null);
    const res = await buildTestApp().request("/api/admin/ping");
    expect(res.status).toBe(401);
    expect(isAdminUser).not.toHaveBeenCalled(); // oturum yoksa rol kontrolüne bile gidilmez
  });

  it("oturum var ama admin DEĞİLSE 403 döner", async () => {
    vi.mocked(verifySession).mockResolvedValue({
      userId: 1,
      username: "sahatemsilcisi1",
      displayName: "Saha 1",
      role: "merkez",
      allowedDistKods: [],
    });
    vi.mocked(isAdminUser).mockReturnValue(false);
    const res = await buildTestApp().request("/api/admin/ping");
    expect(res.status).toBe(403);
  });

  it("admin ise 200 döner ve adminUsername context'e yazılır (audit actor kaynağı)", async () => {
    vi.mocked(verifySession).mockResolvedValue({
      userId: 2,
      username: "admin.kullanici",
      displayName: "Admin",
      role: "merkez",
      allowedDistKods: [],
    });
    vi.mocked(isAdminUser).mockReturnValue(true);
    const res = await buildTestApp().request("/api/admin/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, actor: "admin.kullanici" });
  });
});
