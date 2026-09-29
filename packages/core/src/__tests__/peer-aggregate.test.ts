import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `db.js` mock'lanır (MSSQL'e hiç dokunulmaz). `cache.js` KISMEN mock'lanır:
 * `cachedRead`/`cachedWrite` (disk yan-etkisi, gerçek SQLite dosyası açar)
 * sahtelenir, `makeCacheKey` GERÇEK bırakılır (saf fonksiyon, side-effect yok)
 * — `vi.importActual` ile.
 */
const { runReadOnlyMock, cachedReadMock, cachedWriteMock } = vi.hoisted(() => ({
  runReadOnlyMock: vi.fn(),
  cachedReadMock: vi.fn(),
  cachedWriteMock: vi.fn(),
}));

vi.mock("../db.js", () => ({ runReadOnly: runReadOnlyMock }));
vi.mock("../cache.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../cache.js")>();
  return {
    ...actual,
    cachedRead: cachedReadMock,
    cachedWrite: cachedWriteMock,
  };
});

import {
  getPeerAggregate,
  computePeerAggregateLive,
  warmPeerAggregates,
  listActiveEkGrupKods,
  PEER_MIN_KISI,
} from "../peer-aggregate.js";

function readOnlyResult(rows: Record<string, unknown>[]) {
  return { rows, rowCount: rows.length, truncated: false, durationMs: 1 };
}

// ---------------------------------------------------------------------------
// A. getPeerAggregate() — SICAK YOL, SADECE cache okur (Faz 0 B1 VETO)
// ---------------------------------------------------------------------------

