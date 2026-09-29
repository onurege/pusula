import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../audit-log.js", () => ({ recordConfigAudit: vi.fn().mockResolvedValue(undefined) }));

import { recordConfigAudit } from "../audit-log.js";
import { getMappingOverride } from "../mapping-store.js";
import {
  getDbConnectionMeta,
  saveDbConnectionOverride,
  testDbConnection,
  type ConnectFn,
} from "../db-connection-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const TENANT_ID = "vitest-db-connection-fixture";
const OVERRIDE_FILE = path.join(REPO_ROOT, "data", `tenant-config.${TENANT_ID}.enc.json`);

function cleanup(): void {
  try {
    fs.unlinkSync(OVERRIDE_FILE);
  } catch {
    /* zaten yok */
  }
}

beforeAll(() => {
  process.env.CONFIG_ENC_KEY = "0".repeat(64); // 32 bayt hex — yalnız test anahtarı
});
beforeEach(() => vi.mocked(recordConfigAudit).mockClear());
afterEach(cleanup);
afterAll(cleanup);

describe("testDbConnection — (e) ham hata ASLA sızmaz, yalnız sanitize sonuç", () => {
  it("bağlantı başarılıysa {ok:true} döner", async () => {
    const connectFn: ConnectFn = async () => undefined;
    const result = await testDbConnection(connectFn, {
      server: "10.0.0.5",
      database: "UNIVERA",
      user: "sa",
      password: "gizli",
    });
    expect(result).toEqual({ ok: true });
  });

  it("bağlantı REDDEDİLİRSE yalnız {ok:false} döner — ham mssql hata mesajı sonuçta YER ALMAZ", async () => {
    const connectFn: ConnectFn = async () => {
      throw new Error(
        "Failed to connect to 10.0.0.5:1433 - Could not connect (sequence)... internal-hostname-leak",
      );
    };
    const result = await testDbConnection(connectFn, {
      server: "10.0.0.5",
      database: "UNIVERA",
      user: "sa",
      password: "yanlış",
    });
    expect(result).toEqual({ ok: false });
    // Sonuç objesinde `error`/`message`/`stack` gibi başka HİÇBİR alan yok —
    // Security H2: çağıran tarafın yanlışlıkla ham hatayı forward etmesi
    // için bile bir yüzey bırakılmaz.
    expect(Object.keys(result)).toEqual(["ok"]);
  });
});

describe("getDbConnectionMeta — (f) GET parolayı asla döndürmez", () => {
  it("override yokken hepsi null/false döner", () => {
    expect(getDbConnectionMeta(TENANT_ID)).toEqual({
      server: null,
      database: null,
      user: null,
      hasPassword: false,
    });
  });

  it("kayıtlı override'da server/database/user görünür AMA password alanı hiç YOK", async () => {
    await saveDbConnectionOverride({
      tenantId: TENANT_ID,
      actor: "test-admin",
      input: { server: "10.0.0.5", database: "UNIVERA", user: "sa", password: "cok-gizli-parola" },
    });

    const meta = getDbConnectionMeta(TENANT_ID);
    expect(meta).toEqual({ server: "10.0.0.5", database: "UNIVERA", user: "sa", hasPassword: true });
    expect(Object.keys(meta)).not.toContain("password");
    expect(JSON.stringify(meta)).not.toContain("cok-gizli-parola");

    // Diskteki ham dosyada bile düz metin parola YOK (yalnız AES-GCM alanları).
    const raw = fs.readFileSync(OVERRIDE_FILE, "utf8");
    expect(raw).not.toContain("cok-gizli-parola");
  });

  it("saveDbConnectionOverride audit'e maskeli değer yazar — parola '***'", async () => {
    await saveDbConnectionOverride({
      tenantId: TENANT_ID,
      actor: "test-admin",
      input: { server: "10.0.0.5", database: "UNIVERA", user: "sa", password: "cok-gizli-parola" },
    });
    expect(recordConfigAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "dbCredentials",
        newValue: expect.objectContaining({ password: "***" }),
      }),
    );
    const call = vi.mocked(recordConfigAudit).mock.calls[0]![0];
    expect(JSON.stringify(call)).not.toContain("cok-gizli-parola");
  });

  it("kaydetme mevcut dimensions.customerBreakdown override'ını KORUR", async () => {
    const { setMappingOverride } = await import("../mapping-store.js");
    await setMappingOverride(TENANT_ID, {
      dimensions: {
        customerBreakdown: { table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" },
      },
      updatedAt: new Date().toISOString(),
    });

    await saveDbConnectionOverride({
      tenantId: TENANT_ID,
      actor: "test-admin",
      input: { server: "10.0.0.5", database: "UNIVERA", user: "sa", password: "parola" },
    });

    const override = getMappingOverride(TENANT_ID);
    expect(override?.dimensions?.customerBreakdown).toEqual({
      table: "TBLMUSTERIGRUP",
      joinColumn: "TXTGRUPKOD",
      labelColumn: "TXTAD",
    });
    expect(override?.dbCredentials?.server).toBe("10.0.0.5");
  });
});
