import { describe, expect, it } from "vitest";
import {
  customerBreakdownCodeExpr,
  customerBreakdownFacetSql,
  customerBreakdownFilterClause,
  customerBreakdownJoin,
  customerBreakdownLabelExpr,
} from "../customer-breakdown-sql.js";
import { WIETNAUER_CONFIG } from "../configs/wietnauer.js";

/**
 * QA VETO FIX (Faz A Dalga 1): eski `customer-breakdown-defaults.test.ts`
 * "SQL fragment smoke test"i totolojikti — `EXPECTED_DEFAULT` sabitinden iki
 * string türetip birbirine eşitliyordu, `komuta.ts`/`wietnauer-*.ts`'teki
 * GERÇEK sink kodunu hiç ÇAĞIRMIYORDU (0/8 gerçek kapsam).
 *
 * Bu dosyadaki fonksiyonlar (`customerBreakdownJoin` vb.,
 * `tenant/customer-breakdown-sql.ts`) artık sink'lerin KENDİLERİNİN
 * çağırdığı üreticiler — paralel bir kopya değil. Doğrulama: her sink
 * dosyasında `git grep` ile aranabilir çağrı noktası (bkz. aşağıdaki yorum
 * satırları, dosya/satır referansı Dalga 1-fix diff'i ile eşleşir):
 *
 *   1. komuta.ts:860        fetchChannelByCustomerType  → customerBreakdownJoin + LabelExpr("kanal")
 *   2. komuta.ts:~1699      fetchCustomerTypeBrand      → customerBreakdownJoin + LabelExpr("tip")
 *   3. komuta.ts:~2079      getKomutaFacets             → customerBreakdownFacetSql
 *   4. komuta.ts:~2176      getKomutaSnapshot (kanal)   → customerBreakdownFilterClause
 *   5. wietnauer-aktivasyon.ts fetchActiveCustomers90dRaw → Join + LabelExpr("segment")
 *   6. wietnauer-iskonto.ts fetchDiscountBySegmentRaw     → Join + LabelExpr("segment")
 *   7. wietnauer-saha.ts fetchCoverage                    → Join + LabelExpr("segment")
 *   8. wietnauer-segment.ts fetchMusteriGrupSegmentRaw     → Join + LabelExpr("tip_ad") + CodeExpr("tip_kod")
 *
 * Baseline literal'ler `git show HEAD:packages/core/src/komuta.ts` (Dalga 1
 * ÖNCESİ hardcoded hâl) ve eşdeğer wietnauer-*.ts dosyalarından alınmıştır —
 * bu testler o literal'lerle KARAKTER BAZINDA eşleşmeyi doğrular (davranış
 * sıfır regresyon).
 */
const DEFAULT_META = WIETNAUER_CONFIG.dimensions.customerBreakdown; // { table: TBLMUSTERIGRUPKIRILIM, joinColumn: TXTGRUPKIRILIMKOD, labelColumn: TXTAD }

describe("customerBreakdownJoin — 6 sink'in ortak JOIN fragment'ı", () => {
  it("default config ile refactor-öncesi hardcoded JOIN ile birebir eşleşir", () => {
    expect(customerBreakdownJoin(DEFAULT_META)).toBe(
      "LEFT JOIN dbo.TBLMUSTERIGRUPKIRILIM k ON k.TXTKOD = m.TXTGRUPKIRILIMKOD",
    );
  });

  it("override'lı (TBLMUSTERIGRUP ailesi) meta ile de doğru tablo/kolonu üretir", () => {
    expect(
      customerBreakdownJoin({ table: "TBLMUSTERIGRUP", joinColumn: "TXTGRUPKOD", labelColumn: "TXTAD" }),
    ).toBe("LEFT JOIN dbo.TBLMUSTERIGRUP k ON k.TXTKOD = m.TXTGRUPKOD");
  });
});

