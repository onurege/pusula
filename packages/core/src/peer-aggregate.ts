/**
 * Akran (peer) agregatı — Sipariş Öneri v2'nin wallet-share/kapsam-açığı ve
 * peer-cross-sell sinyallerinin veri kaynağı.
 *
 * MÜŞTERİ-BAĞIMSIZ: bir ek-grup (`TBLMUSTERI.TXTEKGRUPKOD` — Faz 0 A2:
 * "bölge" alanı ölü, ek-grup %100 dolu/41 grup, akran ekseni budur) için
 * "bu gruptaki müşteriler hangi kategoriden/üründen ne kadar ve kaç kişi
 * alıyor" agregatını üretir. Tek bir hedef müşteriye özgü DEĞİLDİR — bu
 * yüzden ek-grup + dist-scope başına BİR KEZ hesaplanıp CACHE'lenir, sonra
 * o ek-gruptaki her müşterinin reorder isteği aynı cache satırını okur.
 *
 * NEDEN CACHE ZORUNLU (Faz 0 B1 — VETO): tek ek-grup için canlı agregasyon
 * ölçüldü: 10.5 sn (`TBLMSDBELGEDETAY` 27.36M satır). Bu, per-request bütçesinin
 * (hedef <1.5sn) ~7 katı — CANLI/PER-REQUEST AKRAN SORGUSU YASAK. Bu modülün
 * "sıcak yol"u (`getPeerAggregate`) SADECE cache okur; hesaplama YALNIZ
 * `warmPeerAggregates()` üzerinden (gece batch / demo bake) tetiklenir —
 * komuta.ts'teki gece-warm / manuel-refresh ayrımıyla AYNI desen.
 *
 * ANTİ-ÖRNEK UYARISI (Faz 0 D2): `foresight.ts` GETDATE() + scope'suz sorgu
 * kullanıyor — buradaki sorgular `sqlNow()` (donuk-saat anchor, NOW_MODE=
 * max-invoice) VE `distScopeClause` (dist-scope, `scope-clause.ts`) ile
 * yazılır; ikisi de KOPYALANMAZ, foresight.ts'in yaptığı hatayı TEKRARLAMAZ.
 *
 * Güvenlik: yalnız SELECT (DDL/DML yok). k-anonimlik (C3) SQL `HAVING`
 * seviyesinde uygulanır (bastırılan satır DB'den hiç çıkmaz — veri
 * minimizasyonu) VE tüketici tarafında (`reorder.ts` sınıflandırma
 * fonksiyonları) bir kez daha savunma-derinliği olarak tekrarlanır.
 */
import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";
import { distScopeClause } from "./scope-clause.js";
import { cachedRead, cachedWrite, makeCacheKey } from "./cache.js";

// ---------------------------------------------------------------------------
// Eşik/limit sabitleri — NAMED const, keyfi büyülü sayı yok (Faz 0 E1 — QA veto).
// ---------------------------------------------------------------------------

/**
 * k-anonimlik tabanı — bir kategori/ürünü SATIN ALAN akran müşteri sayısı
 * bundan AZSA o satır tamamen bastırılır (SQL `HAVING`'de). Amaç: tekil
 * (ör. tek bir rakip bayi) müşteri sepetinin ifşa edilmemesi (Faz 0 C3).
 */
export const PEER_MIN_KISI = 5;

/**
 * Bir wallet-gap/peer-cross-sell önerisinin YÜZEYE ÇIKMASI için akranların
 * en az bu ORANDA (kesir, 0..1) satın almış olması gerekir — aksi halde
 * sinyal çok zayıf/gürültülü sayılır. 0.30 = akranların en az %30'u.
 * NOT: eşik burada KESİR (0..1); dışa dönen `peerPenetrasyon` alanı ise
 * UI sözleşmesi gereği YÜZDE (0..100) — bkz. `reorder.ts` dönüşüm noktası.
 */
