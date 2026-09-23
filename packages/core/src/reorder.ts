/**
 * Sipariş Öneri motoru — Insider (FMCG/Panorama) müşteri×ürün sinyalleri.
 *
 * Tek müşteri için üç sinyal üretir:
 *   - overdue  — düzenli aldığı ama SÜRESİ GEÇMİŞ ürünler (yakın gecikme).
 *   - winBack  — eskiden düzenli alıp TAMAMEN BIRAKTIĞI ürünler.
 *   - crossSell — market-basket: benzer müşterilerin birlikte aldığı ama BU
 *                 müşterinin hiç almadığı ürünler.
 *
 * Kaynak: `dbo.TBLMSDFATURA` (BYTTUR=0 AND BYTDURUM=0 satış faturası) ×
 * `dbo.TBLMSDBELGEDETAY` (satır). JOIN anahtarı LNGYIL+LNGFATURAKOD+LNGDISTKOD
 * — detay tablosu ~40M satır, bu yüzden her sorguda `INNER LOOP JOIN` ile
 * FATURA'dan DETAY'a `IX_TBLMSDBELGEDETAY_LNGYIL_LNGFATURAKOD` seek'ine
 * zorlanır (hash/merge join planlayıcı bazen tüm tabloyu taramaya kalkar).
 *
 * Cache YOK (bilinçli): MVP'de binlerce müşteriye kalıcı per-müşteri cache
 * (SQLite) şişer ve tazelik sorunu yaratır — her çağrı canlı hesap. Hedef
 * tıklama→sonuç <1.5sn; dar tarih pencereleri + LOOP JOIN bunu sağlıyor
 * (bkz. dosya sonu doğrulama notu).
 */
import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";
import { distScopeClause } from "./scope-clause.js";
import {
  computeWalletGapAndPeerCrossSell,
  classifyWalletGapCategories,
  buildPeerCrossSellCandidates,
  rankReorderCandidates,
  type WalletGapItem,
  type PeerCrossSellItem,
} from "./reorder-v2.js";

// v2 saf sınıflandırma/skorlama fonksiyonları + tipleri RE-EXPORT edilir —
// bkz. `reorder-v2.ts` dosya-üstü notu (dosya-boyutu hijyeni için ayrıldı,
// ama "reorder.ts genişlet" sözleşmesi/test erişimi buradan bozulmadan devam
// eder, `distScopeClause`/`scope-clause.ts` ile AYNI desen).
export { classifyWalletGapCategories, buildPeerCrossSellCandidates, rankReorderCandidates };
export type { WalletGapItem, PeerCrossSellItem };

// ---------------------------------------------------------------------------
// Eşik sabitleri — NAMED const, keyfi büyülü sayı yok.
// ---------------------------------------------------------------------------

/** Geçmiş penceresi: müşterinin ürün-bazlı sipariş ritmini bu kadar gün geriye bakarak öğreniriz. */
const HISTORY_WINDOW_DAYS = 365;

/** Cross-sell "sepet" penceresi — probe'da LOOP JOIN ile ~1sn doğrulandı (son 90g). 180g'e çıkarmak taramayı book ikiye katlar, kazanç marjinal. */
const CROSS_SELL_WINDOW_DAYS = 90;

/**
 * Overdue eşik çarpanı — KATI (az yanlış-pozitif). Ortalama sipariş aralığının
 * %20 fazlasını geçmeden "gecikti" denmez; her hafta ufak sapma gösteren
 * müşteriyi gereksiz yere "gecikmiş" diye işaretlememek için.
 */
const OVERDUE_FACTOR = 1.2;

/** Overdue'nun ÜST sınırı VE winBack'in taban çarpanı — ortalama aralığın 3 katını geçen gecikme artık "gecikme" değil "bırakma" sayılır. */
const WINBACK_FACTOR = 3;

/** winBack için mutlak gün tabanı — ortAralik küçükse (sık alan müşteri) salt çarpan (×3) çok erken tetikler; 120 gün altı hiçbir zaman "bırakma" sayılmaz. */
const WINBACK_MIN_DAYS = 120;

/** Bir ürünün sınıflandırmaya girmesi için gereken minimum farklı gün sayısı — 1-2 kerelik tek seferlik alımlar "ritim" oluşturmaz (ortAralik anlamsız olur). */
const MIN_SIPARIS = 3;

