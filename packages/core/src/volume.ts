/**
 * Kanonik hacim (70cl eşdeğer) SQL ifadesi — tek yerden (md7 + md26).
 *
 * Univera hiyerarşi tutmaz; hacim = fatura DETAY satırındaki miktarın
 * litre-eşdeğerine çevrilmesi. Öncelik sırası (md7'de doğrulandı):
 *   1. Ürün ek_saha_26 (`TBLURUNEKSAHA.TXTEKSAHAACIKLAMA`, LNGEKSAHAKODU=26)
 *      — birim başına önceden hesaplanmış litre-eşdeğer (701 üründe dolu).
 *   2. Fallback: `DBLLITRE / divisor` (divisor tenant config'ten; wietnauer=1,
 *      pernod=9 — 9L kasa geleneği).
 */
import { getTenantConfig } from "./tenant/index.js";

/** Hacim böleni — tenant config `volume.divisor` (varsayılan 9). */
export function volumeDivisor(): number {
  return getTenantConfig().volume.divisor ?? 9;
}

/**
 * Bir `TBLMSDBELGEDETAY` satırı için hacim (adet × litre-eşdeğer) ifadesi.
 * SUM() ve join'ler ÇAĞIRANA aittir. Çağıran şu join'leri sağlamalı:
 *   - `<detay>` = TBLMSDBELGEDETAY (DBLMIKTAR, LNGURUNKOD)
 *   - `<urun>`  = TBLURUN (LNGKOD, DBLLITRE)  ⨝ ON u.LNGKOD = d.LNGURUNKOD
 *   - `<eksaha>`= TBLURUNEKSAHA  LEFT JOIN ON ue.LNGURUNREF=u.LNGKOD AND ue.LNGEKSAHAKODU=26
 */
export function volumeUnitExpr(detay = "d", urun = "u", eksaha = "ue"): string {
  return `${detay}.DBLMIKTAR * ISNULL(
    TRY_CONVERT(decimal(18,8), ${eksaha}.TXTEKSAHAACIKLAMA),
    ISNULL(${urun}.DBLLITRE, 0) / ${volumeDivisor()}
  )`;
}