export const PEER_MIN_PENETRASYON = 0.3;

/**
 * Akran penceresi — `reorder.ts`'teki `HISTORY_WINDOW_DAYS` (365) ile AYNI
 * DEĞER, bilerek. Müşterinin kendi 365 günlük kategori cirosu akranların
 * AYNI 365 günlük ortalamasıyla kıyaslanır (elma-elma); farklı pencere
 * seçilirse wallet-gap karşılaştırması anlamsızlaşır. Import ile bağlamak
 * `peer-aggregate.ts` ↔ `reorder.ts` dairesel bağımlılığı yaratır (bkz.
 * `scope-clause.ts` dosya-üstü notu) — bu yüzden değer BİLİNÇLİ OLARAK
 * kopyalanır, sabit isimlerin ikisi de bu yorumla birbirine referans verir.
 */
const PEER_WINDOW_DAYS = 365;

/** Cache'lenecek kategori sayısı üst sınırı — TBLURUNEKGRUP zaten küçük
 *  (~15-20 gerçek kategori), bu yalnız savunma amaçlı bir tavan. */
const PEER_CATEGORY_TOP = 50;

/** Cache'lenecek ürün sayısı üst sınırı — peer-cross-sell adayları
 *  penetrasyona göre sıralanıp bu sayıda kesilir (cache satırı şişmesin). */
const PEER_PRODUCT_TOP = 200;

/** SQL string literal içine gömülmeden önce ek-grup kodunu kaçışlar — sunucu
 *  türevli bir değer olsa da (TBLMUSTERI'den okunur) savunma-derinliği. */
