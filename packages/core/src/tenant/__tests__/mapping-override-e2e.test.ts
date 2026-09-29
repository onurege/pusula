import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setMappingOverride, getMappingOverride } from "../mapping-store.js";
import { clearTenantCache, getCustomerBreakdownMeta, getMappingConfig, getTenantConfig } from "../index.js";
import { customerBreakdownJoin } from "../customer-breakdown-sql.js";
import { WIETNAUER_CONFIG } from "../configs/wietnauer.js";

/**
 * GÖREV #2/#3 (QA veto fix): `setMappingOverride()` → `getMappingConfig()` /
 * `getCustomerBreakdownMeta()` uçtan-uca override'ı yansıtıyor mu, VE bir
 * sink'in gerçekten çağırdığı `customerBreakdownJoin()` override'lı tabloyu
 * mu üretiyor — bunu doğrudan `wietnauer` tenant id'siyle (Dalga 2 admin
 * endpoint'inin GERÇEKTE yazacağı dosya yolu) test eder.
 *
 * Güvenlik notu: bu dalga admin endpoint'i henüz YOK (yalnız store
 * altyapısı) — `data/tenant-config.wietnauer.enc.json` bugün prod'da mevcut
 * DEĞİL. Yine de testler defansif: dosya önceden varsa (beklenmedik durum)
 * içeriği yedeklenir ve testler sonunda AYNEN geri yüklenir; yoksa silinir.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const TENANT_ID = "wietnauer";
const OVERRIDE_FILE = path.join(REPO_ROOT, "data", `tenant-config.${TENANT_ID}.enc.json`);

/**
 * FAZ A EK-SAHA GÜNCELLEMESİ (brief madde 3): Wietnauer'ın default
 * `customerBreakdown`'ı bu dalgada tek-hop hardcoded literalden İKİ-HOP'a
 * (`mode: "eksaha-two-hop"`) geçti (bkz. `configs/wietnauer.ts`). Bu dosya
 * BİLEREK `TENANT_ID = "wietnauer"` kullanıyor (dosyanın kendi üst yorumu:
 * Dalga 2 admin endpoint'inin GERÇEKTE yazacağı dosya yolu) — o yüzden
 * `DEFAULT_META` artık elle yazılmış tek-hop literal DEĞİL, doğrudan
 * `WIETNAUER_CONFIG.dimensions.customerBreakdown`'dan (gerçek config,
 * totolojik olmayan bağımsız değer) türetilir. `ALT_META` hâlâ tek-hop bir
 * override adayı (`TBLMUSTERIGRUP` ailesi, `identifier.ts` allowlist'inde) —
 * bu test artık AYRICA iki-hop→tek-hop override GEÇİŞİNİ de kanıtlıyor.
 */
const DEFAULT_META = WIETNAUER_CONFIG.dimensions.customerBreakdown;
const ALT_META = { table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" };

let preExistingBackup: string | null = null;

beforeAll(() => {
  preExistingBackup = fs.existsSync(OVERRIDE_FILE) ? fs.readFileSync(OVERRIDE_FILE, "utf8") : null;
  process.env.TENANT = TENANT_ID;
});

function restoreOverrideFile(): void {
  if (preExistingBackup !== null) {
    fs.writeFileSync(OVERRIDE_FILE, preExistingBackup, { encoding: "utf8", mode: 0o600 });
  } else {
    try {
      fs.unlinkSync(OVERRIDE_FILE);
    } catch {
      /* zaten yok — sorun değil */
    }
  }
  clearTenantCache();
}

afterEach(restoreOverrideFile);
afterAll(restoreOverrideFile);

describe("setMappingOverride → getMappingConfig/getCustomerBreakdownMeta uçtan-uca", () => {
  it("override öncesi Wietnauer baseline'ı artık iki-hop (ek-saha) — sink JOIN'i buna göre üretir", () => {
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).toEqual(DEFAULT_META);
    expect(getCustomerBreakdownMeta().mode).toBe("eksaha-two-hop");

    const join = customerBreakdownJoin(getCustomerBreakdownMeta());
    expect(join).toContain("TBLMUSTERIEKSAHA");
    expect(join).toContain("TBLEKSAHASECENEK");
  });

  it("geçerli alternatif (TBLMUSTERIGRUP ailesi, tek-hop) yazıldıktan sonra override iki-hop default'un yerini alır", async () => {
    clearTenantCache();
    expect(getCustomerBreakdownMeta()).toEqual(DEFAULT_META); // override öncesi baseline (artık iki-hop)

    await setMappingOverride(TENANT_ID, {
      dimensions: { customerBreakdown: ALT_META },
      updatedAt: new Date().toISOString(),
      updatedBy: "vitest-e2e",
    });

    expect(getMappingConfig().dimensions.customerBreakdown).toEqual(ALT_META);
    expect(getCustomerBreakdownMeta()).toEqual(ALT_META);
  });

  it("sink'in çağırdığı customerBreakdownJoin() override'lı tabloyu/kolonu SQL'e yansıtır", async () => {
    await setMappingOverride(TENANT_ID, {
      dimensions: { customerBreakdown: ALT_META },
      updatedAt: new Date().toISOString(),
    });

    // Gerçek sink deseni: `const kirilimMeta = getCustomerBreakdownMeta(); ...
    // customerBreakdownJoin(kirilimMeta)` (bkz. komuta.ts, wietnauer-*.ts).
    const meta = getCustomerBreakdownMeta();
    const join = customerBreakdownJoin(meta);
    expect(join).toBe("LEFT JOIN dbo.TBLMUSTERIGRUP k ON k.TXTKOD = m.TXTGRUPKOD");
    expect(join).not.toContain("TBLMUSTERIGRUPKIRILIM");
  });

  it("override sıfırlandıktan (dosya silindikten) sonra default'a döner", async () => {
    await setMappingOverride(TENANT_ID, {
      dimensions: { customerBreakdown: ALT_META },
      updatedAt: new Date().toISOString(),
    });
    expect(getCustomerBreakdownMeta()).toEqual(ALT_META);

    fs.unlinkSync(OVERRIDE_FILE);
    clearTenantCache();

    expect(getMappingOverride(TENANT_ID)).toBeNull();
    expect(getMappingConfig()).toEqual(getTenantConfig());
    expect(getCustomerBreakdownMeta()).toEqual(DEFAULT_META);
  });
});

describe("bozuk override dosyası — fail-closed default'a düşer (THROW ETMEZ)", () => {
  it("geçersiz JSON içeren dosya getMappingOverride() → null döner", () => {
    fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
    fs.writeFileSync(OVERRIDE_FILE, "{ bu geçerli JSON değil ///", { encoding: "utf8", mode: 0o600 });

    expect(() => getMappingOverride(TENANT_ID)).not.toThrow();
    expect(getMappingOverride(TENANT_ID)).toBeNull();
  });

  it("bozuk dosya varken getMappingConfig()/getCustomerBreakdownMeta() sessizce default'a düşer", () => {
    fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
    fs.writeFileSync(OVERRIDE_FILE, "not json at all", { encoding: "utf8", mode: 0o600 });
    clearTenantCache();

    expect(() => getMappingConfig()).not.toThrow();
    expect(getMappingConfig()).toEqual(getTenantConfig());
    expect(getCustomerBreakdownMeta()).toEqual(DEFAULT_META);
  });
});