describe("customerBreakdownLabelExpr — komuta.ts + wietnauer-*.ts label ifadesi", () => {
  it("komuta.ts fetchChannelByCustomerType (`AS kanal`) ile birebir eşleşir", () => {
    expect(customerBreakdownLabelExpr(DEFAULT_META, "kanal")).toBe(
      "ISNULL(NULLIF(LTRIM(RTRIM(k.TXTAD)), ''), '(Tanımsız)') AS kanal",
    );
  });

  it("komuta.ts fetchCustomerTypeBrand (`AS tip`) ile birebir eşleşir", () => {
    expect(customerBreakdownLabelExpr(DEFAULT_META, "tip")).toBe(
      "ISNULL(NULLIF(LTRIM(RTRIM(k.TXTAD)), ''), '(Tanımsız)') AS tip",
    );
  });

  it("wietnauer-{aktivasyon,iskonto,saha}.ts (`AS segment`) ile birebir eşleşir", () => {
    expect(customerBreakdownLabelExpr(DEFAULT_META, "segment")).toBe(
      "ISNULL(NULLIF(LTRIM(RTRIM(k.TXTAD)), ''), '(Tanımsız)') AS segment",
    );
  });

  it("wietnauer-segment.ts fetchMusteriGrupSegmentRaw (`AS tip_ad`) ile birebir eşleşir", () => {
    expect(customerBreakdownLabelExpr(DEFAULT_META, "tip_ad")).toBe(
      "ISNULL(NULLIF(LTRIM(RTRIM(k.TXTAD)), ''), '(Tanımsız)') AS tip_ad",
    );
  });
});

describe("customerBreakdownCodeExpr — yalnız wietnauer-segment.ts tip_kod", () => {
  it("fallback '0' (metin değil) ile refactor-öncesi hardcoded ifadeyle birebir eşleşir", () => {
    expect(customerBreakdownCodeExpr(DEFAULT_META, "tip_kod")).toBe(
      "ISNULL(NULLIF(LTRIM(RTRIM(m.TXTGRUPKIRILIMKOD)), ''), '0') AS tip_kod",
    );
  });
});

describe("customerBreakdownFacetSql — komuta.ts getKomutaFacets kırılım dropdown sorgusu", () => {
  it("refactor-öncesi hardcoded facet SQL ile birebir (whitespace dahil) eşleşir", () => {
    const expected =
      `SELECT LTRIM(RTRIM(k.TXTKOD)) kod, MAX(k.TXTAD) ad, COUNT(DISTINCT m.LNGKOD) n\n` +
      `           FROM dbo.TBLMUSTERIGRUPKIRILIM k\n` +
      `           INNER JOIN dbo.TBLMUSTERI m ON LTRIM(RTRIM(m.TXTGRUPKIRILIMKOD)) = LTRIM(RTRIM(k.TXTKOD)) AND m.BYTDURUM = 0\n` +
      `           WHERE k.TXTAD IS NOT NULL AND LTRIM(RTRIM(k.TXTKOD)) <> ''\n` +
      `           GROUP BY LTRIM(RTRIM(k.TXTKOD)) HAVING COUNT(DISTINCT m.LNGKOD) >= 5\n` +
      `           ORDER BY COUNT(DISTINCT m.LNGKOD) DESC`;
    expect(customerBreakdownFacetSql(DEFAULT_META)).toBe(expected);
  });
});

describe("customerBreakdownFilterClause — komuta.ts getKomutaSnapshot md2 Kanal filtresi", () => {
  it("refactor-öncesi hardcoded WHERE fragment ile birebir eşleşir (değer önceden escSql'lenmiş varsayılır)", () => {
    expect(customerBreakdownFilterClause(DEFAULT_META, "PRESTIGE")).toBe(
      " AND f.LNGMUSTERIKOD IN (SELECT LNGKOD FROM dbo.TBLMUSTERI WHERE BYTDURUM = 0 AND LTRIM(RTRIM(TXTGRUPKIRILIMKOD)) = N'PRESTIGE')",
    );
  });

  it("boş kanal filtresi çağrılmaz (sink `kanal ? clause : \"\"` deseniyle korur) — burada yalnız üretici test edilir", () => {
    // customerBreakdownFilterClause her zaman değer alır; "filtre yok" dalı
    // sink'te (`komuta.ts` `kanalClause`) zaten `""` — bu fonksiyon çağrılmaz.
    expect(customerBreakdownFilterClause(DEFAULT_META, "")).toContain("N''");
  });
});
