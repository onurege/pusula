/**
 * Sipariş Öneri v2 — wallet-share/kapsam açığı (walletGap) + peer-temelli
 * çapraz-satış (peerCrossSell). `reorder.ts`'in (v1: overdue/winBack/
 * crossSell) ADDITIVE bir uzantısı — v1 kodunun kendisine DOKUNMAZ, ayrı
 * dosyaya çıkarılma sebebi salt dosya-boyutu hijyeni (Atlas okunabilirlik
 * standardı, ~400 satır sınırı) + net v1/v2 ayrımı.
 *
 * Veri kaynağı `peer-aggregate.ts` — MÜŞTERİ-BAĞIMSIZ, ek-grup+scope başına
 * CACHE'lenmiş akran agregatı (bkz. o dosyanın dosya-üstü notu, Faz 0 B1
 * VETO: canlı akran-agregasyon 10.5sn ölçüldü, per-request YASAK).
 *
 * `getCustomerReorder` (reorder.ts) tek bir `computeWalletGapAndPeerCrossSell`
 * çağrısıyla bu modülü tüketir — orkestrasyon (hangi sorgu ne zaman) BURADA,
 * v1 akışı reorder.ts'te kalır.
 */
import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";
import {
  getPeerAggregate,
  PEER_MIN_KISI,
  PEER_MIN_PENETRASYON,
  type PeerCategoryAgg,
  type PeerProductAgg,
} from "./peer-aggregate.js";

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/**
 * `reorder.ts`'teki `HISTORY_WINDOW_DAYS` (365) ile AYNI DEĞER, bilerek
 * kopyalanır (dairesel import'tan kaçınmak için — `reorder.ts` bu dosyayı
 * tüketir, tersi OLMAZ). Müşterinin kendi kategori-cirosu akranlarla AYNI
 * pencerede kıyaslanmalı (elma-elma); `peer-aggregate.ts`'teki
 * `PEER_WINDOW_DAYS` da AYNI değere sabit — üç dosyada da bu yorum birbirine
 * referans verir, drift'i insan-gözden-geçirme ile önler.
 */
const HISTORY_WINDOW_DAYS = 365;

/** Kapsam-açığı (walletGap) listesinin üst sınırı. */
const WALLET_GAP_TOP = 10;

/** Peer-temelli çapraz-satış (peerCrossSell) listesinin üst sınırı — v1 `CROSS_TOP` ile aynı mantık. */
const PEER_CROSS_TOP = 8;

/** 1 ondalığa yuvarlar — `reorder.ts`'teki AYNI isimli yardımcının bilinçli
 *  kopyası (üç satırlık saf fonksiyon; ayrı bir paylaşım modülü açmaya
 *  değmeyecek kadar küçük — Metz freni). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Public tipler
// ---------------------------------------------------------------------------

// Alan adları `apps/dashboard/lib/api.ts`/`customer-modal.tsx` ile SÖZLEŞME
// (dashboard bu tipleri paralel geliştirdi) — burada tanım DEĞİŞTİRİLİRSE
// dashboard tarafı da güncellenmeli. `peerPenetrasyon` dashboard sözleşmesi
// gereği YÜZDE (0..100) — `peer-aggregate.ts`'teki dahili kesir (0..1)
// eşiğiyle KARIŞTIRILMAMALI (dönüşüm `rankReorderCandidates` çağrı
// noktalarında yapılır).

export type WalletGapItem = {
  urunGrupKod: string;
  urunGrupAd: string;
  /** "hic-almadi": müşteri bu ürün grubundan HİÇ almamış (öncelikli — her
   *  zaman "akran-alti"ndan önce sıralanır). "akran-alti": alıyor ama akran
   *  ortalamasının ALTINDA. */
  tur: "hic-almadi" | "akran-alti";
  /** Akranların bu grubu alma oranı, 0..100 (YÜZDE). */
  peerPenetrasyon: number;
  peerMusteriSayi: number;
  oncelikSkoru: number;
};

export type PeerCrossSellItem = {
  urunKod: number;
  urunAd: string;
  /** Akranların bu ürünü alma oranı, 0..100 (YÜZDE). */
  peerPenetrasyon: number;
  peerMusteriSayi: number;
  /** v1 anchor-eşleşmesiyle AYNI kavram ama peer-temelli önerilerde YOK
   *  (ek bir 40M-satır co-occurrence sorgusu gerektirir, MVP kapsamı dışı) —
   *  UI bu alan yoksa penetrasyon cümlesine düşer (bkz. customer-modal.tsx). */
  anchorUrunAd?: string;
  oncelikSkoru: number;
};

// ---------------------------------------------------------------------------
// Fetcher — müşterinin ek-grubu (akran kohortu SUNUCUDA türetilir; client
// hiçbir zaman ekGrupKod göndermez/almaz — Faz 0 C2).
// ---------------------------------------------------------------------------

