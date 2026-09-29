import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { recordConfigAudit, readAuditLog } from "../audit-log.js";
import { repoRoot } from "../mapping-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname; // yalnız repoRoot() ile tutarlılık için — path'in kendisi repoRoot()'tan gelir.
const AUDIT_FILE = path.join(repoRoot(), "data", "config-audit.log");

let preExistingBackup: string | null = null;

beforeAll(() => {
  preExistingBackup = fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE, "utf8") : null;
});

function restore(): void {
  if (preExistingBackup !== null) {
    fs.writeFileSync(AUDIT_FILE, preExistingBackup, { encoding: "utf8", mode: 0o600 });
  } else {
    try {
      fs.unlinkSync(AUDIT_FILE);
    } catch {
      /* zaten yok */
    }
  }
}

afterEach(restore);
afterAll(restore);

describe("recordConfigAudit / readAuditLog", () => {
  it("yazılan kayıt append-only dosyadan okunabilir (ts otomatik eklenir)", async () => {
    await recordConfigAudit({
      tenantId: "vitest-audit",
      actor: "admin1",
      action: "save",
      field: "dimensions.customerBreakdown",
      oldValue: { table: "A" },
      newValue: { table: "B" },
    });
    const entries = readAuditLog("vitest-audit");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tenantId: "vitest-audit",
      actor: "admin1",
      action: "save",
      field: "dimensions.customerBreakdown",
    });
    expect(typeof entries[0]!.ts).toBe("string");
  });

  it("en yeni kayıt EN BAŞTA döner (reverse-chronological)", async () => {
    await recordConfigAudit({ tenantId: "vitest-audit", actor: "a", action: "save", field: "x" });
    await recordConfigAudit({ tenantId: "vitest-audit", actor: "b", action: "reset", field: "x" });
    const entries = readAuditLog("vitest-audit");
    expect(entries[0]!.actor).toBe("b");
    expect(entries[1]!.actor).toBe("a");
  });

  it("dosya yoksa boş dizi döner (throw etmez)", () => {
    try {
      fs.unlinkSync(AUDIT_FILE);
    } catch {
      /* zaten yok */
    }
    expect(readAuditLog()).toEqual([]);
  });

  it("tenantId filtresi yalnız o tenant'ın kayıtlarını döner", async () => {
    await recordConfigAudit({ tenantId: "tenant-a", actor: "x", action: "save", field: "f" });
    await recordConfigAudit({ tenantId: "tenant-b", actor: "y", action: "save", field: "f" });
    expect(readAuditLog("tenant-a")).toHaveLength(1);
    expect(readAuditLog("tenant-a")[0]!.tenantId).toBe("tenant-a");
  });
});