function escSql(v: string): string {
  return v.slice(0, 80).replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Public tipler
// ---------------------------------------------------------------------------

export type PeerCategoryAgg = {
  /** `TBLURUNEKGRUP.TXTKOD` (kategori kodu). */
  urunGrupKod: string;
  /** `TBLURUNEKGRUP.TXTAD` (kategori adı, ör. "Viski"). */
  urunGrupAd: string;
  /** Bu kategoriden en az bir kez alan DISTINCT akran müşteri sayısı. */
  peerMusteriSayi: number;
  /** Akran grubundaki TOPLAM aktif (pencerede en az 1 alım yapmış) müşteri
   *  sayısı — penetrasyon paydası. Her kategori satırında AYNI değer. */
  peerToplamMusteriSayi: number;
  /** Akranların bu kategoride TOPLAM net cirosu (`SUM(DBLNETFIYAT)`) —
   *  gerçek marj verisi YOK (Faz 0 A1), öncelik-skoru için ciro-proxy. */
  peerCiro: number;
};

export type PeerProductAgg = {
  urunKod: number;
  urunAd: string;
  peerMusteriSayi: number;
  peerToplamMusteriSayi: number;
  peerCiro: number;
};

export type PeerAggregateResult = {
  ekGrupKod: string;
  generatedAt: string;
  /** Akran grubundaki toplam aktif müşteri sayısı (k-anon kontrolü + UI için). */
  peerToplamMusteriSayi: number;
  categories: PeerCategoryAgg[];
  products: PeerProductAgg[];
};

// ---------------------------------------------------------------------------
// Canlı hesaplama (SADECE `warmPeerAggregates()` çağırır — sıcak yolda YOK)
// ---------------------------------------------------------------------------

/** Akran grubundaki toplam aktif (pencerede ≥1 alım) müşteri sayısı. */
async function fetchPeerTotalCustomers(
  ekGrupKod: string,
  scopeClause: string,
): Promise<number> {
  const kod = escSql(ekGrupKod);
  const query = `
    SELECT COUNT(DISTINCT f.LNGMUSTERIKOD) AS n
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMUSTERI m
      ON m.LNGKOD = f.LNGMUSTERIKOD
     AND m.BYTDURUM = 0
     AND LTRIM(RTRIM(m.TXTEKGRUPKOD)) = N'${kod}'
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -${PEER_WINDOW_DAYS}, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${scopeClause}
  `;
  const result = await runReadOnly(query, { limit: 1, timeoutMs: 30_000 });
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Kategori bazlı akran agregatı. `TBLURUNEKGRUP` filtresi `komuta.ts`'teki
 * "gerçek kategori" filtresiyle AYNI (junk kodlar/adlar dışlanır — FATURA/
 * POSM/PAKET/HİZMET BEDELİ/RAKİP ÜRÜN/GAZOZ, '0' ile başlayan kodlar, TEST/
 * STANT adları) — kopyalanmadı, AYNI kriter tekrar türetildi çünkü iki dosya
 * arasında bu küçük filtreyi paylaşan ayrı bir modül yok (yanlış-soyutlama
 * riski: tek kullanım daha için üçüncü bir dosya açmaya değmez).
 */
async function fetchPeerCategoryAgg(
  ekGrupKod: string,
  scopeClause: string,
): Promise<PeerCategoryAgg[]> {
  const kod = escSql(ekGrupKod);
  const query = `
    SELECT
      LTRIM(RTRIM(u.TXTURUNEKGRUPKOD)) AS urunGrupKod,
      MAX(eg.TXTAD) AS urunGrupAd,
      COUNT(DISTINCT f.LNGMUSTERIKOD) AS peerMusteriSayi,
      SUM(d.DBLNETFIYAT) AS peerCiro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMUSTERI m
      ON m.LNGKOD = f.LNGMUSTERIKOD
     AND m.BYTDURUM = 0
     AND LTRIM(RTRIM(m.TXTEKGRUPKOD)) = N'${kod}'
    INNER LOOP JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD AND u.BYTDURUM = 0
    INNER JOIN dbo.TBLURUNEKGRUP eg ON LTRIM(RTRIM(eg.TXTKOD)) = LTRIM(RTRIM(u.TXTURUNEKGRUPKOD))
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -${PEER_WINDOW_DAYS}, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${scopeClause}
      AND LTRIM(RTRIM(eg.TXTKOD)) <> '' AND LTRIM(RTRIM(eg.TXTKOD)) NOT LIKE '0%'
      AND UPPER(LTRIM(RTRIM(eg.TXTAD))) NOT IN (N'FATURA', N'POSM', N'PAKET', N'HİZMET BEDELİ', N'RAKİP ÜRÜN', N'GAZOZ')
      AND eg.TXTAD NOT LIKE N'%TEST%' AND eg.TXTAD NOT LIKE N'%STANT%'
    GROUP BY LTRIM(RTRIM(u.TXTURUNEKGRUPKOD))
    HAVING COUNT(DISTINCT f.LNGMUSTERIKOD) >= ${PEER_MIN_KISI}
    ORDER BY peerMusteriSayi DESC
  `;
  const result = await runReadOnly(query, { limit: PEER_CATEGORY_TOP, timeoutMs: 60_000 });
  return result.rows.map((r) => ({
    urunGrupKod: String(r.urunGrupKod ?? ""),
    urunGrupAd: String(r.urunGrupAd ?? ""),
    peerMusteriSayi: Number(r.peerMusteriSayi ?? 0),
    peerToplamMusteriSayi: 0, // çağıran (computePeerAggregateLive) doldurur
    peerCiro: Number(r.peerCiro ?? 0),
  }));
}

/** Ürün bazlı akran agregatı — peer-cross-sell adayları (penetrasyon-sıralı). */
async function fetchPeerProductAgg(
  ekGrupKod: string,
  scopeClause: string,
): Promise<PeerProductAgg[]> {
  const kod = escSql(ekGrupKod);
  const query = `
    SELECT TOP (${PEER_PRODUCT_TOP})
      d.LNGURUNKOD AS urunKod,
      MAX(u.TXTAD) AS urunAd,
      COUNT(DISTINCT f.LNGMUSTERIKOD) AS peerMusteriSayi,
      SUM(d.DBLNETFIYAT) AS peerCiro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMUSTERI m
      ON m.LNGKOD = f.LNGMUSTERIKOD
     AND m.BYTDURUM = 0
     AND LTRIM(RTRIM(m.TXTEKGRUPKOD)) = N'${kod}'
    INNER LOOP JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD AND u.BYTDURUM = 0
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -${PEER_WINDOW_DAYS}, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${scopeClause}
    GROUP BY d.LNGURUNKOD
    HAVING COUNT(DISTINCT f.LNGMUSTERIKOD) >= ${PEER_MIN_KISI}
    ORDER BY peerMusteriSayi DESC
  `;
  const result = await runReadOnly(query, { limit: PEER_PRODUCT_TOP, timeoutMs: 60_000 });
  return result.rows.map((r) => ({
    urunKod: Number(r.urunKod),
    urunAd: String(r.urunAd ?? ""),
    peerMusteriSayi: Number(r.peerMusteriSayi ?? 0),
    peerToplamMusteriSayi: 0, // çağıran doldurur
    peerCiro: Number(r.peerCiro ?? 0),
  }));
}

/**
 * Üç sorguyu SIRALI çalıştırıp (aynı ek-grup+scope için MSSQL'i paralel
 * fan-out ile boğmamak — Faz 0 B2 notu: "1 sıralı + paralel fan-out" ileri
 * bir optimizasyon, MVP'de sıralı yeterli, bu YALNIZ gece batch'te çalışır)
 * tek bir `PeerAggregateResult`'a birleştirir. `export` yalnız test erişimi
 * için (bkz. `__tests__/peer-aggregate.test.ts`) — normal akışta
 * `warmPeerAggregates()` çağırır, `getPeerAggregate()` DEĞİL (o cache okur).
 */
export async function computePeerAggregateLive(
  ekGrupKod: string,
  scope: { allowedDistKods?: number[] | null; distId?: number | null } = {},
): Promise<PeerAggregateResult> {
  const scopeClause = distScopeClause(scope);
  const peerToplamMusteriSayi = await fetchPeerTotalCustomers(ekGrupKod, scopeClause);
  const [categoriesRaw, productsRaw] = await Promise.all([
    fetchPeerCategoryAgg(ekGrupKod, scopeClause),
    fetchPeerProductAgg(ekGrupKod, scopeClause),
  ]);
  return {
    ekGrupKod,
    generatedAt: new Date().toISOString(),
    peerToplamMusteriSayi,
    categories: categoriesRaw.map((c) => ({ ...c, peerToplamMusteriSayi })),
    products: productsRaw.map((p) => ({ ...p, peerToplamMusteriSayi })),
  };
}

// ---------------------------------------------------------------------------
// Cache — segment-anahtarlı (ek-grup + dist-scope)
// ---------------------------------------------------------------------------

const CACHE_DOMAIN = "peer-aggregate";

/** Cache anahtarı: ek-grup + dist-scope birlikte — aksi halde bir dist'in
 *  akran verisi başka bir dist'in isteğine SIZAR (Faz 0 C2/C3). `distId`
 *  varsa tek-dist scope'u ifade eder, `allowedDistKods` merkez/Panorama
 *  kümesini; ikisi birden anahtara girer (`scopeSingleDistId` zaten
 *  `allowedDistKods`'u tek elemana indirger ama çağıranın hangi yoldan
 *  geldiğini ayırt etmek isteyebiliriz diye ikisi de saklanır). */
function peerAggregateCacheKey(
  ekGrupKod: string,
  scope: { allowedDistKods?: number[] | null; distId?: number | null },
): string {
  return makeCacheKey({
    ekGrupKod,
    distId: scope.distId ?? null,
    allowedDistKods: scope.allowedDistKods ? [...scope.allowedDistKods].sort((a, b) => a - b) : null,
  });
}

/**
 * SICAK YOL — SADECE cache okur, MSSQL'e HİÇ dokunmaz. Cache boşsa `null`
 * döner (10.5sn'lik canlı sorguyu asla per-request tetiklemez — Faz 0 B1
 * VETO). Çağıran (`reorder.ts`) null'ı "bu ek-grup için henüz ısıtılmamış"
 * olarak yorumlar ve walletGap/peerCrossSell alanlarını YOK SAYAR (v1
 * davranışına sessizce düşer).
 */
export async function getPeerAggregate(
  ekGrupKod: string,
  scope: { allowedDistKods?: number[] | null; distId?: number | null } = {},
): Promise<PeerAggregateResult | null> {
  const trimmed = ekGrupKod.trim();
  if (!trimmed) return null;
  const key = peerAggregateCacheKey(trimmed, scope);
  // `withCache` her zaman "miss ise hesapla" (read-through) davranışındadır;
  // bu modülde miss'te CANLI HESAPLAMA YASAK (Faz 0 B1 VETO) olduğu için
  // `withCache` DOĞRUDAN kullanılmaz — `cachedRead` ile SADECE okunur, miss
  // `null` olarak yorumlanır (hesaplama tetiklenmez).
  const hit = cachedRead<PeerAggregateResult>(CACHE_DOMAIN, key);
  return hit ? hit.payload : null;
}

/**
 * SOĞUK YOL (komuta desenindeki gece-warm ile AYNI kalıp) — gerçekten
 * MSSQL'e gidip hesaplar ve cache'e YAZAR. Gece batch job'ı (server.ts
 * `refreshAllSnapshots` benzeri bir adım olarak) ya da demo bake script'i
 * bunu çağırır. Bir ek-grup başarısız olursa DİĞERLERİNİ engellemez (`Promise
 * .allSettled` — tek bozuk kategori tüm gece-warm'ı düşürmesin).
 */
export async function warmPeerAggregates(
  ekGrupKods: string[],
  scope: { allowedDistKods?: number[] | null; distId?: number | null } = {},
): Promise<{ ok: string[]; failed: Array<{ ekGrupKod: string; error: string }> }> {
  const ok: string[] = [];
  const failed: Array<{ ekGrupKod: string; error: string }> = [];
  const results = await Promise.allSettled(
    ekGrupKods.map(async (kod) => {
      const value = await computePeerAggregateLive(kod, scope);
      cachedWrite(CACHE_DOMAIN, peerAggregateCacheKey(kod, scope), value);
      return kod;
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value);
    else failed.push({ ekGrupKod: ekGrupKods[i]!, error: (r.reason as Error).message });
  });
  return { ok, failed };
}

/**
 * DB'deki TÜM aktif ek-grup kodlarını listeler — `warmPeerAggregates()`'e
 * geçirilecek girdi listesi (gece job'ı "hangi ek-gruplar var" sorusunu
 * kendi çözsün, çağıran elle 41 kodu bilmek zorunda kalmasın).
 */
export async function listActiveEkGrupKods(): Promise<string[]> {
  const query = `
    SELECT DISTINCT LTRIM(RTRIM(TXTEKGRUPKOD)) AS kod
    FROM dbo.TBLMUSTERI
    WHERE BYTDURUM = 0 AND LTRIM(RTRIM(TXTEKGRUPKOD)) <> ''
  `;
  const result = await runReadOnly(query, { limit: 500, timeoutMs: 30_000 });
  // SQL zaten LTRIM/RTRIM uygular; JS tarafında TEKRAR `.trim()` savunma-
  // derinliği (sürücü/collation kaynaklı olası boşluk artıklarına karşı).
  return result.rows
    .map((r) => String(r.kod ?? "").trim())
    .filter((k) => k.length > 0);
}
