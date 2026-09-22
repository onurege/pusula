/**
 * Müşteri kırılımı SQL fragment üreticileri — komuta.ts /
 * wietnauer-{aktivasyon,iskonto,saha,segment}.ts sink'lerindeki INLINE
 * template literal'ların (JOIN + label/kod ifadesi) TEK ortak yerde
 * toplanmış hâli.
 *
 * Neden bu modül var (Faz A Dalga 1 QA vetosu): önceki smoke test aynı
 * `EXPECTED_DEFAULT` sabitinden iki string türetip birbirine eşitliyordu —
 * gerçek sink kodunu (komuta.ts/wietnauer-*.ts) hiç ÇAĞIRMIYORDU (0/8 gerçek
 * kapsam). Bu fonksiyonlar sink'lerin GERÇEKTEN çağırdığı üretici olduğu
 * için testler artık üretim kod yolunu tetikler — paralel bir kopya değil.
 *
 * DAVRANIŞ KORUNUR: her fonksiyonun ürettiği metin, refactor ÖNCESİ (Faz A
 * öncesi) hardcoded `TBLMUSTERIGRUPKIRILIM`/`TXTGRUPKIRILIMKOD`/`TXTAD`
 * literal'iyle KARAKTER BAZINDA aynıdır (bkz.
 * `tenant/__tests__/customer-breakdown-sql.test.ts`, baseline `git show
 * HEAD:packages/core/src/komuta.ts` referans alınarak alınmıştır).
 */
import type { CustomerBreakdownMeta } from "./identifier";

/**
 * `ISNULL(NULLIF(LTRIM(RTRIM(<qualifiedColumn>)), ''), <fallbackLiteral>)` —
 * Univera sink'lerinde tekrarlanan boş-string/NULL normalize deseni.
 */
function trimOrFallback(qualifiedColumn: string, fallbackLiteral: string): string {
  return `ISNULL(NULLIF(LTRIM(RTRIM(${qualifiedColumn})), ''), ${fallbackLiteral})`;
}

/**
 * Müşteri kırılımı lookup JOIN'i — `TBLMUSTERI m` üzerinden kırılım
 * tablosuna (`k`) bağlanır. komuta.ts (`fetchChannelByCustomerType`,
 * `fetchCustomerTypeBrand`) + wietnauer-{aktivasyon,iskonto,saha,segment}.ts
 * sink'lerinin (toplam 6) BİREBİR aynı çağırdığı desen.
 */
export function customerBreakdownJoin(meta: CustomerBreakdownMeta): string {
  return `LEFT JOIN dbo.${meta.table} k ON k.TXTKOD = m.${meta.joinColumn}`;
}

/**
 * Kırılım adının "(Tanımsız)" fallback'li okunabilir hâli — `AS <asAlias>`
 * ile biter (kanal/tip/segment/tip_ad — sink'e göre değişir, fragment'in
 * kendisi sabit).
 */
export function customerBreakdownLabelExpr(meta: CustomerBreakdownMeta, asAlias: string): string {
  return `${trimOrFallback(`k.${meta.labelColumn}`, "'(Tanımsız)'")} AS ${asAlias}`;
}

/**
 * Kırılım KODUNUN (join kolonunun) ham hâli, "0" fallback'li — yalnız
 * wietnauer-segment.ts `fetchMusteriGrupSegmentRaw` `tip_kod` sink'i
 * kullanır (label değil, kod; fallback metin değil "0").
 */
export function customerBreakdownCodeExpr(meta: CustomerBreakdownMeta, asAlias: string): string {
  return `${trimOrFallback(`m.${meta.joinColumn}`, "'0'")} AS ${asAlias}`;
}

/**
 * komuta.ts `getKomutaFacets()` kırılım facet sorgusu — ≥5 müşterili kırılım
 * kodlarını (kod/ad/n) döner (Cockpit "Kanal" dropdown seçenekleri).
 */
export function customerBreakdownFacetSql(meta: CustomerBreakdownMeta): string {
  return `SELECT LTRIM(RTRIM(k.TXTKOD)) kod, MAX(k.${meta.labelColumn}) ad, COUNT(DISTINCT m.LNGKOD) n
           FROM dbo.${meta.table} k
           INNER JOIN dbo.TBLMUSTERI m ON LTRIM(RTRIM(m.${meta.joinColumn})) = LTRIM(RTRIM(k.TXTKOD)) AND m.BYTDURUM = 0
           WHERE k.${meta.labelColumn} IS NOT NULL AND LTRIM(RTRIM(k.TXTKOD)) <> ''
           GROUP BY LTRIM(RTRIM(k.TXTKOD)) HAVING COUNT(DISTINCT m.LNGKOD) >= 5
           ORDER BY COUNT(DISTINCT m.LNGKOD) DESC`;
}

/**
 * komuta.ts `getKomutaSnapshot()` md2 Cockpit "Kanal" filtresi — seçili
 * kırılım koduna (`kanalLiteral`, ÇAĞIRAN TARAFINDAN `escSql` ile ÖNCEDEN
 * kaçışlanmış olmalı) sahip müşterilerin LNGKOD'larını semi-join ile daraltır.
 */
export function customerBreakdownFilterClause(meta: CustomerBreakdownMeta, kanalLiteral: string): string {
  return ` AND f.LNGMUSTERIKOD IN (SELECT LNGKOD FROM dbo.TBLMUSTERI WHERE BYTDURUM = 0 AND LTRIM(RTRIM(${meta.joinColumn})) = N'${kanalLiteral}')`;
}
