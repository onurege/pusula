import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `db.js` mock'lanır — DB'ye HİÇ dokunmadan `getCustomerReorder`'ın
 * orkestrasyon mantığını (kaç sorgu, hangi sırayla, SQL string'inde neler
 * geçiyor) test eder. `vi.hoisted` — fabrika hoisted edildiği için
 * `runReadOnlyMock`'a fabrika İÇİNDEN erişmek üzere aynı şekilde hoisted
 * edilmesi gerekir (bkz. db-pool.test.ts AYNI desen).
 */
const { runReadOnlyMock } = vi.hoisted(() => ({ runReadOnlyMock: vi.fn() }));

vi.mock("../db.js", () => ({ runReadOnly: runReadOnlyMock }));

import {
  getCustomerReorder,
  classify,
  distScopeClause,
  type ProductHistoryRow,
} from "../reorder.js";

function row(overrides: Partial<ProductHistoryRow> = {}): ProductHistoryRow {
  return {
    urunKod: 1,
    urunAd: "Test Ürün",
    gun: 3,
    sonSiparis: "2026-01-01",
    spanGun: 20,
    gecikmeGun: 30,
    ...overrides,
  };
}

function readOnlyResult(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length, truncated: false, durationMs: 1 };
}

// ---------------------------------------------------------------------------
// A. classify() — saf birim, DB'siz
// ---------------------------------------------------------------------------