/**
 * Tek satır, PK (`LNGKOD`) ile sorgulanır — ucuz (indexed). `TBLMUSTERI`'nin
 * kendi `LNGDISTKOD`'u üzerinden scope uygulanır (`m.` alias'ı; fact-tablosu
 * `f.LNGDISTKOD` DEĞİL — burada hiç fatura yok). Bulunamazsa ya da ek-grup
 * boşsa `null` döner; çağıran bunu "peer sinyali yok" olarak yorumlar.
 *
 * `export` yalnız test erişimi için (bkz. `__tests__/reorder-v2.test.ts`).
 */
export async function fetchCustomerEkGrup(
  custKod: number,
  scopeClauseOnMusteri: string,
): Promise<string | null> {
  const query = `
    SELECT TOP 1 LTRIM(RTRIM(m.TXTEKGRUPKOD)) AS ekGrupKod
    FROM dbo.TBLMUSTERI m
    WHERE m.LNGKOD = ${custKod} AND m.BYTDURUM = 0${scopeClauseOnMusteri}
  `;
  const result = await runReadOnly(query, { limit: 1, timeoutMs: 10_000 });
  const kod = result.rows[0]?.ekGrupKod;
  return typeof kod === "string" && kod.trim() ? kod.trim() : null;
}

// ---------------------------------------------------------------------------
// Fetcher — müşterinin KENDİ kategori cirosu (akran ortalamasıyla kıyaslamak
// için — wallet-gap "akran-alti" sınıflandırması).
// ---------------------------------------------------------------------------

/**
 * Tek satır/müşteri × ~15-20 kategori — ucuz bir sorgu, `reorder.ts`
 * `fetchProductHistory` ile AYNI JOIN iskeleti (LOOP JOIN hint korunur).
 *
 * `export` yalnız test erişimi için (bkz. `__tests__/reorder-v2.test.ts`).
 */
