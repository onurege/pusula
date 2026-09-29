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
 * DAVRANIŞ KORUNUR (TEK-HOP): her fonksiyonun tek-hop dalının ürettiği metin,
 * refactor ÖNCESİ (Faz A öncesi) hardcoded
 * `TBLMUSTERIGRUPKIRILIM`/`TXTGRUPKIRILIMKOD`/`TXTAD` literal'iyle KARAKTER
 * BAZINDA aynıdır (bkz. `tenant/__tests__/customer-breakdown-sql.test.ts`,
 * baseline `git show HEAD:packages/core/src/komuta.ts` referans alınarak
 * alınmıştır).
 *
 * İKİ-HOP (Faz A ek-saha genişlemesi, `mode: "eksaha-two-hop"`): Wietnauer'ın
 * birleşik ek-saha müşteri kırılımı (`TBLMUSTERI` → `TBLMUSTERIEKSAHA` köprü
 * → `TBLEKSAHASECENEK` lookup, iki saha paralel çözülüp COALESCE'lenir) —
 * her 5 üreticinin YENİ mode-branch'i. Tek-hop dalı DEĞİŞMEDEN kalır (mode
 * yok/`"single-hop"` → bugünkü davranış), Pernod/fmcg-demo'yu etkilemez.
 */
import type { CustomerBreakdownMeta } from "./identifier";

/** İki-hop (`mode: "eksaha-two-hop"`) meta — mode-branch'lerde daraltma için. */
type EksahaTwoHopMeta = Extract<CustomerBreakdownMeta, { mode: "eksaha-two-hop" }>;

/**
 * `ISNULL(NULLIF(LTRIM(RTRIM(<qualifiedColumn>)), ''), <fallbackLiteral>)` —
 * Univera sink'lerinde tekrarlanan boş-string/NULL normalize deseni.
 */
function trimOrFallback(qualifiedColumn: string, fallbackLiteral: string): string {
  return `ISNULL(NULLIF(LTRIM(RTRIM(${qualifiedColumn})), ''), ${fallbackLiteral})`;
}

/**
 * Wietnauer ek-saha 4-way JOIN — `TBLMUSTERI m` üzerinden İKİ sahayı
 * (`sahaKods[0]`/`sahaKods[1]`) paralel köprü+lookup çiftiyle çözer (me1/lk1
 * = saha1, me2/lk2 = saha2 — alias'lar `customerBreakdownFacetSql`/
 * `FilterClause`'la ÇAKIŞMASIN diye sabit tutulur). DB doğrulandı:
 * (LNGMUSTERIREF, LNGEKSAHAKODU) TEKİL → fan-out YOK, OUTER APPLY GEREKMEZ —
 * düz LEFT JOIN yeterli. `lk.LNGKOD = TRY_CONVERT(int, LTRIM(RTRIM(me.
 * bridgeCodeCol)))` — köprüdeki ham metin kodu int'e çevirip lookup'a bağlar.
 */
function eksahaJoin(meta: EksahaTwoHopMeta): string {
  const [saha1, saha2] = meta.sahaKods;
  return (
    `LEFT JOIN dbo.${meta.bridgeTable} me1 ON me1.${meta.bridgeMusteriRef} = m.LNGKOD AND me1.${meta.bridgeSahaCol} = ${saha1} ` +
    `LEFT JOIN dbo.${meta.lookupTable} lk1 ON lk1.${meta.lookupSahaCol} = ${saha1} AND lk1.${meta.lookupKeyCol} = TRY_CONVERT(int, LTRIM(RTRIM(me1.${meta.bridgeCodeCol}))) ` +
    `LEFT JOIN dbo.${meta.bridgeTable} me2 ON me2.${meta.bridgeMusteriRef} = m.LNGKOD AND me2.${meta.bridgeSahaCol} = ${saha2} ` +
    `LEFT JOIN dbo.${meta.lookupTable} lk2 ON lk2.${meta.lookupSahaCol} = ${saha2} AND lk2.${meta.lookupKeyCol} = TRY_CONVERT(int, LTRIM(RTRIM(me2.${meta.bridgeCodeCol})))`
  );
}

/** İki-hop etiket ifadesi (alias'sız) — saha1 önce, saha2 sonra, ikisi de
 *  boşsa "(Tanımsız)" (brief: "COALESCE: saha1(OFF) → saha2(ON) → '(Tanımsız)'"). */
function eksahaLabel(meta: EksahaTwoHopMeta): string {
  return `COALESCE(lk1.${meta.labelColumn}, lk2.${meta.labelColumn}, '(Tanımsız)')`;
}