describe("getPeerAggregate() — sıcak yol", () => {
  beforeEach(() => {
    runReadOnlyMock.mockReset();
    cachedReadMock.mockReset();
  });

  it("cache hit → payload'ı döner, MSSQL'e HİÇ dokunmaz", async () => {
    const payload = {
      ekGrupKod: "TEKEL",
      generatedAt: "2026-01-01T00:00:00.000Z",
      peerToplamMusteriSayi: 20,
      categories: [],
      products: [],
    };
    cachedReadMock.mockReturnValue({ payload, generatedAt: "x", durationMs: 1 });

    const result = await getPeerAggregate("TEKEL", { allowedDistKods: null });

    expect(result).toEqual(payload);
    expect(runReadOnlyMock).not.toHaveBeenCalled();
  });

  it("cache miss → null döner, CANLI HESAPLAMA TETİKLENMEZ (10.5sn VETO)", async () => {
    cachedReadMock.mockReturnValue(null);

    const result = await getPeerAggregate("TEKEL", { allowedDistKods: null });

    expect(result).toBeNull();
    expect(runReadOnlyMock).not.toHaveBeenCalled();
  });

  it("boş/whitespace ekGrupKod → null döner, cache'e bile bakılmaz", async () => {
    const result = await getPeerAggregate("   ", {});
    expect(result).toBeNull();
    expect(cachedReadMock).not.toHaveBeenCalled();
  });

  it("cache anahtarı ek-grup + dist-scope'a göre AYRIŞIR (segment-anahtarlı) — aynı ek-grup farklı scope'larda farklı anahtar okur", async () => {
    cachedReadMock.mockReturnValue(null);
    await getPeerAggregate("TEKEL", { allowedDistKods: [1] });
    await getPeerAggregate("TEKEL", { allowedDistKods: [2] });
    const keys = cachedReadMock.mock.calls.map((c) => c[1]);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

// ---------------------------------------------------------------------------
// B. computePeerAggregateLive() — DAVRANIŞSAL dist-scope izolasyonu
//    (string-containment DEĞİL — mock'ta in+out-of-scope akran ver, SONUCU
//    assert et; QA E2 gereksinimi)
// ---------------------------------------------------------------------------

/**
 * Ham akran satış satırları — her satır bir (müşteri, dist, kategori, ürün,
 * ciro) demeti. `mockRunReadOnly` SQL metnini "yürütmez"; onun yerine bu
 * fixture'ı, sorgu metninden PARSE ETTİĞİ dist-scope filtresine göre
 * FİLTRELER ve gerçek SQL'in üreteceği agregatı (COUNT DISTINCT/SUM/HAVING)
 * JS'te simüle ederek döner. Bu, gerçek DB olmadan "scope değişince sonuç
 * gerçekten değişiyor mu" sorusunu BEHAVIORAL olarak kanıtlar.
 */
const FIXTURE: Array<{ cust: number; dist: number; kategori: string; kategoriAd: string; urun: number; urunAd: string; ciro: number }> = [
  // dist=1 (in-scope test senaryosunda) — TEKEL kategorisinde 5 farklı müşteri (k-anon sınırında GEÇER).
  ...[101, 102, 103, 104, 105].map((cust, i) => ({
    cust,
    dist: 1,
    kategori: "TEKEL",
    kategoriAd: "Tekel",
    urun: 900,
    urunAd: "Akran Ürünü",
    ciro: 1000 + i,
  })),
  // dist=2 (out-of-scope test senaryosunda) — 3 farklı müşteri, TEK BAŞINA
  // k-anon eşiğinin (5) ALTINDA kalır (kasıtlı — scope genişleyince hem
  // müşteri sayısı hem k-anon durumu değişsin diye).
  ...[201, 202, 203].map((cust, i) => ({
    cust,
    dist: 2,
    kategori: "TEKEL",
    kategoriAd: "Tekel",
    urun: 900,
    urunAd: "Akran Ürünü",
    ciro: 500 + i,
  })),
];

/** SQL metninden dist-scope'u PARSE eder — `distScopeClause`'un ürettiği
 *  ÜÇ olası biçimi tanır: filtre yok, `1=0`, `IN (...)`. */
function parseAllowedDists(sql: string): number[] | "all" | "none" {
  if (/AND f\.LNGDISTKOD IN \(([\d,]+)\)/.test(sql)) {
    const m = sql.match(/AND f\.LNGDISTKOD IN \(([\d,]+)\)/)!;
    return m[1]!.split(",").map(Number);
  }
  if (sql.includes("AND 1=0")) return "none";
  return "all";
}

function fixtureForScope(sql: string) {
  const allowed = parseAllowedDists(sql);
  if (allowed === "none") return [];
  if (allowed === "all") return FIXTURE;
  return FIXTURE.filter((r) => allowed.includes(r.dist));
}

function mockComputeQueriesFromFixture() {
  runReadOnlyMock.mockImplementation(async (sql: string) => {
    const rows = fixtureForScope(sql);
    if (sql.includes("COUNT(DISTINCT f.LNGMUSTERIKOD) AS n")) {
      const n = new Set(rows.map((r) => r.cust)).size;
      return readOnlyResult([{ n }]);
    }
    if (sql.includes("urunGrupKod")) {
      const byCat = new Map<string, { ad: string; custs: Set<number>; ciro: number }>();
      for (const r of rows) {
        const g = byCat.get(r.kategori) ?? { ad: r.kategoriAd, custs: new Set(), ciro: 0 };
        g.custs.add(r.cust);
        g.ciro += r.ciro;
        byCat.set(r.kategori, g);
      }
      return readOnlyResult(
        [...byCat.entries()]
          .filter(([, g]) => g.custs.size >= PEER_MIN_KISI) // HAVING simülasyonu
          .map(([kod, g]) => ({ urunGrupKod: kod, urunGrupAd: g.ad, peerMusteriSayi: g.custs.size, peerCiro: g.ciro })),
      );
    }
    // ürün agregatı
    const byUrun = new Map<number, { ad: string; custs: Set<number>; ciro: number }>();
    for (const r of rows) {
      const g = byUrun.get(r.urun) ?? { ad: r.urunAd, custs: new Set(), ciro: 0 };
      g.custs.add(r.cust);
      g.ciro += r.ciro;
      byUrun.set(r.urun, g);
    }
    return readOnlyResult(
      [...byUrun.entries()]
        .filter(([, g]) => g.custs.size >= PEER_MIN_KISI)
        .map(([kod, g]) => ({ urunKod: kod, urunAd: g.ad, peerMusteriSayi: g.custs.size, peerCiro: g.ciro })),
    );
  });
}

describe("computePeerAggregateLive() — davranışsal dist-scope izolasyonu", () => {
  beforeEach(() => {
    runReadOnlyMock.mockReset();
    mockComputeQueriesFromFixture();
  });

  it("scope=[1] (yalnız dist 1) → SADECE dist-1 akranları sayılır (dist-2 SIZMAZ)", async () => {
    const result = await computePeerAggregateLive("TEKEL", { allowedDistKods: [1] });

    expect(result.peerToplamMusteriSayi).toBe(5); // yalnız 101..105
    expect(result.categories).toEqual([
      { urunGrupKod: "TEKEL", urunGrupAd: "Tekel", peerMusteriSayi: 5, peerToplamMusteriSayi: 5, peerCiro: 1000 + 1001 + 1002 + 1003 + 1004 },
    ]);
  });

  it("scope=null (merkez, filtresiz) → dist-1 + dist-2 BİRLİKTE sayılır — SONUÇ dist-1-only'den FARKLI", async () => {
    const result = await computePeerAggregateLive("TEKEL", { allowedDistKods: null });

    expect(result.peerToplamMusteriSayi).toBe(8); // 101..105 + 201..203
    expect(result.categories[0]?.peerMusteriSayi).toBe(8);
  });

  it("k-anonimlik: scope=[2] TEK BAŞINA (3 müşteri < PEER_MIN_KISI=5) → kategori/ürün TAMAMEN bastırılır", async () => {
    const result = await computePeerAggregateLive("TEKEL", { allowedDistKods: [2] });

    expect(result.peerToplamMusteriSayi).toBe(3); // toplam sayaç k-anon'a tabi DEĞİL
    expect(result.categories).toEqual([]); // ama kategori/ürün satırı YOK (HAVING < 5)
    expect(result.products).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C. warmPeerAggregates() — SOĞUK YOL (gece batch / demo bake)
// ---------------------------------------------------------------------------

describe("warmPeerAggregates()", () => {
  beforeEach(() => {
    runReadOnlyMock.mockReset();
    cachedWriteMock.mockReset();
  });

  it("her ek-grup için hesaplayıp cache'e YAZAR; bir tanesi hata verirse DİĞERLERİNİ engellemez", async () => {
    // "BOZUK" ek-grubunun İLK sorgusu (fetchPeerTotalCustomers) reddedilir —
    // computePeerAggregateLive bunu `await`ladığı (sıralı) için ek-grup
    // başına İLK çağrı her zaman total-customers sorgusudur.
    let call = 0;
    runReadOnlyMock.mockImplementation(async () => {
      call += 1;
      if (call <= 1) throw new Error("mssql timeout");
      return readOnlyResult([]);
    });

    const { ok, failed } = await warmPeerAggregates(["BOZUK", "TEKEL"], { allowedDistKods: null });

    expect(failed.map((f) => f.ekGrupKod)).toEqual(["BOZUK"]);
    expect(ok).toEqual(["TEKEL"]);
    // Yalnız başarılı ek-grup için cache yazılır.
    expect(cachedWriteMock).toHaveBeenCalledTimes(1);
    expect(cachedWriteMock.mock.calls[0]?.[1]).toContain("TEKEL");
  });
});

// ---------------------------------------------------------------------------
// D. listActiveEkGrupKods()
// ---------------------------------------------------------------------------

describe("listActiveEkGrupKods()", () => {
  it("boş/whitespace kodları filtreler, geri kalanı trim'lenmiş döner", async () => {
    runReadOnlyMock.mockReset();
    runReadOnlyMock.mockResolvedValueOnce(
      readOnlyResult([{ kod: "TEKEL" }, { kod: "  MARKET " }, { kod: "" }, { kod: null }]),
    );
    const kods = await listActiveEkGrupKods();
    expect(kods).toEqual(["TEKEL", "MARKET"]);
  });
});