/** Cross-sell önerisi listesinin üst sınırı. */
const CROSS_TOP = 8;

// ---------------------------------------------------------------------------
// Public tipler
// ---------------------------------------------------------------------------

export type OverdueItem = {
  urunKod: number;
  urunAd: string;
  /** YYYY-MM-DD */
  sonSiparis: string;
  /** Müşterinin bu üründeki ortalama sipariş aralığı (gün), 1 ondalık. */
  ortAralikGun: number;
  /** Son HISTORY_WINDOW_DAYS içinde kaç farklı günde sipariş edildiği. */
  siparisSayisi: number;
  /** Beklenen sipariş gününü kaç gün geçtiği (gecikmeGun - ortAralikGun). */
  gunGecikti: number;
};

export type WinBackItem = {
  urunKod: number;
  urunAd: string;
  /** YYYY-MM-DD */
  sonSiparis: string;
  ortAralikGun: number;
  siparisSayisi: number;
  /** Son siparişten bugüne kaç gün geçtiği (mutlak gecikme). */
  gunGecti: number;
};

export type CrossSellItem = {
  urunKod: number;
  urunAd: string;
  /**
   * Bu önerinin dayandığı ÇIPA ürün — müşterinin ZATEN SAHİP OLDUĞU ürünler
   * arasından, önerilen ürünle EN ÇOK birlikte geçen. "Neden bu öneri?"
   * sorusuna kullanıcı arayüzünde cevap vermek için (yalın "2441 kez birlikte
   * alınıyor" sayısı tek başına anlamsız — hangi üründen dolayı önerildiği
   * gösterilmeli).
   */
  anchorUrunKod: number;
  anchorUrunAd: string;
  /** Önerilen ürünün, `anchorUrunKod` ile son CROSS_SELL_WINDOW_DAYS günde
   *  (tüm müşteriler genelinde) aynı faturada kaç kez geçtiği. Sıralama ve
   *  opsiyonel gösterim için. */
  birlikteSayisi: number;
};

// -- v2 (additive) — wallet-share/kapsam açığı + peer-temelli çapraz-satış --
// `WalletGapItem`/`PeerCrossSellItem` tipleri `reorder-v2.ts`'te tanımlı
// (bkz. import + re-export yukarıda) — burada YALNIZ `ReorderResult`'a
// gömülür.

export type ReorderResult = {
  musteriKod: number;
  generatedAt: string;
  overdue: OverdueItem[];
  winBack: WinBackItem[];
  crossSell: CrossSellItem[];
  /** v2 — yalnız akran-agregatı bu ek-grup+scope için CACHE'lenmişse dolu
   *  (bkz. `peer-aggregate.ts` `getPeerAggregate`); aksi halde alan HİÇ
   *  set edilmez (undefined) — UI v1 davranışına sessizce düşer. */
  walletGap?: WalletGapItem[];
  /** v2 — bkz. `walletGap` notu; aynı koşulda dolu. */
  peerCrossSell?: PeerCrossSellItem[];
  ozet: {
    toplamGecikmis: number;
    toplamWinback: number;
    toplamCross: number;
    /** v2 — `walletGap` dolu ise uzunluğu, aksi halde undefined. */
    gapSayi?: number;
    /** v2 — `peerCrossSell` dolu ise uzunluğu, aksi halde undefined. */
    peerCrossSayi?: number;
  };
};

// ---------------------------------------------------------------------------
// Dist-scope yardımcı
// ---------------------------------------------------------------------------

/**
 * `distScopeClause` artık `scope-clause.ts`'te tanımlı (bkz. o dosyanın
 * dosya-üstü yorumu — `peer-aggregate.ts` da bunu kullandığı için dairesel
 * import'tan kaçınmak amacıyla taşındı). Burada RE-EXPORT edilir: mevcut
 * `__tests__/reorder.test.ts` bunu `../reorder.js`'den import ediyor, o yol
 * DEĞİŞMEDEN çalışmaya devam eder.
 */
export { distScopeClause };

// ---------------------------------------------------------------------------
// Fetcher #1 — müşteri×ürün geçmişi (overdue/winBack sınıflandırması +
// cross-sell'in "zaten sahip" hariç-tutma listesi TEK sorgudan çıkar).
// ---------------------------------------------------------------------------

