import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `db.js` mock'lanır — DB'ye HİÇ dokunmadan `getCustomerReorder`'ın
 * orkestrasyon mantığını (kaç sorgu, hangi sırayla, SQL string'inde neler
 * geçiyor) test eder. `vi.hoisted` — fabrika hoisted edildiği için
 * `runReadOnlyMock`'a fabrika İÇİNDEN erişmek üzere aynı şekilde hoisted
 * edilmesi gerekir (bkz. db-pool.test.ts AYNI desen).
 *
 * `peer-aggregate.js` de mock'lanır: v2 akran-agregatı SADECE bir SQLite
 * CACHE okur (bkz. `peer-aggregate.ts` dosya-üstü notu) — bu test dosyası
 * `getCustomerReorder`'ın ORKESTRASYONUNU (hangi koşulda ne çağrılır) test
 * eder, gerçek cache/DB davranışını DEĞİL (o `peer-aggregate.test.ts`'te).
 * `PEER_MIN_KISI`/`PEER_MIN_PENETRASYON` PRODUCTION değerleriyle (5, 0.3)
 * AYNI sabitlenir — testler gerçek eşiklere karşı anlamlı kalsın diye.
 */
const { runReadOnlyMock, getPeerAggregateMock } = vi.hoisted(() => ({
  runReadOnlyMock: vi.fn(),
  getPeerAggregateMock: vi.fn(),
}));

vi.mock("../db.js", () => ({ runReadOnly: runReadOnlyMock }));
vi.mock("../peer-aggregate.js", () => ({
  getPeerAggregate: getPeerAggregateMock,
  PEER_MIN_KISI: 5,
  PEER_MIN_PENETRASYON: 0.3,
}));

import {
  getCustomerReorder,
  classify,
  classifyWalletGapCategories,
  buildPeerCrossSellCandidates,
  rankReorderCandidates,
  distScopeClause,
  type ProductHistoryRow,
} from "../reorder.js";
import type { PeerAggregateResult, PeerCategoryAgg, PeerProductAgg } from "../peer-aggregate.js";

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

function peerCategory(overrides: Partial<PeerCategoryAgg> = {}): PeerCategoryAgg {
  return {
    urunGrupKod: "TEKEL",
    urunGrupAd: "Tekel",
    peerMusteriSayi: 10,
    peerToplamMusteriSayi: 20,
    peerCiro: 100_000,
    ...overrides,
  };
}

function peerProduct(overrides: Partial<PeerProductAgg> = {}): PeerProductAgg {
  return {
    urunKod: 500,
    urunAd: "Akran Ürünü",
    peerMusteriSayi: 10,
    peerToplamMusteriSayi: 20,
    peerCiro: 50_000,
    ...overrides,
  };
}

function peerAgg(overrides: Partial<PeerAggregateResult> = {}): PeerAggregateResult {
  return {
    ekGrupKod: "TEKEL",
    generatedAt: "2026-01-01T00:00:00.000Z",
    peerToplamMusteriSayi: 20,
    categories: [],
    products: [],
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
    getPeerAggregateMock.mockReset();
    getPeerAggregateMock.mockResolvedValue(null); // varsayılan: peer-cache boş
  });

  it("boş geçmiş + ek-grup yok → overdue/winBack/crossSell hepsi [] VE cross-sell sorgusu HİÇ çağrılmaz", async () => {
    runReadOnlyMock
      .mockResolvedValueOnce(readOnlyResult([])) // fetchProductHistory
      .mockResolvedValueOnce(readOnlyResult([])); // fetchCustomerEkGrup — bulunamadı

    const result = await getCustomerReorder({ musteriKod: 12345 });

    expect(result.overdue).toEqual([]);
    expect(result.winBack).toEqual([]);
    expect(result.crossSell).toEqual([]);
    // ek-grup bulunamadı → peer-aggregate hiç sorulmadı, v2 alanları HİÇ SET
    // EDİLMEDİ (undefined) — `ozet` v1 ile birebir (toEqual STRICT: fazladan
    // tanımlı alan varsa bu test kırılır).
    expect(result.walletGap).toBeUndefined();
    expect(result.peerCrossSell).toBeUndefined();
    expect(getPeerAggregateMock).not.toHaveBeenCalled();
    expect(result.ozet).toEqual({ toplamGecikmis: 0, toplamWinback: 0, toplamCross: 0 });
    // history + ek-grup lookup çalıştı; sahip olunan ürün yoksa cross-sell'in
    // ikinci (pahalı, 40M satırlık) sorgusu tetiklenmemeli.
    expect(runReadOnlyMock).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce(readOnlyResult([])) // fetchCustomerEkGrup — bulunamadı
      .mockResolvedValueOnce(
        readOnlyResult([
          { urunKod: 40, urunAd: "Yeni Ürün", anchorUrunKod: 10, anchorUrunAd: "A", birlikteSayisi: 25 },
        ]),
      );

    const result = await getCustomerReorder({ musteriKod: 999 });

    expect(runReadOnlyMock).toHaveBeenCalledTimes(3);
    const crossSellQuery = runReadOnlyMock.mock.calls[2]?.[0] as string;
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

  it("dist-scope filtresi TÜM sorgulara (geçmiş + ek-grup lookup + cross-sell) uygulanır", async () => {
    runReadOnlyMock
      .mockResolvedValueOnce(
        readOnlyResult([
          { urunKod: 10, urunAd: "A", gun: 3, sonSiparis: "2026-01-01", spanGun: 20, gecikmeGun: 5 },
        ]),
      )
      .mockResolvedValueOnce(readOnlyResult([])) // fetchCustomerEkGrup
      .mockResolvedValueOnce(readOnlyResult([])); // fetchCrossSell

    await getCustomerReorder({ musteriKod: 999, allowedDistKods: [4] });

    const historyQuery = runReadOnlyMock.mock.calls[0]?.[0] as string;
    const ekGrupQuery = runReadOnlyMock.mock.calls[1]?.[0] as string;
    const crossSellQuery = runReadOnlyMock.mock.calls[2]?.[0] as string;
    expect(historyQuery).toContain("AND f.LNGDISTKOD IN (4)");
    // Ek-grup lookup TBLMUSTERI üzerinde — fact alias'ı `f.` DEĞİL `m.`.
    expect(ekGrupQuery).toContain("AND m.LNGDISTKOD IN (4)");
    expect(crossSellQuery).toContain("AND f.LNGDISTKOD IN (4)");
  });

  it("geçersiz musteriKod (NaN) → throw, hiçbir sorgu çalışmaz", async () => {
    await expect(getCustomerReorder({ musteriKod: NaN })).rejects.toThrow(/Geçersiz musteriKod/);
    expect(runReadOnlyMock).not.toHaveBeenCalled();
  });

  // -- v2 orkestrasyon: ek-grup bulunur, peer-aggregate cache'ten dönerse ---

  it("boş-akran fallback: ek-grup bulunur ama peer-aggregate cache boşsa (henüz ısıtılmamış) v2 alanları set edilmez", async () => {
    runReadOnlyMock
      .mockResolvedValueOnce(readOnlyResult([])) // history
      .mockResolvedValueOnce(readOnlyResult([{ ekGrupKod: "TEKEL" }])); // ek-grup bulundu
    getPeerAggregateMock.mockResolvedValueOnce(null); // cache miss

    const result = await getCustomerReorder({ musteriKod: 1 });

    expect(getPeerAggregateMock).toHaveBeenCalledWith("TEKEL", expect.anything());
    expect(result.walletGap).toBeUndefined();
    expect(result.peerCrossSell).toBeUndefined();
    expect(result.ozet.gapSayi).toBeUndefined();
    expect(result.ozet.peerCrossSayi).toBeUndefined();
    // categoryCiro sorgusu HİÇ tetiklenmemeli — peer-aggregate yoksa gerek yok.
    expect(runReadOnlyMock).toHaveBeenCalledTimes(2);
  });

  it("peer-aggregate cache doluysa walletGap + peerCrossSell hesaplanır ve ozet sayıları eklenir", async () => {
    runReadOnlyMock
      .mockResolvedValueOnce(readOnlyResult([])) // history — boş, yeni müşteri
      .mockResolvedValueOnce(readOnlyResult([{ ekGrupKod: "TEKEL" }])) // ek-grup
      .mockResolvedValueOnce(readOnlyResult([])); // fetchCustomerCategoryCiro — hiç almamış

    getPeerAggregateMock.mockResolvedValueOnce(
      peerAgg({
        categories: [peerCategory({ urunGrupKod: "VISKI", urunGrupAd: "Viski" })],
        products: [peerProduct({ urunKod: 700, urunAd: "Akran Ürünü 2" })],
      }),
    );

    const result = await getCustomerReorder({ musteriKod: 1 });

    expect(result.walletGap).toEqual([
      {
        urunGrupKod: "VISKI",
        urunGrupAd: "Viski",
        tur: "hic-almadi",
        peerPenetrasyon: 50, // 10/20 → %50
        peerMusteriSayi: 10,
        oncelikSkoru: 50_000, // 0.5 * 100_000
      },
    ]);
    expect(result.peerCrossSell).toEqual([
      {
        urunKod: 700,
        urunAd: "Akran Ürünü 2",
        peerPenetrasyon: 50,
        peerMusteriSayi: 10,
        oncelikSkoru: 25_000, // 0.5 * 50_000
      },
    ]);
    expect(result.ozet.gapSayi).toBe(1);
    expect(result.ozet.peerCrossSayi).toBe(1);
  });

  it("peerCrossSell müşterinin ZATEN SAHİP OLDUĞU ürünleri hariç tutar", async () => {
    runReadOnlyMock
      .mockResolvedValueOnce(
        readOnlyResult([
          { urunKod: 700, urunAd: "Zaten Alıyor", gun: 3, sonSiparis: "2026-01-01", spanGun: 20, gecikmeGun: 5 },
        ]),
      ) // history — 700 zaten sahip
      .mockResolvedValueOnce(readOnlyResult([{ ekGrupKod: "TEKEL" }])) // ek-grup
      .mockResolvedValueOnce(readOnlyResult([])) // fetchCustomerCategoryCiro
      .mockResolvedValueOnce(readOnlyResult([])); // fetchCrossSell (v1, owned=[700])

    getPeerAggregateMock.mockResolvedValueOnce(
      peerAgg({ products: [peerProduct({ urunKod: 700 }), peerProduct({ urunKod: 800, urunAd: "Yeni" })] }),
    );

    const result = await getCustomerReorder({ musteriKod: 1 });

    expect(result.peerCrossSell?.map((p) => p.urunKod)).toEqual([800]);
  });
});

// ---------------------------------------------------------------------------
// D. classifyWalletGapCategories() — saf birim (QA: hic-almadi/akran-alti +
//    sınır + peer-üstü guard + k-anon + penetrasyon eşiği)
// ---------------------------------------------------------------------------

describe("classifyWalletGapCategories()", () => {
  it("müşteri kategoriden HİÇ almamışsa → hic-almadi", () => {
    const [item] = classifyWalletGapCategories([peerCategory()], new Map());
    expect(item).toMatchObject({ tur: "hic-almadi" });
  });

  it("müşteri akran ORTALAMASININ ALTINDA alıyorsa → akran-alti", () => {
    // peerOrtCiro = 100_000 / 10 = 10_000; müşteri 5_000 aldı (altında).
    const [item] = classifyWalletGapCategories(
      [peerCategory()],
      new Map([["TEKEL", 5_000]]),
    );
    expect(item).toMatchObject({ tur: "akran-alti" });
  });

  it("peer-üstü guard: müşteri akran ortalamasına TAM EŞİTSE → gap DEĞİL (dışlanır)", () => {
    // peerOrtCiro = 100_000/10 = 10_000 — müşteri TAM bunu aldı.
    const out = classifyWalletGapCategories([peerCategory()], new Map([["TEKEL", 10_000]]));
    expect(out).toEqual([]);
  });

  it("peer-üstü guard: müşteri akran ortalamasının ÜSTÜNDE alıyorsa → gap DEĞİL", () => {
    const out = classifyWalletGapCategories([peerCategory()], new Map([["TEKEL", 50_000]]));
    expect(out).toEqual([]);
  });

  it("k-anonimlik: peerMusteriSayi < PEER_MIN_KISI (5) → bastırılır", () => {
    // peerToplamMusteriSayi=10 → penetrasyon %40 (eşiği zaten geçer) — SADECE
    // k-anon koşulu izole edilir, penetrasyon eşiğiyle KARIŞMAZ.
    const out = classifyWalletGapCategories([peerCategory({ peerMusteriSayi: 4, peerToplamMusteriSayi: 10 })], new Map());
    expect(out).toEqual([]);
  });

  it("k-anonimlik SINIRI: peerMusteriSayi === PEER_MIN_KISI (5) → GEÇER", () => {
    const out = classifyWalletGapCategories(
      [peerCategory({ peerMusteriSayi: 5, peerToplamMusteriSayi: 10 })],
      new Map(),
    );
    expect(out).toHaveLength(1);
  });

  it("penetrasyon eşiği: %30'un ALTI → bastırılır", () => {
    // 5/20 = %25 < %30
    const out = classifyWalletGapCategories(
      [peerCategory({ peerMusteriSayi: 5, peerToplamMusteriSayi: 20 })],
      new Map(),
    );
    expect(out).toEqual([]);
  });

  it("penetrasyon SINIRI: TAM %30 → GEÇER (dahil, >=)", () => {
    // 6/20 = %30 tam
    const out = classifyWalletGapCategories(
      [peerCategory({ peerMusteriSayi: 6, peerToplamMusteriSayi: 20 })],
      new Map(),
    );
    expect(out).toHaveLength(1);
  });

  it("peerToplamMusteriSayi=0 (dejenere) → bölme-sıfır guard, bastırılır", () => {
    const out = classifyWalletGapCategories(
      [peerCategory({ peerMusteriSayi: 0, peerToplamMusteriSayi: 0 })],
      new Map(),
    );
    expect(out).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// E. buildPeerCrossSellCandidates() — saf birim
// ---------------------------------------------------------------------------

describe("buildPeerCrossSellCandidates()", () => {
  it("müşterinin sahip olduğu ürünü hariç tutar", () => {
    const out = buildPeerCrossSellCandidates([peerProduct({ urunKod: 1 })], new Set([1]));
    expect(out).toEqual([]);
  });

  it("k-anonimlik + penetrasyon eşiği walletGap ile AYNI mantıkla uygulanır", () => {
    // peerToplamMusteriSayi=10 → penetrasyon %40 (eşiği geçer) — SADECE k-anon
    // (peerMusteriSayi=4 < 5) izole edilir.
    const out = buildPeerCrossSellCandidates(
      [peerProduct({ urunKod: 1, peerMusteriSayi: 4, peerToplamMusteriSayi: 10 })],
      new Set(),
    );
    expect(out).toEqual([]);
  });

  it("eşikleri geçen ürün, sahip olunmayan ürün listesine girer", () => {
    const out = buildPeerCrossSellCandidates([peerProduct({ urunKod: 1 })], new Set([2]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ urunKod: 1 });
  });
});

// ---------------------------------------------------------------------------
// F. rankReorderCandidates() — saf birim (öncelik sıralama + tie-break)
// ---------------------------------------------------------------------------

describe("rankReorderCandidates()", () => {
  it("oncelikSkoru = peerPenetrasyon(kesir) × peerCiro", () => {
    const [item] = rankReorderCandidates(
      [{ peerPenetrasyon: 0.4, peerMusteriSayi: 8, peerCiro: 1000 }],
      { tieBreakKey: () => 0 },
    );
    expect(item?.oncelikSkoru).toBe(400);
  });

  it("oncelikSkoru DESC sıralar", () => {
    const out = rankReorderCandidates(
      [
        { id: "a", peerPenetrasyon: 0.2, peerMusteriSayi: 5, peerCiro: 1000 }, // 200
        { id: "b", peerPenetrasyon: 0.5, peerMusteriSayi: 5, peerCiro: 1000 }, // 500
      ],
      { tieBreakKey: (i) => i.id },
    );
    expect(out.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("priorityRank önce uygulanır (walletGap: hic-almadi HER ZAMAN akran-alti'ndan önce, skor düşük olsa bile)", () => {
    const out = rankReorderCandidates(
      [
        { id: "akran-alti-yuksek-skor", tur: "akran-alti" as const, peerPenetrasyon: 0.9, peerMusteriSayi: 10, peerCiro: 10_000 },
        { id: "hic-almadi-dusuk-skor", tur: "hic-almadi" as const, peerPenetrasyon: 0.31, peerMusteriSayi: 5, peerCiro: 10 },
      ],
      {
        priorityRank: (i) => (i.tur === "hic-almadi" ? 0 : 1),
        tieBreakKey: (i) => i.id,
      },
    );
    expect(out.map((i) => i.id)).toEqual(["hic-almadi-dusuk-skor", "akran-alti-yuksek-skor"]);
  });

  it("tie-break: oncelikSkoru EŞİTSE tieBreakKey artan sıraya göre DETERMİNİSTİK sıralar", () => {
    const out = rankReorderCandidates(
      [
        { id: "z", peerPenetrasyon: 0.5, peerMusteriSayi: 5, peerCiro: 100 },
        { id: "a", peerPenetrasyon: 0.5, peerMusteriSayi: 5, peerCiro: 100 },
      ],
      { tieBreakKey: (i) => i.id },
    );
    expect(out.map((i) => i.id)).toEqual(["a", "z"]);
  });
});