export async function fetchCustomerCategoryCiro(
  custKod: number,
  scopeClause: string,
): Promise<Map<string, number>> {
  const query = `
    SELECT
      LTRIM(RTRIM(u.TXTURUNEKGRUPKOD)) AS urunGrupKod,
      SUM(d.DBLNETFIYAT) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER LOOP JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD AND u.BYTDURUM = 0
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.LNGMUSTERIKOD = ${custKod}
      AND f.TRHISLEMTARIHI >= DATEADD(day, -${HISTORY_WINDOW_DAYS}, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${scopeClause}
    GROUP BY LTRIM(RTRIM(u.TXTURUNEKGRUPKOD))
  `;
  const result = await runReadOnly(query, { limit: 200, timeoutMs: 30_000 });
  const map = new Map<string, number>();
  for (const r of result.rows) {
    map.set(String(r.urunGrupKod ?? ""), Number(r.ciro ?? 0));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Saf (DB'siz) sınıflandırma + skorlama fonksiyonları
// ---------------------------------------------------------------------------

/** Ranking girdisi için ortak şekil — hem kategori hem ürün adayları bunu üretir. */
type PeerRankable = {
  /** Akranların satın alma oranı, KESİR (0..1) — henüz yüzdeye çevrilmedi. */
  peerPenetrasyon: number;
  peerMusteriSayi: number;
  /** Akran grubunun bu kategori/üründeki TOPLAM cirosu — skor girdisi. */
  peerCiro: number;
};

/**
 * Akran kategorilerini müşterinin KENDİ kategori-cirosuyla kıyaslayıp
 * wallet-gap adaylarına çevirir. Filtreler (sırasıyla):
 *   1. k-anonimlik (`PEER_MIN_KISI`) — SAVUNMA-DERİNLİĞİ, SQL zaten `HAVING`
 *      ile bastırıyor (bkz. `peer-aggregate.ts`) ama burada da kontrol edilir
 *      (peer-aggregate cache'i eski/farklı bir sürümden gelmiş olabilir).
 *   2. penetrasyon eşiği (`PEER_MIN_PENETRASYON`) — dahil, `>=` (tam %30 geçer).
 *   3. "peer-üstü guard" — müşteri zaten akran ORTALAMASINDA ya da ÜSTÜNDE
 *      alıyorsa (ownCiro >= peerOrtCiro) bu kategori bir "açık" DEĞİLDİR,
 *      listeye HİÇ girmez (ne hic-almadi ne akran-alti).
 *
 * `export` yalnız test erişimi için (bkz. `__tests__/reorder-v2.test.ts`).
 */
export function classifyWalletGapCategories(
  peerCategories: PeerCategoryAgg[],
  ownCategoryCiro: ReadonlyMap<string, number>,
): Array<PeerRankable & { urunGrupKod: string; urunGrupAd: string; tur: "hic-almadi" | "akran-alti" }> {
  const out: Array<
    PeerRankable & { urunGrupKod: string; urunGrupAd: string; tur: "hic-almadi" | "akran-alti" }
  > = [];
  for (const cat of peerCategories) {
    if (cat.peerMusteriSayi < PEER_MIN_KISI) continue; // k-anon (savunma-derinliği)
    if (cat.peerToplamMusteriSayi <= 0) continue; // dejenere (payda yok)
    const penetrasyon = cat.peerMusteriSayi / cat.peerToplamMusteriSayi;
    if (penetrasyon < PEER_MIN_PENETRASYON) continue;

    const ownCiro = ownCategoryCiro.get(cat.urunGrupKod) ?? 0;
    const peerOrtCiro = cat.peerCiro / cat.peerMusteriSayi;
    let tur: "hic-almadi" | "akran-alti";
    if (ownCiro <= 0) {
      tur = "hic-almadi";
    } else if (ownCiro < peerOrtCiro) {
      tur = "akran-alti";
    } else {
      continue; // peer-üstü guard — açık yok
    }
    out.push({
      urunGrupKod: cat.urunGrupKod,
      urunGrupAd: cat.urunGrupAd,
      tur,
      peerPenetrasyon: penetrasyon,
      peerMusteriSayi: cat.peerMusteriSayi,
      peerCiro: cat.peerCiro,
    });
  }
  return out;
}

/**
 * Akran ürünlerini peer-cross-sell adaylarına çevirir — müşterinin ZATEN
 * SAHİP OLDUĞU ürünler hariç tutulur (v1 crossSell ile AYNI "owned" seti).
 * k-anon + penetrasyon eşiği `classifyWalletGapCategories` ile AYNI mantık.
 *
 * `export` yalnız test erişimi için (bkz. `__tests__/reorder-v2.test.ts`).
 */
export function buildPeerCrossSellCandidates(
  peerProducts: PeerProductAgg[],
  ownedUrunKods: ReadonlySet<number>,
): Array<PeerRankable & { urunKod: number; urunAd: string }> {
  const out: Array<PeerRankable & { urunKod: number; urunAd: string }> = [];
  for (const p of peerProducts) {
    if (ownedUrunKods.has(p.urunKod)) continue;
    if (p.peerMusteriSayi < PEER_MIN_KISI) continue; // k-anon (savunma-derinliği)
    if (p.peerToplamMusteriSayi <= 0) continue;
    const penetrasyon = p.peerMusteriSayi / p.peerToplamMusteriSayi;
    if (penetrasyon < PEER_MIN_PENETRASYON) continue;
    out.push({
      urunKod: p.urunKod,
      urunAd: p.urunAd,
      peerPenetrasyon: penetrasyon,
      peerMusteriSayi: p.peerMusteriSayi,
      peerCiro: p.peerCiro,
    });
  }
  return out;
}

/**
 * Öncelik-skoru hesaplayıp SIRALI döner — walletGap kategorileri VE
 * peerCrossSell ürünleri için ORTAK, saf (DB'siz) skorlama/sıralama.
 *
 * Gerçek marj verisi YOK (Faz 0 A1) → `oncelikSkoru = peerPenetrasyon (kesir,
 * 0..1) × peerCiro` (akran grubunun bu kategori/üründeki TOPLAM cirosu) —
 * hem "kaç akran alıyor" hem "ne kadar büyük bir ciro" sinyalini tek sayıda
 * birleştiren bir CİRO-PROXY (gerçek marj-proxy fast-follow, Faz 0 Seçenek 2).
 *
 * `priorityRank` verilirse (walletGap'te "hic-almadi" HER ZAMAN "akran-alti"
 * ÖNÜNDE) önce ona, sonra `oncelikSkoru`'na (azalan), sonra `tieBreakKey`'e
 * (artan) göre sıralanır — bu üçüncü katman determinizm için: eşit skorlu
 * iki aday HER ÇALIŞTIRMADA aynı sırada çıkar (test edilebilirlik).
 *
 * `export` yalnız test erişimi için (bkz. `__tests__/reorder-v2.test.ts`).
 */
export function rankReorderCandidates<T extends PeerRankable>(
  items: T[],
  options: {
    priorityRank?: (item: T) => number;
    tieBreakKey: (item: T) => string | number;
  },
): Array<T & { oncelikSkoru: number }> {
  const { priorityRank, tieBreakKey } = options;
  const scored = items.map((item) => ({
    ...item,
    oncelikSkoru: round1(item.peerPenetrasyon * item.peerCiro),
  }));
  scored.sort((a, b) => {
    if (priorityRank) {
      const pr = priorityRank(a) - priorityRank(b);
      if (pr !== 0) return pr;
    }
    if (b.oncelikSkoru !== a.oncelikSkoru) return b.oncelikSkoru - a.oncelikSkoru;
    const ta = tieBreakKey(a);
    const tb = tieBreakKey(b);
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  return scored;
}

// ---------------------------------------------------------------------------
// Orkestrasyon — `reorder.ts` `getCustomerReorder` TEK bir çağrıyla bunu tüketir.
// ---------------------------------------------------------------------------

export type WalletGapAndPeerCrossSell = {
  /** Yalnız akran-agregatı bu ek-grup+scope için CACHE'lenmişse dolu (bkz.
   *  `peer-aggregate.ts` `getPeerAggregate`); aksi halde HİÇ SET EDİLMEZ
   *  (undefined) — çağıran v1 davranışına sessizce düşer. */
  walletGap?: WalletGapItem[];
  peerCrossSell?: PeerCrossSellItem[];
};

/**
 * v2'nin TÜM orkestrasyonu: ek-grup lookup → peer-aggregate cache okuma →
 * (varsa) müşterinin kendi kategori-cirosu → sınıflandırma → skorlama →
 * dashboard sözleşmesine (0..100 yüzde) dönüştürme.
 *
 * Her adım kendi `.catch` ile korunur (E3 deseni — hata LOGLANIR, [] / null'a
 * düşülür, istek asla patlamaz). `getPeerAggregate` bir SQLite CACHE okur
 * (MSSQL'e gitmez, Faz 0 B1 VETO) — bu fonksiyon `reorder.ts`'in "her çağrı
 * canlı hesap" ilkesini bozmaz.
 */
export async function computeWalletGapAndPeerCrossSell(options: {
  custKod: number;
  /** Fact-tablosu (TBLMSDFATURA `f.`) sorguları için dist-scope fragment'ı. */
  scopeClause: string;
  /** `TBLMUSTERI` (`m.`) sorgusu için dist-scope fragment'ı — AYRI alias. */
  ekGrupScopeClause: string;
  /** `getPeerAggregate`'e geçirilen dar scope (yalnız allowedDistKods/distId). */
  peerScope: { allowedDistKods?: number[] | null; distId?: number | null };
  /** v1 geçmişinden gelen, müşterinin ZATEN SAHİP OLDUĞU ürün kodları. */
  ownedUrunKods: number[];
}): Promise<WalletGapAndPeerCrossSell> {
  const { custKod, scopeClause, ekGrupScopeClause, peerScope, ownedUrunKods } = options;

  const ekGrupKod = await fetchCustomerEkGrup(custKod, ekGrupScopeClause).catch((err) => {
    console.error("[reorder-v2] fetchCustomerEkGrup failed:", err);
    return null;
  });

  // SICAK YOL — SADECE cache okur. Cache boşsa (bu ek-grup henüz ısıtılmamış)
  // `null` döner ve v2 alanları TAMAMEN atlanır.
  const peerAgg = ekGrupKod
    ? await getPeerAggregate(ekGrupKod, peerScope).catch((err) => {
        console.error("[reorder-v2] getPeerAggregate failed:", err);
        return null;
      })
    : null;

  if (!peerAgg) return {};

  const ownCategoryCiro = await fetchCustomerCategoryCiro(custKod, scopeClause).catch((err) => {
    console.error("[reorder-v2] fetchCustomerCategoryCiro failed:", err);
    return new Map<string, number>();
  });

  const gapCandidates = classifyWalletGapCategories(peerAgg.categories, ownCategoryCiro);
  const walletGap = rankReorderCandidates(gapCandidates, {
    priorityRank: (i) => (i.tur === "hic-almadi" ? 0 : 1),
    tieBreakKey: (i) => i.urunGrupKod,
  })
    .slice(0, WALLET_GAP_TOP)
    .map((i) => ({
      urunGrupKod: i.urunGrupKod,
      urunGrupAd: i.urunGrupAd,
      tur: i.tur,
      // Dahili kesir (0..1) → dashboard sözleşmesi (0..100 yüzde).
      peerPenetrasyon: round1(i.peerPenetrasyon * 100),
      peerMusteriSayi: i.peerMusteriSayi,
      oncelikSkoru: i.oncelikSkoru,
    }));

  const ownedSet = new Set(ownedUrunKods);
  const crossCandidates = buildPeerCrossSellCandidates(peerAgg.products, ownedSet);
  const peerCrossSell = rankReorderCandidates(crossCandidates, {
    tieBreakKey: (i) => i.urunKod,
  })
    .slice(0, PEER_CROSS_TOP)
    .map((i) => ({
      urunKod: i.urunKod,
      urunAd: i.urunAd,
      peerPenetrasyon: round1(i.peerPenetrasyon * 100),
      peerMusteriSayi: i.peerMusteriSayi,
      oncelikSkoru: i.oncelikSkoru,
    }));

  return { walletGap, peerCrossSell };
}