/**
 * Müşteri kırılımı lookup JOIN'i — TEK-HOP: `TBLMUSTERI m` üzerinden kırılım
 * tablosuna (`k`) bağlanır. İKİ-HOP (Wietnauer ek-saha): `eksahaJoin()`'e
 * devreder. komuta.ts (`fetchChannelByCustomerType`, `fetchCustomerTypeBrand`)
 * + wietnauer-{aktivasyon,iskonto,saha,segment}.ts sink'lerinin (toplam 6)
 * BİREBİR aynı çağırdığı desen — mode her ikisinde de şeffaf.
 */
export function customerBreakdownJoin(meta: CustomerBreakdownMeta): string {
  if (meta.mode === "eksaha-two-hop") {
    return eksahaJoin(meta);
  }
  return `LEFT JOIN dbo.${meta.table} k ON k.TXTKOD = m.${meta.joinColumn}`;
}

/**
 * Kırılım adının "(Tanımsız)" fallback'li okunabilir hâli — `AS <asAlias>`
 * ile biter (kanal/tip/segment/tip_ad — sink'e göre değişir, fragment'in
 * kendisi sabit). İki-hop'ta `COALESCE(lk1.label, lk2.label, '(Tanımsız)')`.
 */
export function customerBreakdownLabelExpr(meta: CustomerBreakdownMeta, asAlias: string): string {
  if (meta.mode === "eksaha-two-hop") {
    return `${eksahaLabel(meta)} AS ${asAlias}`;
  }
  return `${trimOrFallback(`k.${meta.labelColumn}`, "'(Tanımsız)'")} AS ${asAlias}`;
}

/**
 * Kırılım KODUNUN (join kolonunun) ham hâli, "0" fallback'li — yalnız
 * wietnauer-segment.ts `fetchMusteriGrupSegmentRaw` `tip_kod` sink'i
 * kullanır (label değil, kod; fallback metin değil "0"). İki-hop'ta kod
 * kaynağı köprünün ham `bridgeCodeCol`'u (saha1 → saha2 → "0" fallback) —
 * saha1/saha2 kod DEĞERLERİ çakışabilir (brief: "kod değerleri saha1/saha2
 * çakışır"), bu yüzden facet/label tarafı ANAHTAR olarak her zaman etiketi
 * (`eksahaLabel`) kullanır, kodu değil.
 */
export function customerBreakdownCodeExpr(meta: CustomerBreakdownMeta, asAlias: string): string {
  if (meta.mode === "eksaha-two-hop") {
    return `COALESCE(NULLIF(LTRIM(RTRIM(me1.${meta.bridgeCodeCol})),''), NULLIF(LTRIM(RTRIM(me2.${meta.bridgeCodeCol})),''),'0') AS ${asAlias}`;
  }
  return `${trimOrFallback(`m.${meta.joinColumn}`, "'0'")} AS ${asAlias}`;
}

/**
 * komuta.ts `getKomutaFacets()` kırılım facet sorgusu — ≥5 müşterili kırılım
 * kodlarını (kod/ad/n) döner (Cockpit "Kanal" dropdown seçenekleri). İki-
 * hop'ta kod değerleri saha1/saha2 arasında çakışabildiği için ETİKET METNİ
 * hem "kod" hem "ad" olarak dönülür (brief: "etiket anahtar") — subquery
 * `grp` üzerinden GROUP BY yapılır, `DISTINCT id` ile çift saymayı önler.
 */
export function customerBreakdownFacetSql(meta: CustomerBreakdownMeta): string {
  if (meta.mode === "eksaha-two-hop") {
    const join = eksahaJoin(meta);
    const label = eksahaLabel(meta);
    return `SELECT grp kod, grp ad, COUNT(DISTINCT id) n
             FROM (SELECT m.LNGKOD id, ${label} grp FROM dbo.TBLMUSTERI m ${join} WHERE m.BYTDURUM = 0) t
             GROUP BY grp HAVING COUNT(DISTINCT id) >= 5
             ORDER BY n DESC`;
  }
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
 * İki-hop'ta seçim ETİKETE göre yapılır (facet'in "kod" alanı zaten etiket
 * metni — bkz. `customerBreakdownFacetSql`), alias'lar (me1/lk1/me2/lk2)
 * `eksahaJoin()` ile birebir aynı — çakışma yok.
 */
export function customerBreakdownFilterClause(meta: CustomerBreakdownMeta, kanalLiteral: string): string {
  if (meta.mode === "eksaha-two-hop") {
    const join = eksahaJoin(meta);
    const label = eksahaLabel(meta);
    return ` AND f.LNGMUSTERIKOD IN (SELECT m.LNGKOD FROM dbo.TBLMUSTERI m ${join} WHERE m.BYTDURUM = 0 AND ${label} = N'${kanalLiteral}')`;
  }
  return ` AND f.LNGMUSTERIKOD IN (SELECT LNGKOD FROM dbo.TBLMUSTERI WHERE BYTDURUM = 0 AND LTRIM(RTRIM(${meta.joinColumn})) = N'${kanalLiteral}')`;
}
