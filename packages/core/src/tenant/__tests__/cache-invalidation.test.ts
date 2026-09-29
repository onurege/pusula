import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * GÖREV #4 (QA veto fix): `invalidateCustomerBreakdownCaches()` — müşteri
 * kırılımı boyutunu okuyan 5 domain'in HEPSİ için `cachedClear` çağrıldığını
 * doğrular (Faz 0 B1: mapping override sonrası bayat veri kalmasın).
 *
 * `../cache.js` mock'lanır — gerçek SQLite mirror'a dokunulmaz.
 */
vi.mock("../../cache.js", () => ({
  cachedClear: vi.fn(),
}));

import { cachedClear } from "../../cache.js";
import {
  CUSTOMER_BREAKDOWN_CACHE_DOMAINS,
  invalidateCustomerBreakdownCaches,
  PRODUCT_BREAKDOWN_CACHE_DOMAINS,
  invalidateProductBreakdownCaches,
  REGION_BREAKDOWN_CACHE_DOMAINS,
  invalidateRegionBreakdownCaches,
} from "../cache-invalidation.js";

describe("invalidateCustomerBreakdownCaches", () => {
  beforeEach(() => {
    vi.mocked(cachedClear).mockClear();
  });

  it("tam olarak 5 domain için cachedClear çağırır", () => {
    invalidateCustomerBreakdownCaches();
    expect(cachedClear).toHaveBeenCalledTimes(5);
  });

  it("CUSTOMER_BREAKDOWN_CACHE_DOMAINS listesindeki HER domain'i (komuta + 4 wietnauer) çağırır", () => {
    invalidateCustomerBreakdownCaches();
    const calledDomains = vi.mocked(cachedClear).mock.calls.map((call) => call[0]);
    expect(calledDomains).toEqual([...CUSTOMER_BREAKDOWN_CACHE_DOMAINS]);
    expect(calledDomains).toEqual([
      "komuta",
      "wietnauer-saha",
      "wietnauer-iskonto",
      "wietnauer-aktivasyon",
      "wietnauer-segment",
    ]);
  });

  it("her çağrı tek argümanla (domain, key YOK) yapılır — tüm domain cache'i temizlenir", () => {
    invalidateCustomerBreakdownCaches();
    for (const call of vi.mocked(cachedClear).mock.calls) {
      expect(call).toHaveLength(1);
    }
  });
});

describe("invalidateProductBreakdownCaches (Faz B)", () => {
  beforeEach(() => {
    vi.mocked(cachedClear).mockClear();
  });

  it("tam olarak 7 domain için cachedClear çağırır (komuta + 6 wietnauer-*)", () => {
    invalidateProductBreakdownCaches();
    expect(cachedClear).toHaveBeenCalledTimes(7);
  });

  it("PRODUCT_BREAKDOWN_CACHE_DOMAINS listesindeki HER domain'i çağırır (wietnauer-metrics'in kendi CACHE_DOMAIN'i 'wietnauer' olduğu için o değerle)", () => {
    invalidateProductBreakdownCaches();
    const calledDomains = vi.mocked(cachedClear).mock.calls.map((call) => call[0]);
    expect(calledDomains).toEqual([...PRODUCT_BREAKDOWN_CACHE_DOMAINS]);
    expect(calledDomains).toEqual([
      "komuta",
      "wietnauer-marka",
      "wietnauer-segment",
      "wietnauer-aktivasyon",
      "wietnauer-stok",
      "wietnauer",
      "wietnauer-iskonto",
    ]);
  });
});

describe("invalidateRegionBreakdownCaches (Faz B)", () => {
  beforeEach(() => {
    vi.mocked(cachedClear).mockClear();
  });

  it("tam olarak 3 domain için cachedClear çağırır (komuta + wietnauer-saha + wietnauer-stok)", () => {
    invalidateRegionBreakdownCaches();
    expect(cachedClear).toHaveBeenCalledTimes(3);
  });

  it("REGION_BREAKDOWN_CACHE_DOMAINS listesindeki HER domain'i çağırır", () => {
    invalidateRegionBreakdownCaches();
    const calledDomains = vi.mocked(cachedClear).mock.calls.map((call) => call[0]);
    expect(calledDomains).toEqual([...REGION_BREAKDOWN_CACHE_DOMAINS]);
    expect(calledDomains).toEqual(["komuta", "wietnauer-saha", "wietnauer-stok"]);
  });
});