/** `export` yalnız test erişimi için (bkz. `__tests__/reorder.test.ts`). */
export type ProductHistoryRow = {
  urunKod: number;
  urunAd: string;
  /** Distinct sipariş günü sayısı. */
  gun: number;
  /** YYYY-MM-DD */
  sonSiparis: string;
  /** İlk-son sipariş arası gün farkı (DATEDIFF, SQL tarafında). */
  spanGun: number;
  /** Son siparişten `sqlNow()`'a kadar geçen gün (DATEDIFF, SQL tarafında). */
  gecikmeGun: number;
};

/**
 * `spanGun`/`gecikmeGun` bilerek SQL'de `DATEDIFF` ile hesaplanır, JS'te
 * `Date` çıkarma DEĞİL — mssql sürücüsünün DATE değerlerini UTC gece yarısı
 * `Date` nesnesi olarak döndürmesi, `currentDate()`'in yerel-saat + saat
 * bileşenli değeriyle çıkarılınca off-by-one riski taşır. SQL tarafında
 * `sqlNow()` (donuk-saat anchor, NOW_MODE=max-invoice) ile hesaplamak bu
 * riski komple ortadan kaldırır.
 */
async function fetchProductHistory(
  custKod: number,
  scopeClause: string,
): Promise<ProductHistoryRow[]> {
  const query = `
    SELECT
      d.LNGURUNKOD AS urunKod,
      MAX(u.TXTAD) AS urunAd,
      COUNT(DISTINCT CAST(f.TRHISLEMTARIHI AS date)) AS gun,
      CONVERT(varchar(10), MAX(f.TRHISLEMTARIHI), 23) AS sonSiparis,
      DATEDIFF(day, MIN(CAST(f.TRHISLEMTARIHI AS date)), MAX(CAST(f.TRHISLEMTARIHI AS date))) AS spanGun,
      DATEDIFF(day, MAX(CAST(f.TRHISLEMTARIHI AS date)), ${sqlNow()}) AS gecikmeGun
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
    GROUP BY d.LNGURUNKOD
  `;
  const result = await runReadOnly(query, { limit: 2000, timeoutMs: 30_000 });
  return result.rows.map((r) => ({
    urunKod: Number(r.urunKod),
    urunAd: String(r.urunAd ?? ""),
    gun: Number(r.gun ?? 0),
    sonSiparis: String(r.sonSiparis ?? ""),
    spanGun: Number(r.spanGun ?? 0),
    gecikmeGun: Number(r.gecikmeGun ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Fetcher #2 — cross-sell (market-basket co-occurrence)
// ---------------------------------------------------------------------------

/**
 * Market-basket cross-sell — müşterinin zaten sahip olduğu ürünlerle (son
 * HISTORY_WINDOW_DAYS gün) AYNI faturada (tüm müşteriler genelinde, son
 * CROSS_SELL_WINDOW_DAYS gün) en sık birlikte geçen ama müşterinin ALMADIĞI
 * ürünler. Her öneri, kendisini tetikleyen ÇIPA ürünle (müşterinin sahip
 * olduğu, önerilen ürünle en çok eşleşen ürün) birlikte döner — salt bir sayı
 * ("2441 kez birlikte alınıyor") kullanıcı için anlamsız, "hangi ürününüzle
 * ilişkili" sorusuna cevap gerekir.
 *
 * Üç geçişli tasarım — 40M satırlık TBLMSDBELGEDETAY'a karşı performans:
 *   1) `basketFatura`: pencere içindeki (TÜM müşteriler) faturaları FATURA→
 *      DETAY `INNER LOOP JOIN` ile tarar (probe'da doğrulanmış ~1sn), yalnız
 *      müşterinin sahip olduğu ürünlerden en az birini içerenleri tutar.
 *   2) `pairs`: (1)'den çıkan KÜÇÜK fatura kümesini TEKRAR LOOP JOIN ile
 *      detaya bağlar — bu kez İKİ kez (d1=sahip olunan ürün satırı, d2=yeni
 *      ürün satırı) — aynı faturadaki her (sahip-olunan, yeni) ürün ÇİFTİni
 *      üretir. Küçük bir fatura kümesine karşı çalıştığı için ucuz.
 *   3) `pairCounts`/`ranked`: çift başına distinct-fatura sayısı (birlikteSayisi),
 *      sonra her ÖNERİLEN ürün için `ROW_NUMBER()` ile EN YÜKSEK sayıya sahip
 *      çıpayı seçer (`rn=1`); genel sıralama önerinin TOPLAM (tüm çıpalar
 *      toplamı) co-occurrence'ına göre — bu, çıpası zayıf ama farklı birkaç
 *      üründen toplamda sık gelen bir öneriyi haksız yere geride bırakmaz.
 *
 * `ownedUrunKods` çağıran taraftan (`fetchProductHistory` sonucu) gelir —
 * "müşterinin ürün listesini önce çek, sonra sorguyu o ürünlerle sınırla"
 * deseni; ayrı bir CTE ile TBLMSDFATURA'yı tekrar taramaktan kaçınır.
 */
async function fetchCrossSell(
  custKod: number,
  ownedUrunKods: number[],
  scopeClause: string,
): Promise<CrossSellItem[]> {
  const owned = ownedUrunKods.filter((n) => Number.isInteger(n));
  if (owned.length === 0) return [];
  const ownedList = owned.join(",");

  const query = `
    WITH basketFatura AS (
      SELECT DISTINCT f.LNGYIL, f.LNGBELGEKOD AS LNGFATURAKOD, f.LNGDISTKOD
      FROM dbo.TBLMSDFATURA f
      INNER LOOP JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.LNGMUSTERIKOD <> ${custKod}
        AND d.LNGURUNKOD IN (${ownedList})
        AND f.TRHISLEMTARIHI >= DATEADD(day, -${CROSS_SELL_WINDOW_DAYS}, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${scopeClause}
    ),
    pairs AS (
      SELECT DISTINCT
        bf.LNGYIL, bf.LNGFATURAKOD, bf.LNGDISTKOD,
        d1.LNGURUNKOD AS anchorUrunKod,
        d2.LNGURUNKOD AS urunKod
      FROM basketFatura bf
      INNER LOOP JOIN dbo.TBLMSDBELGEDETAY d1
        ON d1.LNGYIL = bf.LNGYIL
       AND d1.LNGFATURAKOD = bf.LNGFATURAKOD
       AND d1.LNGDISTKOD = bf.LNGDISTKOD
       AND d1.LNGURUNKOD IN (${ownedList})
      INNER LOOP JOIN dbo.TBLMSDBELGEDETAY d2
        ON d2.LNGYIL = bf.LNGYIL
       AND d2.LNGFATURAKOD = bf.LNGFATURAKOD
       AND d2.LNGDISTKOD = bf.LNGDISTKOD
       AND d2.LNGURUNKOD NOT IN (${ownedList})
    ),
    pairCounts AS (
      SELECT
        anchorUrunKod,
        urunKod,
        COUNT(DISTINCT CONCAT(LNGYIL, '-', LNGFATURAKOD, '-', LNGDISTKOD)) AS birlikteSayisi
      FROM pairs
      GROUP BY anchorUrunKod, urunKod
    ),
    ranked AS (
      SELECT
        anchorUrunKod,
        urunKod,
        birlikteSayisi,
        ROW_NUMBER() OVER (
          PARTITION BY urunKod
          ORDER BY birlikteSayisi DESC, anchorUrunKod ASC
        ) AS rn,
        SUM(birlikteSayisi) OVER (PARTITION BY urunKod) AS totalBirlikte
      FROM pairCounts
    )
    SELECT TOP (${CROSS_TOP})
      r.urunKod,
      u.TXTAD AS urunAd,
      r.anchorUrunKod,
      ua.TXTAD AS anchorUrunAd,
      r.birlikteSayisi
    FROM ranked r
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = r.urunKod AND u.BYTDURUM = 0
    INNER JOIN dbo.TBLURUN ua ON ua.LNGKOD = r.anchorUrunKod
    WHERE r.rn = 1
    ORDER BY r.totalBirlikte DESC, r.birlikteSayisi DESC
  `;
  const result = await runReadOnly(query, { limit: CROSS_TOP, timeoutMs: 30_000 });
  return result.rows.map((r) => ({
    urunKod: Number(r.urunKod),
    urunAd: String(r.urunAd ?? ""),
    anchorUrunKod: Number(r.anchorUrunKod),
    anchorUrunAd: String(r.anchorUrunAd ?? ""),
    birlikteSayisi: Number(r.birlikteSayisi ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Sınıflandırma
// ---------------------------------------------------------------------------

/** `export` yalnız test erişimi için (bkz. `__tests__/reorder.test.ts`). */
export type Classification =
  | { kind: "overdue" | "winback"; ortAralikGun: number; gunFark: number }
  | { kind: "none" };

/** 1 ondalığa yuvarlar (ortAralikGun gibi süre değerleri için). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * MIN_SIPARIS eşiği (gun>=3) `spanGun/(gun-1)` bölmesinin payda>=2 olmasını
 * (dolayısıyla `ortAralik` her zaman tanımlı olmasını) garanti eder — ayrı
 * bir null-guard gerekmez.
 *
 * Sınırlar KASITLI OLARAK açık aralık (`<`/`>`, `<=` DEĞİL): overdue tam
 * `[1.2x, 3x]` uç noktalarında DEĞİL, aralarında yaşar — tam sınır
 * değerlerinin ikisi de (1.2x ve 3x) "none" (ölü nokta) sayılır. winBack
 * tabanı (`max(3x, WINBACK_MIN_DAYS)`) da aynı şekilde katı `>` ile
 * başlar. Sonuç: overdue ÜST'ü ile winBack TABAN'ı arasında (ortAralik
 * küçükse) KASITLI bir boşluk olabilir — o aralıktaki (ve tam sınırdaki)
 * gecikme ne "gecikti" ne "bıraktı" sayılır; az yanlış-pozitif hedefiyle
 * bilinçli bir ödün. Bu sayede overdue/winBack kümeleri HER ZAMAN ayrık
 * (birbirini asla kesmez) — matematiksel olarak kanıtlanabilir, test edilir.
 *
 * `export` yalnız test erişimi için (bkz. `__tests__/reorder.test.ts`).
 */
export function classify(row: ProductHistoryRow): Classification {
  if (row.gun < MIN_SIPARIS) return { kind: "none" };
  const ortAralik = row.spanGun / (row.gun - 1);
  if (!(ortAralik > 0)) return { kind: "none" }; // dejenere veri (aynı gün çoklu fatura vb.)

  const gecikmeGun = row.gecikmeGun;
  const overdueUpper = ortAralik * WINBACK_FACTOR;
  const winbackThreshold = Math.max(overdueUpper, WINBACK_MIN_DAYS);

  if (gecikmeGun > winbackThreshold) {
    return { kind: "winback", ortAralikGun: round1(ortAralik), gunFark: Math.round(gecikmeGun) };
  }
  if (gecikmeGun > ortAralik * OVERDUE_FACTOR && gecikmeGun < overdueUpper) {
    return {
      kind: "overdue",
      ortAralikGun: round1(ortAralik),
      gunFark: Math.round(gecikmeGun - ortAralik),
    };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Bir müşteri için Sipariş Öneri sinyalleri — v1 (overdue + winBack +
 * crossSell) + v2 (walletGap + peerCrossSell, additive).
 *
 * Dist-scope SUNUCU-OTORİTER uygulanır: `distId` (drill-down/tek-dist) varsa
 * o tek dist'e, yoksa `allowedDistKods`'a daraltılır (auth.ts `resolveTenantScope`
 * ile AYNI sözleşme — çağıran API katmanı scope'u zaten oradan çözer).
 *
 * `forceRefresh` YOK (bilinçli) — bu fonksiyon `withCache` KULLANMAZ (dosya-
 * üstü yorum: MVP'de per-müşteri kalıcı cache şişirir), her çağrı zaten canlı
 * hesap; diğer v3 snapshot fonksiyonlarının imza-uyumu burada gerekmiyor (bu
 * endpoint `makeV3Handler`/`makeSnapshotHandler` kullanmıyor). v2 kısmı BUNA
 * İSTİSNA: `getPeerAggregate` bir SQLite CACHE okur (MSSQL'e gitmez) — bu
 * yüzden v2 eklemek yukarıdaki "her çağrı canlı hesap" ilkesini bozmaz,
 * sadece CANLI akran hesabını (Faz 0 B1 VETO) per-request yola SOKMAZ.
 *
 * Akran kohortu (ek-grup) SUNUCUDA, tek bir ucuz PK-lookup ile türetilir
 * (`fetchCustomerEkGrup`) — client asla ekGrupKod göndermez/almaz (Faz 0 C2).
 */
export async function getCustomerReorder(options: {
  musteriKod: number;
  allowedDistKods?: number[] | null;
  distId?: number | null;
}): Promise<ReorderResult> {
  const custKod = Math.trunc(options.musteriKod);
  if (!Number.isFinite(custKod)) {
    throw new Error("Geçersiz musteriKod");
  }
  const scopeClause = distScopeClause(options);

  // E3 fix (Faz 0) — DB hatası artık sessizce yutulmuyor, log'a düşüyor
  // (davranış AYNI kalır: yine [] dönülür, istek patlamaz).
  const history = await fetchProductHistory(custKod, scopeClause).catch((err) => {
    console.error("[reorder] fetchProductHistory failed:", err);
    return [] as ProductHistoryRow[];
  });

  const overdue: OverdueItem[] = [];
  const winBack: WinBackItem[] = [];
  for (const row of history) {
    const cls = classify(row);
    if (cls.kind === "overdue") {
      overdue.push({
        urunKod: row.urunKod,
        urunAd: row.urunAd,
        sonSiparis: row.sonSiparis,
        ortAralikGun: cls.ortAralikGun,
        siparisSayisi: row.gun,
        gunGecikti: cls.gunFark,
      });
    } else if (cls.kind === "winback") {
      winBack.push({
        urunKod: row.urunKod,
        urunAd: row.urunAd,
        sonSiparis: row.sonSiparis,
        ortAralikGun: cls.ortAralikGun,
        siparisSayisi: row.gun,
        gunGecti: cls.gunFark,
      });
    }
  }
  overdue.sort((a, b) => b.gunGecikti - a.gunGecikti);
  winBack.sort((a, b) => b.gunGecti - a.gunGecti);

  const ownedUrunKods = history.map((r) => r.urunKod);

  // v2 — walletGap + peerCrossSell (additive, bkz. `reorder-v2.ts`). v1
  // crossSell'DEN ÖNCE çalışır (sıra keyfi — ikisi birbirine bağımlı DEĞİL —
  // ama tutarlı bir sıra test/log okunurluğunu kolaylaştırır). Ek-grup lookup
  // `history.length`'e bağlı DEĞİL: geçmişi boş yepyeni bir müşteri için bile
  // "akranların hiç almadığın şu kategorileri aldığı" sinyali DEĞERLİDİR.
  const { walletGap, peerCrossSell } = await computeWalletGapAndPeerCrossSell({
    custKod,
    scopeClause,
    ekGrupScopeClause: distScopeClause(options, "m.LNGDISTKOD"),
    // `getPeerAggregate` yalnız bu iki alanı okur (cache anahtarına da SADECE
    // bunlar girer, bkz. `peer-aggregate.ts` `peerAggregateCacheKey`);
    // `options`'ı OLDUĞU GİBİ geçirmek (musteriKod dahil) çağrı sözleşmesini
    // bulanıklaştırırdı.
    peerScope: { allowedDistKods: options.allowedDistKods, distId: options.distId },
    ownedUrunKods,
  });

  // Cross-sell (v1), müşterinin TÜM (365g) sahip olduğu ürün kodlarını hariç
  // tutar — geçmişi boşsa (yeni müşteri) sorguyu hiç çalıştırmaya gerek yok.
  const crossSell =
    ownedUrunKods.length > 0
      ? await fetchCrossSell(custKod, ownedUrunKods, scopeClause).catch((err) => {
          console.error("[reorder] fetchCrossSell failed:", err);
          return [] as CrossSellItem[];
        })
      : [];

  return {
    musteriKod: custKod,
    generatedAt: new Date().toISOString(),
    overdue,
    winBack,
    crossSell,
    ...(walletGap ? { walletGap } : {}),
    ...(peerCrossSell ? { peerCrossSell } : {}),
    ozet: {
      toplamGecikmis: overdue.length,
      toplamWinback: winBack.length,
      toplamCross: crossSell.length,
      ...(walletGap ? { gapSayi: walletGap.length } : {}),
      ...(peerCrossSell ? { peerCrossSayi: peerCrossSell.length } : {}),
    },
  };
}