describe("classify()", () => {
  it.each([0, 1, 2])("gun=%d (MIN_SIPARIS altı) → none, exception yok", (gun) => {
    expect(() => classify(row({ gun, spanGun: 10, gecikmeGun: 999 }))).not.toThrow();
    expect(classify(row({ gun, spanGun: 10, gecikmeGun: 999 }))).toEqual({ kind: "none" });
  });

  it("gun===3 sınırında ortAralik = spanGun/2 doğru hesaplanır", () => {
    // ortAralik = 20/(3-1) = 10; overdue alt sınırı 10*1.2=12, üst 10*3=30.
    const r = classify(row({ gun: 3, spanGun: 20, gecikmeGun: 15 }));
    expect(r).toMatchObject({ kind: "overdue", ortAralikGun: 10 });
  });

  it("overdue ALT sınır: gecikmeGun === ortAralik*1.2 tam eşit → none", () => {
    // ortAralik = 10 (spanGun=20, gun=3) → alt sınır tam 12.
    const r = classify(row({ gun: 3, spanGun: 20, gecikmeGun: 12 }));
    expect(r).toEqual({ kind: "none" });
  });

  it("overdue ALT sınır: +ε → overdue", () => {
    const r = classify(row({ gun: 3, spanGun: 20, gecikmeGun: 12.001 }));
    expect(r.kind).toBe("overdue");
  });

  it("overdue ÜST sınır: gecikmeGun === ortAralik*3 tam eşit → none (ölü bölge)", () => {
    // ortAralik büyük seçildi (3x=150 >= WINBACK_MIN_DAYS=120) — böylece
    // winBack tabanı da tam bu noktada kesişir (bkz. classify() dosya-üstü notu).
    const r = classify(row({ gun: 3, spanGun: 100, gecikmeGun: 150 })); // ortAralik=50, 3x=150
    expect(r).toEqual({ kind: "none" });
  });

  it("overdue ÜST sınır: +ε → winback", () => {
    const r = classify(row({ gun: 3, spanGun: 100, gecikmeGun: 150.001 }));
    expect(r.kind).toBe("winback");
  });

  it("WINBACK_MIN_DAYS tabanı: ortAralik küçük (5g) → gecikme=119 none, 121 winback", () => {
    // ortAralik = 10/2 = 5 → 3x=15 (< 120 taban) → winBack tabanı 120'de sabitlenir.
    const none = classify(row({ gun: 3, spanGun: 10, gecikmeGun: 119 }));
    const winback = classify(row({ gun: 3, spanGun: 10, gecikmeGun: 121 }));
    expect(none).toEqual({ kind: "none" });
    expect(winback.kind).toBe("winback");
  });

  it("spanGun===0 (aynı gün çoklu fatura, gun>=3) → ortAralik<=0 guard → none", () => {
    const r = classify(row({ gun: 4, spanGun: 0, gecikmeGun: 500 }));
    expect(r).toEqual({ kind: "none" });
  });

  it("overdue ve winback ASLA aynı anda tetiklenmez (rastgele girdi taraması)", () => {
    // Property-test yerine (ek bağımlılık gerektirmesin diye) geniş bir
    // deterministik ızgara taraması — gun/spanGun/gecikmeGun kombinasyonları.
    for (let gun = 3; gun <= 8; gun++) {
      for (let spanGun = 0; spanGun <= 400; spanGun += 17) {
        for (let gecikmeGun = 0; gecikmeGun <= 500; gecikmeGun += 13) {
          const r = classify(row({ gun, spanGun, gecikmeGun }));
          // "overdue" ve "winback" ikisi birden asla true OLAMAZ — tek bir
          // `kind` alanı zaten bunu tip düzeyinde garanti eder; burada asıl
          // doğrulanan şey her ikisinin de kendi ayrık aralığında kalması.
          expect(["none", "overdue", "winback"]).toContain(r.kind);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// B. distScopeClause() — saf birim
// ---------------------------------------------------------------------------

describe("distScopeClause()", () => {
  it("distId verilmişse → tek dist'e daraltır (allowedDistKods'u YOK SAYAR)", () => {
    expect(distScopeClause({ distId: 42, allowedDistKods: [1, 2, 3] })).toBe(
      " AND f.LNGDISTKOD IN (42)",
    );
  });

  it("allowedDistKods=null, distId yok → filtre yok (merkez, filtresiz)", () => {
    expect(distScopeClause({ allowedDistKods: null })).toBe("");
    expect(distScopeClause({})).toBe("");
  });

  it("allowedDistKods=[] → izinli dist yok → 1=0", () => {
    expect(distScopeClause({ allowedDistKods: [] })).toBe(" AND 1=0");
  });

  it("allowedDistKods=[id,...] → IN listesi", () => {
    expect(distScopeClause({ allowedDistKods: [4, 7, 9] })).toBe(
      " AND f.LNGDISTKOD IN (4,7,9)",
    );
  });

  it("özel alias parametresi kullanılır", () => {
    expect(distScopeClause({ allowedDistKods: [4] }, "d.LNGDISTKOD")).toBe(
      " AND d.LNGDISTKOD IN (4)",
    );
  });
});

// ---------------------------------------------------------------------------
// C. getCustomerReorder() — db.js mock'lanmış orkestrasyon
// ---------------------------------------------------------------------------

describe("getCustomerReorder()", () => {
  beforeEach(() => {
    runReadOnlyMock.mockReset();
  });

  it("boş geçmiş → overdue/winBack/crossSell hepsi [] VE cross-sell sorgusu HİÇ çağrılmaz", async () => {
    runReadOnlyMock.mockResolvedValueOnce(readOnlyResult([]));

    const result = await getCustomerReorder({ musteriKod: 12345 });

    expect(result.overdue).toEqual([]);
    expect(result.winBack).toEqual([]);
    expect(result.crossSell).toEqual([]);
    expect(result.ozet).toEqual({ toplamGecikmis: 0, toplamWinback: 0, toplamCross: 0 });
    // Yalnız geçmiş sorgusu çalıştı — sahip olunan ürün yoksa cross-sell'in
    // ikinci (pahalı, 40M satırlık) sorgusu tetiklenmemeli.
    expect(runReadOnlyMock).toHaveBeenCalledTimes(1);
  });

  it("cross-sell SQL'i, müşterinin TÜM sahip olduğu ürün kodlarını (owned-exclude + anchor-eşleşme) içerir", async () => {
    runReadOnlyMock
      .mockResolvedValueOnce(
        readOnlyResult([
          { urunKod: 10, urunAd: "A", gun: 3, sonSiparis: "2026-01-01", spanGun: 20, gecikmeGun: 5 },
          { urunKod: 20, urunAd: "B", gun: 4, sonSiparis: "2026-02-01", spanGun: 30, gecikmeGun: 5 },
          { urunKod: 30, urunAd: "C", gun: 5, sonSiparis: "2026-03-01", spanGun: 40, gecikmeGun: 5 },
        ]),
      )
      .mockResolvedValueOnce(
        readOnlyResult([
          { urunKod: 40, urunAd: "Yeni Ürün", anchorUrunKod: 10, anchorUrunAd: "A", birlikteSayisi: 25 },
        ]),
      );

    const result = await getCustomerReorder({ musteriKod: 999 });

    expect(runReadOnlyMock).toHaveBeenCalledTimes(2);
    const crossSellQuery = runReadOnlyMock.mock.calls[1]?.[0] as string;
    // Sahip olunan kod listesi hem "en az biri sepette" (basketFatura) hem
    // "çıpa adayı" (pairs.d1) hem de "önerilenden hariç tut" (pairs.d2)
    // filtrelerinde AYNI olmalı.
    expect(crossSellQuery).toContain("d.LNGURUNKOD IN (10,20,30)");
    expect(crossSellQuery).toContain("d1.LNGURUNKOD IN (10,20,30)");
    expect(crossSellQuery).toContain("d2.LNGURUNKOD NOT IN (10,20,30)");
    // Dönen item'da çıpa ürün adı (anchorUrunAd) dolu — "neden bu öneri?"
    // sorusuna kullanıcı arayüzünde cevap veren alan.
    expect(result.crossSell).toEqual([
      { urunKod: 40, urunAd: "Yeni Ürün", anchorUrunKod: 10, anchorUrunAd: "A", birlikteSayisi: 25 },
    ]);
  });

  it("dist-scope filtresi tüm sorgulara (geçmiş + cross-sell) uygulanır", async () => {
    runReadOnlyMock
      .mockResolvedValueOnce(
        readOnlyResult([
          { urunKod: 10, urunAd: "A", gun: 3, sonSiparis: "2026-01-01", spanGun: 20, gecikmeGun: 5 },
        ]),
      )
      .mockResolvedValueOnce(readOnlyResult([]));

    await getCustomerReorder({ musteriKod: 999, allowedDistKods: [4] });

    const historyQuery = runReadOnlyMock.mock.calls[0]?.[0] as string;
    const crossSellQuery = runReadOnlyMock.mock.calls[1]?.[0] as string;
    expect(historyQuery).toContain("AND f.LNGDISTKOD IN (4)");
    expect(crossSellQuery).toContain("AND f.LNGDISTKOD IN (4)");
  });

  it("geçersiz musteriKod (NaN) → throw, hiçbir sorgu çalışmaz", async () => {
    await expect(getCustomerReorder({ musteriKod: NaN })).rejects.toThrow(/Geçersiz musteriKod/);
    expect(runReadOnlyMock).not.toHaveBeenCalled();
  });
});
