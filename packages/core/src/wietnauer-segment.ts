/**
 * Wietnauer Dashboard #3 — Müşteri Segmentasyon
 *
 * Üç bağımsız segment boyutu + bir cross-segment heatmap + iskonto kırılımı:
 *
 *   A) Müşteri Grubu — TBLMUSTERI.TXTGRUPKOD × TBLMUSTERIGRUP
 *      Bayi/kanal grubu (TEKEL, BÜFE, MARKET gibi TBLMUSTERIGRUP etiketi).
 *
 *   B) Müşteri Ek Grubu (bayilik formatı) — TBLSBMUSTERIEKGRUPBAGLANTI /
 *      TBLMUSTERI.TXTEKGRUPKOD (tenant'a göre m2m veya direct FK)
 *      Bakkal / Büfe / Market / Hipermarket / Franchise gibi format.
 *
 *   C) Müşteri Tipi (Ek Saha 8) — TBLMUSTERIEKSAHA × TBLEKSAHASECENEK
 *      Perakende / On Trade / Otel / Tali Bayi / OPA gibi kanal tipi.
 *      md24: önceden bu boyut yanlışlıkla TBLMUSTERIGRUP'tan besleniyordu
 *      (bkz. A) — gerçek Ek Saha 8 kaynağına düzeltildi.
 *
 *   D) Cirosal Segment (ciro-bazlı tüketici segmenti) — TBLCIROSALSEGMENTMUSTERI
 *      Wietnauer'da bu boyut dolu olmayabilir; UI empty-state ile karşılar.
 *      (md32'den beri sayfada gösterilmiyor, snapshot'ta hâlâ mevcut.)
 *
 *   E) Cross-segment: Müşteri Tipi × Marka — TBLMUSTERIEKSAHA × Marka tablosu
 *      Heatmap; her hücre o tip × marka kesişimindeki son 30g ciro payı.
 *
 *   F) İskonto Kırılımı (md35) — TBLMSDFATURA.DBLISKONTOTUTARI toplamı,
 *      Ek Grup (B'nin aynı bağlantı deseni) ve nokta (müşteri) bazında.
 *
 * SQL tabloları için NOT:
 *   - TBLMUSTERIEKSAHA join'i Komuta'da çalışan kanıtlı patternle aynı:
 *       me.LNGMUSTERIREF = m.LNGKOD AND me.LNGEKSAHAKODU = 8
 *       lk.LNGTAKIPKOD = 8 AND lk.LNGKOD = me.TXTEKSAHAACIKLAMA
 *   - TBLSBMUSTERIEKGRUPBAGLANTI / TXTEKGRUPKOD sütun adları tenant config'ten
 *     (`customerEkGrupLink`) gelir — Wietnauer "direct" (TBLMUSTERI.TXTEKGRUPKOD),
 *     Pernod "m2m" (köprü tablo).
 *   - TBLCIROSALSEGMENTMUSTERI etiketi `TXTSEGMENT` üzerinden gelir; boşsa
 *     fetcher boş array döner ve UI empty state'i render eder.
 *
 * Cache: full dataset (tüm dist'ler) TEK cache anahtarı — wietnauer-stok.ts
 * `scopedRows` deseni. Stratejik markalar D paneline girer (cross-segment
 * heatmap'te marka bazlı vurgu için, JS-post-processing olarak).
 */
import { withCache } from "./cache.js";
import { sqlNow } from "./now.js";
import { runReadOnly } from "./db.js";
import { getTenantConfig } from "./tenant/index.js";
import { cityColClause, cityCacheTag } from "./auth.js";

const CACHE_DOMAIN = "wietnauer-segment";
// v5: md24 — "ek saha" boyutu yanlışlıkla TBLMUSTERIGRUP'tan besleniyordu;
// gerçek TBLMUSTERIEKSAHA (saha 8) kaynağına taşındı ve eski TBLMUSTERIGRUP
// kırılımı "Müşteri Grubu" adıyla ayrı bir boyut olarak korundu (3 kırılım
// yan yana: müşteri grubu + ek grup + ek saha). md35 — ek grup ve nokta
// (müşteri) bazında iskonto tutarı kırılımı eklendi. Şema değiştiği için
// cache versiyonu artırıldı.
const CACHE_VERSION = "v5";

// ---------- Tipler ----------------------------------------------------------

/**
 * Ortak "tip bazlı segment" satırı — hem A) Müşteri Grubu hem C) Müşteri
 * Tipi (Ek Saha 8) aynı şekli kullanır; yalnızca kaynak SQL farklı.
 */
export type TipSegmentRow = {
  /** Lookup kodu (string). Tanımsız satırlar için "0". */
  kod: string;
  /** Okunabilir etiket. Lookup eşleşmezse "(Tanımsız)" düşer. */
  ad: string;
  musteriSayi: number;
  ciro: number;
  /** Bu tipin toplam ciro içindeki payı (%). */
  payPct: number;
  /** Ortalama iskonto oranı (%) — bu tipteki müşterilerin fatura başlığı
   *  ortalaması (SUM iskonto / SUM brüt × 100). */
  ortIskontoOraniPct: number;
};

/** A) Müşteri Grubu — TBLMUSTERIGRUP (TBLMUSTERI.TXTGRUPKOD). */
export type MusteriGrupSegmentRow = TipSegmentRow;

/** C) Müşteri Tipi (Ek Saha 8) — TBLMUSTERIEKSAHA × TBLEKSAHASECENEK. */
export type EkSahaSegmentRow = TipSegmentRow;

/** B) Müşteri Ek Grubu (bayilik formatı). */
export type EkGrupSegmentRow = {
  /** TBLMUSTERIEKGRUP.TXTKOD */
  kod: string;
  /** TBLMUSTERIEKGRUP.TXTAD — "BAKKAL", "MARKET", "FRANCHISE". */
  ad: string;
  musteriSayi: number;
  /** Son 30g fatura kesilmiş distinct müşteri sayısı — aktiflik metriği. */
  aktifMusteriSayi: number;
  /** aktif / toplam × 100. */
  aktifMusteriOraniPct: number;
  ciro: number;
  payPct: number;
};

/** D) Cirosal Segment — Wietnauer'da boş olabilir. */
export type CirosalSegmentRow = {
  /** TBLCIROSALSEGMENTMUSTERI.TXTSEGMENT — "A", "B", "C", "VIP" gibi. */
  segment: string;
  musteriSayi: number;
  ciro: number;
  payPct: number;
};

/** E) Cross-segment heatmap hücresi — Müşteri Tipi × Marka. */
export type SegmentBrandCell = {
  tipKod: string;
  tipAd: string;
  marka: string;
  markaKod: string;
  ciro: number;
  /** Tüm grid içindeki global pay (%). */
  payPct: number;
  isStratejik: boolean;
};

/** F) md35 — Ek Grup bazında iskonto tutarı kırılımı. */
export type EkGrupIskontoRow = {
  kod: string;
  ad: string;
  /** SUM(TBLMSDFATURA.DBLISKONTOTUTARI) — son 30g. */
  iskontoTutari: number;
  /** SUM(DBLNETTUTAR) — bağlam için. */
  ciro: number;
  /** iskonto / brüt × 100. */
  iskontoOraniPct: number;
  /** Toplam iskonto içindeki payı (%). */
  payPct: number;
};

/** F) md35 — Nokta (müşteri) bazında iskonto tutarı kırılımı (Top 20). */
export type MusteriIskontoRow = {
  musteriKod: number;
  /** TBLMUSTERI.TXTUNVAN */
  unvan: string;
  /** Müşterinin bağlı olduğu Ek Grup adı (varsa). */
  ekGrupAd: string | null;
  /** SUM(TBLMSDFATURA.DBLISKONTOTUTARI) — son 30g. */
  iskontoTutari: number;
  /** SUM(DBLNETTUTAR) — bağlam için. */
  ciro: number;
  /** iskonto / brüt × 100. */
  iskontoOraniPct: number;
  /** Tüm müşteriler arası toplam iskonto içindeki payı (%). */
  payPct: number;
  rank: number;
};

export type WietnauerSegmentSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  /** A) Müşteri Grubu — TBLMUSTERIGRUP. */
  musteriGrubu: MusteriGrupSegmentRow[];
  /** B) Müşteri Ek Grubu (bayilik formatı). */
  ekGrup: EkGrupSegmentRow[];
  /** C) Müşteri Tipi (Ek Saha 8). */
  ekSaha: EkSahaSegmentRow[];
  /** D) Cirosal segment — sayfada artık render edilmiyor (md32), snapshot'ta korunur. */
  cirosal: CirosalSegmentRow[];
  /** F) Ek Grup bazında iskonto tutarı kırılımı (md35). */
  ekGrupIskonto: EkGrupIskontoRow[];
  /** F) Nokta (müşteri) bazında iskonto tutarı kırılımı — Top 20 (md35). */
  musteriIskonto: MusteriIskontoRow[];
  /** E) Cross-segment heatmap; satırlar = müşteri tipi, sütunlar = marka. */
  cross: {
    tipler: string[];
    markalar: string[];
    cells: SegmentBrandCell[];
  };
};

// ---------- Fetcher'lar -----------------------------------------------------

type TipSegmentRawRow = {
  kod: string;
  ad: string;
  distId: number | null;
  musteriSayi: number;
  ciro: number;
  brut: number;
  iskonto: number;
};

/** dist-scope uygulanmış ham satırları tip bazında re-aggregate eder. Hem
 *  A) Müşteri Grubu hem C) Müşteri Tipi (Ek Saha 8) bu ortak fonksiyonu kullanır. */
function aggregateTipSegment(rows: TipSegmentRawRow[]): TipSegmentRow[] {
  const byTip = new Map<
    string,
    { kod: string; ad: string; musteriSayi: number; ciro: number; brut: number; iskonto: number }
  >();
  for (const row of rows) {
    const existing = byTip.get(row.kod);
    if (existing) {
      existing.musteriSayi += row.musteriSayi;
      existing.ciro += row.ciro;
      existing.brut += row.brut;
      existing.iskonto += row.iskonto;
    } else {
      byTip.set(row.kod, {
        kod: row.kod,
        ad: row.ad,
        musteriSayi: row.musteriSayi,
        ciro: row.ciro,
        brut: row.brut,
        iskonto: row.iskonto,
      });
    }
  }
  const toplamCiro = [...byTip.values()].reduce((a, t) => a + t.ciro, 0);
  return [...byTip.values()]
    .sort((a, b) => (b.ciro - a.ciro) || (b.musteriSayi - a.musteriSayi))
    .map((t) => ({
      kod: t.kod,
      ad: t.ad,
      musteriSayi: t.musteriSayi,
      ciro: t.ciro,
      payPct: toplamCiro > 0 ? Number(((t.ciro / toplamCiro) * 100).toFixed(2)) : 0,
      ortIskontoOraniPct: t.brut > 0 ? Number(((t.iskonto / t.brut) * 100).toFixed(2)) : 0,
    }));
}

/**
 * A) Müşteri Grubu (TBLMUSTERI.TXTGRUPKOD × TBLMUSTERIGRUP).
 *
 * Müşteri sayısı: o grupta tanımlı distinct müşteri (BYTDURUM=0).
 * Ciro: son 30g fatura net toplamı, KAPALI PENCERE.
 * İskonto oranı: SUM(iskonto) / SUM(brüt) × 100 — fatura başlığı bazlı.
 *
 * Scope-free ham satırlar — dist_id hem `musteri_tip` (TBLMUSTERI.LNGDISTKOD)
 * hem `fatura_30g` (f.LNGDISTKOD) için eklendi. Grup sayısı küçük (~10 grup)
 * × 31 dist ≈ 310 satır max — ucuz. pay%/iskonto oranı scope SONRASI public
 * API'de hesaplanır.
 */
async function fetchMusteriGrupSegmentRaw(cities?: string[] | null): Promise<TipSegmentRawRow[]> {
  const sql = `
    WITH musteri_tip AS (
      SELECT
        m.LNGKOD AS musteri_kod,
        m.LNGDISTKOD AS dist_id,
        ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Tanımsız)') AS tip_ad,
        ISNULL(NULLIF(LTRIM(RTRIM(m.TXTGRUPKOD)), ''), '0') AS tip_kod
      FROM dbo.TBLMUSTERI m
      LEFT JOIN dbo.TBLMUSTERIGRUP g ON g.TXTKOD = m.TXTGRUPKOD
      WHERE m.BYTDURUM = 0${cityColClause(cities, "m.TXTSEHIR")}
    ),
    fatura_30g AS (
      SELECT
        mt.tip_kod,
        mt.tip_ad,
        f.LNGDISTKOD AS dist_id,
        SUM(f.DBLNETTUTAR) AS ciro,
        SUM(f.DBLBRUTTUTAR) AS brut,
        SUM(f.DBLISKONTOTUTARI) AS iskonto
      FROM dbo.TBLMSDFATURA f
      INNER JOIN musteri_tip mt ON mt.musteri_kod = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      GROUP BY mt.tip_kod, mt.tip_ad, f.LNGDISTKOD
    ),
    musteri_sayi AS (
      SELECT tip_kod, tip_ad, dist_id, COUNT(*) AS musteri_sayi
      FROM musteri_tip
      GROUP BY tip_kod, tip_ad, dist_id
    ),
    combos AS (
      SELECT tip_kod, tip_ad, dist_id FROM musteri_sayi
      UNION
      SELECT tip_kod, tip_ad, dist_id FROM fatura_30g
    )
    SELECT
      c.tip_kod AS kod,
      c.tip_ad AS ad,
      c.dist_id,
      ISNULL(ms.musteri_sayi, 0) AS musteri_sayi,
      ISNULL(f.ciro, 0) AS ciro,
      ISNULL(f.brut, 0) AS brut,
      ISNULL(f.iskonto, 0) AS iskonto
    FROM combos c
    LEFT JOIN musteri_sayi ms ON ms.tip_kod = c.tip_kod AND ms.tip_ad = c.tip_ad AND ms.dist_id = c.dist_id
    LEFT JOIN fatura_30g f ON f.tip_kod = c.tip_kod AND f.tip_ad = c.tip_ad AND f.dist_id = c.dist_id
    ORDER BY ISNULL(f.ciro, 0) DESC, ISNULL(ms.musteri_sayi, 0) DESC
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    kod: String(r.kod ?? "0"),
    ad: String(r.ad ?? "(Tanımsız)"),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    musteriSayi: Number(r.musteri_sayi ?? 0),
    ciro: Number(r.ciro ?? 0),
    brut: Number(r.brut ?? 0),
    iskonto: Number(r.iskonto ?? 0),
  }));
}

/**
 * C) Müşteri Tipi (Ek Saha 8) — TBLMUSTERIEKSAHA × TBLEKSAHASECENEK.
 *
 * Komuta'da kanıtlı join pattern (bkz. komuta.ts fetchChannelByCustomerType):
 * TBLMUSTERIEKSAHA satırının `TXTEKSAHAACIKLAMA` sütunu seçenek kodunu
 * STRING olarak tutar; TBLEKSAHASECENEK.LNGKOD (LNGTAKIPKOD=8) ile eşleşir.
 * Müşterinin Ek Saha 8 satırı yoksa "(Tanımsız)" düşer.
 *
 * Müşteri sayısı: o tipte tanımlı distinct müşteri (BYTDURUM=0) — ek saha
 * satırı olmayanlar da "(Tanımsız)" grubunda sayılır (LEFT JOIN).
 * Ciro/iskonto oranı: A) ile aynı desen, son 30g KAPALI PENCERE.
 *
 * Scope-free ham satırlar — dist_id hem müşteri-master hem fatura tarafı
 * için eklendi. Ek Saha 8 seçenek sayısı küçük (~10) × 31 dist ≈ 310 satır.
 */
async function fetchEkSahaSegmentRaw(cities?: string[] | null): Promise<TipSegmentRawRow[]> {
  const sql = `
    WITH lookup AS (
      SELECT CAST(LNGKOD AS NVARCHAR(20)) AS kod, TXTACIKLAMA AS adi
      FROM dbo.TBLEKSAHASECENEK
      WHERE LNGTAKIPKOD = 8
    ),
    musteri_tip AS (
      SELECT
        m.LNGKOD AS musteri_kod,
        m.LNGDISTKOD AS dist_id,
        ISNULL(NULLIF(LTRIM(RTRIM(l.adi)), ''), '(Tanımsız)') AS tip_ad,
        ISNULL(NULLIF(LTRIM(RTRIM(me.TXTEKSAHAACIKLAMA)), ''), '0') AS tip_kod
      FROM dbo.TBLMUSTERI m
      LEFT JOIN dbo.TBLMUSTERIEKSAHA me
        ON me.LNGMUSTERIREF = m.LNGKOD AND me.LNGEKSAHAKODU = 8
      LEFT JOIN lookup l ON l.kod = LTRIM(RTRIM(me.TXTEKSAHAACIKLAMA))
      WHERE m.BYTDURUM = 0${cityColClause(cities, "m.TXTSEHIR")}
    ),
    fatura_30g AS (
      SELECT
        mt.tip_kod,
        mt.tip_ad,
        f.LNGDISTKOD AS dist_id,
        SUM(f.DBLNETTUTAR) AS ciro,
        SUM(f.DBLBRUTTUTAR) AS brut,
        SUM(f.DBLISKONTOTUTARI) AS iskonto
      FROM dbo.TBLMSDFATURA f
      INNER JOIN musteri_tip mt ON mt.musteri_kod = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      GROUP BY mt.tip_kod, mt.tip_ad, f.LNGDISTKOD
    ),
    musteri_sayi AS (
      SELECT tip_kod, tip_ad, dist_id, COUNT(*) AS musteri_sayi
      FROM musteri_tip
      GROUP BY tip_kod, tip_ad, dist_id
    ),
    combos AS (
      SELECT tip_kod, tip_ad, dist_id FROM musteri_sayi
      UNION
      SELECT tip_kod, tip_ad, dist_id FROM fatura_30g
    )
    SELECT
      c.tip_kod AS kod,
      c.tip_ad AS ad,
      c.dist_id,
      ISNULL(ms.musteri_sayi, 0) AS musteri_sayi,
      ISNULL(f.ciro, 0) AS ciro,
      ISNULL(f.brut, 0) AS brut,
      ISNULL(f.iskonto, 0) AS iskonto
    FROM combos c
    LEFT JOIN musteri_sayi ms ON ms.tip_kod = c.tip_kod AND ms.tip_ad = c.tip_ad AND ms.dist_id = c.dist_id
    LEFT JOIN fatura_30g f ON f.tip_kod = c.tip_kod AND f.tip_ad = c.tip_ad AND f.dist_id = c.dist_id
    ORDER BY ISNULL(f.ciro, 0) DESC, ISNULL(ms.musteri_sayi, 0) DESC
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    kod: String(r.kod ?? "0"),
    ad: String(r.ad ?? "(Tanımsız)"),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    musteriSayi: Number(r.musteri_sayi ?? 0),
    ciro: Number(r.ciro ?? 0),
    brut: Number(r.brut ?? 0),
    iskonto: Number(r.iskonto ?? 0),
  }));
}

/**
 * B) Müşteri Ek Grubu — bayilik formatı (TBLMUSTERIEKGRUP × bağlantı).
 *
 * TBLSBMUSTERIEKGRUPBAGLANTI bir m2m ilişki tablosu; LNGMUSTERIKOD ile
 * TBLMUSTERI.LNGKOD'a, LNGGRUPKOD ile TBLMUSTERIEKGRUP.LNGKOD'a bağlanır.
 *
 * Aktif müşteri = son 30g'de en az 1 fatura kesmiş distinct müşteri.
 * Toplam müşteri = bu ek gruba bağlı tüm aktif müşteri kayıtları (BYTDURUM=0).
 */
type EkGrupSegmentRawRow = {
  kod: string;
  ad: string;
  distId: number | null;
  musteriSayi: number;
  aktifMusteri: number;
  ciro: number;
};

/** Ek grup ↔ müşteri bağlantı deseni — tenant'a göre m2m köprü ya da doğrudan
 *  FK. wietnauer-segment.ts içinde birden fazla fetcher bu deseni paylaşır
 *  (ekGrup segmenti + md35 iskonto kırılımları) — tek yerden üretilir. */
function ekGrupCustomerJoin(): string {
  const link = getTenantConfig().customerEkGrupLink ?? "direct";
  return link === "m2m"
    ? `FROM dbo.TBLMUSTERIEKGRUP eg
      INNER JOIN dbo.TBLSBMUSTERIEKGRUPBAGLANTI bg
        ON bg.LNGGRUPKOD = CAST(eg.TXTKOD AS INT)
      INNER JOIN dbo.TBLMUSTERI m
        ON m.LNGKOD = bg.LNGMUSTERIKOD`
    : `FROM dbo.TBLMUSTERI m
      INNER JOIN dbo.TBLMUSTERIEKGRUP eg ON eg.TXTKOD = m.TXTEKGRUPKOD`;
}

/**
 * Scope-free ham satırlar — dist_id hem müşteri-master tarafı
 * (TBLMUSTERI.LNGDISTKOD) hem fatura tarafı (f.LNGDISTKOD) için eklendi.
 * Grup sayısı küçük (~10-50) × 31 dist — ucuz.
 */
async function fetchEkGrupSegmentRaw(cities?: string[] | null): Promise<EkGrupSegmentRawRow[]> {
  // Müşteri → perakende format bağı tenant'a göre: Pernod doğrudan FK
  // (TBLMUSTERI.TXTEKGRUPKOD), Wietnauer m2m köprü. Pernod'da m2m yanlış
  // anahtar yüzünden 0 satır dönüyordu.
  const grupJoin = ekGrupCustomerJoin();
  const sql = `
    WITH grup_musterileri AS (
      SELECT
        eg.TXTKOD AS grup_kod,
        eg.TXTAD AS grup_ad,
        m.LNGKOD AS musteri_kod,
        m.LNGDISTKOD AS dist_id
      ${grupJoin}
      WHERE eg.BYTUYGULAMAYERI IN (0, 4)
        AND m.BYTDURUM = 0${cityColClause(cities, "m.TXTSEHIR")}
    ),
    grup_ciro AS (
      SELECT
        gm.grup_kod,
        f.LNGDISTKOD AS dist_id,
        SUM(f.DBLNETTUTAR) AS ciro,
        COUNT(DISTINCT f.LNGMUSTERIKOD) AS aktif_musteri
      FROM grup_musterileri gm
      INNER JOIN dbo.TBLMSDFATURA f ON f.LNGMUSTERIKOD = gm.musteri_kod
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      GROUP BY gm.grup_kod, f.LNGDISTKOD
    ),
    grup_sayi AS (
      SELECT grup_kod, grup_ad, dist_id, COUNT(DISTINCT musteri_kod) AS musteri_sayi
      FROM grup_musterileri
      GROUP BY grup_kod, grup_ad, dist_id
    ),
    combos AS (
      SELECT grup_kod, grup_ad, dist_id FROM grup_sayi
      UNION
      SELECT grup_kod, NULL AS grup_ad, dist_id FROM grup_ciro
    )
    SELECT
      gs.grup_kod AS kod,
      gs.grup_ad AS ad,
      gs.dist_id,
      ISNULL(gs.musteri_sayi, 0) AS musteri_sayi,
      ISNULL(gc.aktif_musteri, 0) AS aktif_musteri,
      ISNULL(gc.ciro, 0) AS ciro
    FROM grup_sayi gs
    LEFT JOIN grup_ciro gc ON gc.grup_kod = gs.grup_kod AND gc.dist_id = gs.dist_id
    ORDER BY ISNULL(gc.ciro, 0) DESC, gs.musteri_sayi DESC
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    kod: String(r.kod ?? ""),
    ad: String(r.ad ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    musteriSayi: Number(r.musteri_sayi ?? 0),
    aktifMusteri: Number(r.aktif_musteri ?? 0),
    ciro: Number(r.ciro ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları grup bazında re-aggregate eder. */
function aggregateEkGrupSegment(rows: EkGrupSegmentRawRow[]): EkGrupSegmentRow[] {
  const byGrup = new Map<
    string,
    { kod: string; ad: string; musteriSayi: number; aktifMusteri: number; ciro: number }
  >();
  for (const row of rows) {
    const existing = byGrup.get(row.kod);
    if (existing) {
      existing.musteriSayi += row.musteriSayi;
      existing.aktifMusteri += row.aktifMusteri;
      existing.ciro += row.ciro;
      if (!existing.ad && row.ad) existing.ad = row.ad;
    } else {
      byGrup.set(row.kod, { kod: row.kod, ad: row.ad, musteriSayi: row.musteriSayi, aktifMusteri: row.aktifMusteri, ciro: row.ciro });
    }
  }
  const toplamCiro = [...byGrup.values()].reduce((a, g) => a + g.ciro, 0);
  return [...byGrup.values()]
    .sort((a, b) => (b.ciro - a.ciro) || (b.musteriSayi - a.musteriSayi))
    .map((g) => ({
      kod: g.kod,
      ad: g.ad,
      musteriSayi: g.musteriSayi,
      aktifMusteriSayi: g.aktifMusteri,
      aktifMusteriOraniPct: g.musteriSayi > 0 ? Number(((g.aktifMusteri * 100) / g.musteriSayi).toFixed(2)) : 0,
      ciro: g.ciro,
      payPct: toplamCiro > 0 ? Number(((g.ciro / toplamCiro) * 100).toFixed(2)) : 0,
    }));
}

/**
 * C) Cirosal Segment — TBLCIROSALSEGMENTMUSTERI.TXTSEGMENT labelları üzerinden.
 *
 * Wietnauer DB'sinde bu tablo boş olabilir (cirosal segment programı kurulmamış);
 * boş döndürürse UI panelinde empty state render edilir.
 */
type CirosalSegmentRawRow = {
  segment: string;
  distId: number | null;
  musteriSayi: number;
  ciro: number;
};

/**
 * Scope-free ham satırlar — dist_id müşteri-master (TBLMUSTERI.LNGDISTKOD)
 * üzerinden hem müşteri-sayısı hem ciro tarafına eklendi.
 */
async function fetchCirosalSegmentRaw(cities?: string[] | null): Promise<CirosalSegmentRawRow[]> {
  const sql = `
    WITH segment_musteri AS (
      SELECT
        LTRIM(RTRIM(sc.TXTSEGMENT)) AS segment,
        sc.LNGMUSTERIKOD AS musteri_kod,
        m.LNGDISTKOD AS dist_id
      FROM dbo.TBLCIROSALSEGMENTMUSTERI sc
      LEFT JOIN dbo.TBLMUSTERI m ON m.LNGKOD = sc.LNGMUSTERIKOD
      WHERE sc.TXTSEGMENT IS NOT NULL AND LTRIM(RTRIM(sc.TXTSEGMENT)) <> ''${cityColClause(cities, "m.TXTSEHIR")}
    ),
    segment_ciro AS (
      SELECT
        sm.segment,
        f.LNGDISTKOD AS dist_id,
        SUM(f.DBLNETTUTAR) AS ciro
      FROM segment_musteri sm
      INNER JOIN dbo.TBLMSDFATURA f ON f.LNGMUSTERIKOD = sm.musteri_kod
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      GROUP BY sm.segment, f.LNGDISTKOD
    ),
    segment_sayi AS (
      SELECT segment, dist_id, COUNT(DISTINCT musteri_kod) AS musteri_sayi
      FROM segment_musteri
      GROUP BY segment, dist_id
    ),
    combos AS (
      SELECT segment, dist_id FROM segment_sayi
      UNION
      SELECT segment, dist_id FROM segment_ciro
    )
    SELECT
      c.segment,
      c.dist_id,
      ISNULL(ss.musteri_sayi, 0) AS musteri_sayi,
      ISNULL(sc.ciro, 0) AS ciro
    FROM combos c
    LEFT JOIN segment_sayi ss ON ss.segment = c.segment AND ss.dist_id = c.dist_id
    LEFT JOIN segment_ciro sc ON sc.segment = c.segment AND sc.dist_id = c.dist_id
    ORDER BY ISNULL(sc.ciro, 0) DESC, ISNULL(ss.musteri_sayi, 0) DESC
  `;
  try {
    const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 30_000 });
    return result.rows.map((r) => ({
      segment: String(r.segment ?? ""),
      distId: r.dist_id != null ? Number(r.dist_id) : null,
      musteriSayi: Number(r.musteri_sayi ?? 0),
      ciro: Number(r.ciro ?? 0),
    }));
  } catch (e) {
    // TBLCIROSALSEGMENTMUSTERI bazı kurumlarda hiç oluşturulmamış olabilir.
    // Schema-level hata = "veri yok" gibi davran.
    console.warn(
      "[wietnauer-segment] cirosal segment fetch failed, returning empty:",
      (e as Error).message,
    );
    return [];
  }
}

/** dist-scope uygulanmış ham satırları segment bazında re-aggregate eder. */
function aggregateCirosalSegment(rows: CirosalSegmentRawRow[]): CirosalSegmentRow[] {
  const bySegment = new Map<string, { segment: string; musteriSayi: number; ciro: number }>();
  for (const row of rows) {
    const existing = bySegment.get(row.segment);
    if (existing) {
      existing.musteriSayi += row.musteriSayi;
      existing.ciro += row.ciro;
    } else {
      bySegment.set(row.segment, { segment: row.segment, musteriSayi: row.musteriSayi, ciro: row.ciro });
    }
  }
  const toplamCiro = [...bySegment.values()].reduce((a, s) => a + s.ciro, 0);
  return [...bySegment.values()]
    .sort((a, b) => (b.ciro - a.ciro) || (b.musteriSayi - a.musteriSayi))
    .map((s) => ({
      segment: s.segment,
      musteriSayi: s.musteriSayi,
      ciro: s.ciro,
      payPct: toplamCiro > 0 ? Number(((s.ciro / toplamCiro) * 100).toFixed(2)) : 0,
    }));
}

/**
 * E) Cross-segment heatmap: Müşteri Tipi (Ek Saha 8) × Marka.
 *
 * Top 6 müşteri tipi × Top 10 marka grid. Her hücre = o kesişimin son 30g
 * ciro payı (tüm grid içindeki yüzde). Tip × marka kombinasyonu fatura
 * çıkarmamışsa hücre yok (UI 0 olarak gösterir).
 *
 * Marka tablosu tenant config'ten: Wietnauer'da TBLURUNGRUP, Pernod'da
 * TBLURUNEKGRUP.
 */
type SegmentBrandCrossRawRow = {
  tipKod: string;
  tipAd: string;
  markaKod: string;
  marka: string;
  distId: number | null;
  ciro: number;
};

/**
 * Tip × marka × dist ham satırları — scope-free. Top-6-tip/Top-10-marka
 * seçimi kaldırıldı (dist scope uygulanmadan seçilirse dist kullanıcının
 * kendi en çok sattığı tip/marka'lar heatmap'ten düşebilir); `f.LNGDISTKOD`
 * GROUP BY'a eklendi. Ölçüldü: tip×marka×dist ≈ 914 satır (30g) — ucuz.
 * Top-N seçimi + pay% scope SONRASI public API'de hesaplanır.
 */
async function fetchSegmentBrandCrossRaw(cities?: string[] | null): Promise<SegmentBrandCrossRawRow[]> {
  const tenant = getTenantConfig();
  const brandTable = tenant.brandTable;
  const joinCol = tenant.brandJoinColumn;
  // SQL injection emniyeti — config TypeScript union'dan.
  if (!["TBLURUNEKGRUP", "TBLURUNGRUP"].includes(brandTable))
    throw new Error(`Geçersiz brandTable: ${brandTable}`);
  if (!["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"].includes(joinCol))
    throw new Error(`Geçersiz brandJoinColumn: ${joinCol}`);

  const sql = `
    SELECT
      ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Tanımsız)') AS tip_ad,
      ISNULL(NULLIF(LTRIM(RTRIM(m.TXTGRUPKOD)), ''), '0') AS tip_kod,
      b.TXTKOD AS marka_kod,
      b.TXTAD AS marka,
      f.LNGDISTKOD AS dist_id,
      SUM(d.DBLNETFIYAT) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
    INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
    LEFT JOIN dbo.TBLMUSTERIGRUP g ON g.TXTKOD = m.TXTGRUPKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND m.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityColClause(cities, "m.TXTSEHIR")}
    GROUP BY
      ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Tanımsız)'),
      ISNULL(NULLIF(LTRIM(RTRIM(m.TXTGRUPKOD)), ''), '0'),
      b.TXTKOD, b.TXTAD, f.LNGDISTKOD
    ORDER BY SUM(d.DBLNETFIYAT) DESC
  `;
  const result = await runReadOnly(sql, { limit: 5000, timeoutMs: 60_000 });
  return result.rows.map((r) => ({
    tipKod: String(r.tip_kod ?? "0"),
    tipAd: String(r.tip_ad ?? "(Tanımsız)"),
    markaKod: String(r.marka_kod ?? ""),
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    ciro: Number(r.ciro ?? 0),
  }));
}

/**
 * dist-scope uygulanmış ham satırları tip × marka bazında re-aggregate eder,
 * Top 6 tip × Top 10 marka'yı seçer ve cross-cell'leri (yalnızca bu eksenler
 * içindeki kesişimler) üretir.
 */
function aggregateSegmentBrandCross(
  rows: SegmentBrandCrossRawRow[],
  strategicBrands: string[],
): { tipler: string[]; markalar: string[]; cells: SegmentBrandCell[] } {
  const stratSet = new Set(strategicBrands.map((b) => b.toLocaleLowerCase("tr")));

  const cellMap = new Map<
    string,
    { tipKod: string; tipAd: string; markaKod: string; marka: string; ciro: number }
  >();
  const tipTotals = new Map<string, { ad: string; total: number }>();
  const markaTotals = new Map<string, { ad: string; total: number }>();
  for (const row of rows) {
    const cellKey = `${row.tipKod}|${row.markaKod}`;
    const cell = cellMap.get(cellKey);
    if (cell) {
      cell.ciro += row.ciro;
    } else {
      cellMap.set(cellKey, {
        tipKod: row.tipKod,
        tipAd: row.tipAd,
        markaKod: row.markaKod,
        marka: row.marka,
        ciro: row.ciro,
      });
    }
    const tipEntry = tipTotals.get(row.tipKod);
    if (tipEntry) tipEntry.total += row.ciro;
    else tipTotals.set(row.tipKod, { ad: row.tipAd, total: row.ciro });
    const markaEntry = markaTotals.get(row.markaKod);
    if (markaEntry) markaEntry.total += row.ciro;
    else markaTotals.set(row.markaKod, { ad: row.marka, total: row.ciro });
  }

  const topTipKods = new Set(
    [...tipTotals.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6).map(([kod]) => kod),
  );
  const topMarkaKods = new Set(
    [...markaTotals.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([kod]) => kod),
  );

  const selectedCells = [...cellMap.values()].filter(
    (c) => topTipKods.has(c.tipKod) && topMarkaKods.has(c.markaKod),
  );
  const toplamCiro = selectedCells.reduce((a, c) => a + c.ciro, 0);

  const cells: SegmentBrandCell[] = selectedCells
    .sort((a, b) => b.ciro - a.ciro)
    .map((c) => ({
      tipKod: c.tipKod,
      tipAd: c.tipAd,
      marka: c.marka,
      markaKod: c.markaKod,
      ciro: c.ciro,
      payPct: toplamCiro > 0 ? Number(((c.ciro / toplamCiro) * 100).toFixed(2)) : 0,
      isStratejik: stratSet.has(c.marka.toLocaleLowerCase("tr")),
    }));

  const tipler = [...topTipKods]
    .map((kod) => tipTotals.get(kod)!)
    .sort((a, b) => b.total - a.total)
    .map((t) => t.ad);
  const markalar = [...topMarkaKods]
    .map((kod) => markaTotals.get(kod)!)
    .sort((a, b) => b.total - a.total)
    .map((m) => m.ad);

  return { tipler, markalar, cells };
}

/**
 * F) md35 — Ek Grup bazında iskonto tutarı kırılımı.
 *
 * B) ile aynı müşteri↔ek grup bağlantı desenini (`ekGrupCustomerJoin`)
 * kullanır; farkı fatura toplamının SUM(DBLISKONTOTUTARI) olması.
 * m2m tenant'larda bir müşteri birden çok ek gruba bağlıysa iskontosu her
 * iki grubun toplamına da yansır — B) panelindeki ciro kırılımıyla aynı
 * (kasıtlı) davranış.
 */
type EkGrupIskontoRawRow = {
  kod: string;
  ad: string;
  distId: number | null;
  iskonto: number;
  brut: number;
  ciro: number;
};

async function fetchEkGrupIskontoRaw(cities?: string[] | null): Promise<EkGrupIskontoRawRow[]> {
  const grupJoin = ekGrupCustomerJoin();
  const sql = `
    WITH grup_musterileri AS (
      SELECT DISTINCT
        eg.TXTKOD AS grup_kod,
        eg.TXTAD AS grup_ad,
        m.LNGKOD AS musteri_kod,
        m.LNGDISTKOD AS dist_id
      ${grupJoin}
      WHERE eg.BYTUYGULAMAYERI IN (0, 4)
        AND m.BYTDURUM = 0${cityColClause(cities, "m.TXTSEHIR")}
    ),
    grup_iskonto AS (
      SELECT
        gm.grup_kod,
        f.LNGDISTKOD AS dist_id,
        SUM(f.DBLISKONTOTUTARI) AS iskonto,
        SUM(f.DBLBRUTTUTAR) AS brut,
        SUM(f.DBLNETTUTAR) AS ciro
      FROM grup_musterileri gm
      INNER JOIN dbo.TBLMSDFATURA f ON f.LNGMUSTERIKOD = gm.musteri_kod
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      GROUP BY gm.grup_kod, f.LNGDISTKOD
    ),
    grup_ad AS (
      SELECT grup_kod, grup_ad, dist_id
      FROM grup_musterileri
      GROUP BY grup_kod, grup_ad, dist_id
    ),
    combos AS (
      SELECT grup_kod, dist_id FROM grup_ad
      UNION
      SELECT grup_kod, dist_id FROM grup_iskonto
    )
    SELECT
      c.grup_kod AS kod,
      ga.grup_ad AS ad,
      c.dist_id,
      ISNULL(gi.iskonto, 0) AS iskonto,
      ISNULL(gi.brut, 0) AS brut,
      ISNULL(gi.ciro, 0) AS ciro
    FROM combos c
    LEFT JOIN grup_ad ga ON ga.grup_kod = c.grup_kod AND ga.dist_id = c.dist_id
    LEFT JOIN grup_iskonto gi ON gi.grup_kod = c.grup_kod AND gi.dist_id = c.dist_id
    ORDER BY ISNULL(gi.iskonto, 0) DESC
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    kod: String(r.kod ?? ""),
    ad: String(r.ad ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    iskonto: Number(r.iskonto ?? 0),
    brut: Number(r.brut ?? 0),
    ciro: Number(r.ciro ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları ek grup bazında re-aggregate eder. */
function aggregateEkGrupIskonto(rows: EkGrupIskontoRawRow[]): EkGrupIskontoRow[] {
  const byGrup = new Map<string, { kod: string; ad: string; iskonto: number; brut: number; ciro: number }>();
  for (const row of rows) {
    const existing = byGrup.get(row.kod);
    if (existing) {
      existing.iskonto += row.iskonto;
      existing.brut += row.brut;
      existing.ciro += row.ciro;
      if (!existing.ad && row.ad) existing.ad = row.ad;
    } else {
      byGrup.set(row.kod, { kod: row.kod, ad: row.ad, iskonto: row.iskonto, brut: row.brut, ciro: row.ciro });
    }
  }
  const toplamIskonto = [...byGrup.values()].reduce((a, g) => a + g.iskonto, 0);
  return [...byGrup.values()]
    .filter((g) => g.iskonto > 0 || g.ciro > 0)
    .sort((a, b) => b.iskonto - a.iskonto)
    .map((g) => ({
      kod: g.kod,
      ad: g.ad || "(Tanımsız)",
      iskontoTutari: g.iskonto,
      ciro: g.ciro,
      iskontoOraniPct: g.brut > 0 ? Number(((g.iskonto / g.brut) * 100).toFixed(2)) : 0,
      payPct: toplamIskonto > 0 ? Number(((g.iskonto / toplamIskonto) * 100).toFixed(2)) : 0,
    }));
}

/**
 * F) md35 — Nokta (müşteri) bazında iskonto tutarı kırılımı.
 *
 * Her müşterinin bağlı olduğu tek bir Ek Grup adı çözülür (m2m tenant'larda
 * birden çok grup varsa `ROW_NUMBER` ile deterministik ilki seçilir — B)/F)
 * panellerindeki grup toplamlarını bu seçim ETKİLEMEZ, yalnızca bu satırda
 * gösterilecek bağlam etiketi için).
 *
 * Scope-free ham satırlar (wietnauer-iskonto.ts fetchDiscountTopCustomersRaw
 * ile aynı desen) — Top 20 seçimi scope SONRASI public API'de yapılır.
 */
type MusteriIskontoRawRow = {
  musteriKod: number;
  distId: number | null;
  unvan: string;
  ekGrupAd: string | null;
  iskonto: number;
  brut: number;
  ciro: number;
};

async function fetchMusteriIskontoRaw(cities?: string[] | null): Promise<MusteriIskontoRawRow[]> {
  const grupJoin = ekGrupCustomerJoin();
  const sql = `
    WITH musteri_grup AS (
      SELECT musteri_kod, grup_ad,
        ROW_NUMBER() OVER (PARTITION BY musteri_kod ORDER BY grup_kod) AS rn
      FROM (
        SELECT DISTINCT eg.TXTKOD AS grup_kod, eg.TXTAD AS grup_ad, m.LNGKOD AS musteri_kod
        ${grupJoin}
        WHERE eg.BYTUYGULAMAYERI IN (0, 4) AND m.BYTDURUM = 0
      ) x
    )
    SELECT
      f.LNGMUSTERIKOD AS musteri_kod,
      f.LNGDISTKOD AS dist_id,
      m.TXTUNVAN AS unvan,
      mg.grup_ad AS ek_grup_ad,
      SUM(f.DBLISKONTOTUTARI) AS iskonto,
      SUM(f.DBLBRUTTUTAR) AS brut,
      SUM(f.DBLNETTUTAR) AS ciro
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
    LEFT JOIN musteri_grup mg ON mg.musteri_kod = f.LNGMUSTERIKOD AND mg.rn = 1
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND m.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
      AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
      AND f.DBLISKONTOTUTARI > 0${cityColClause(cities, "m.TXTSEHIR")}
    GROUP BY f.LNGMUSTERIKOD, f.LNGDISTKOD, m.TXTUNVAN, mg.grup_ad
    ORDER BY SUM(f.DBLISKONTOTUTARI) DESC
  `;
  const result = await runReadOnly(sql, { limit: 20_000, timeoutMs: 60_000 });
  return result.rows.map((r) => ({
    musteriKod: Number(r.musteri_kod),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    unvan: String(r.unvan ?? ""),
    ekGrupAd: r.ek_grup_ad ? String(r.ek_grup_ad) : null,
    iskonto: Number(r.iskonto ?? 0),
    brut: Number(r.brut ?? 0),
    ciro: Number(r.ciro ?? 0),
  }));
}

/** dist-scope uygulanmış satırları iskonto DESC sıralayıp Top 20'yi hesaplar. */
function aggregateMusteriIskonto(rows: MusteriIskontoRawRow[]): MusteriIskontoRow[] {
  const toplamIskonto = rows.reduce((a, r) => a + r.iskonto, 0);
  return [...rows]
    .sort((a, b) => b.iskonto - a.iskonto)
    .slice(0, 20)
    .map((r, i) => ({
      musteriKod: r.musteriKod,
      unvan: r.unvan,
      ekGrupAd: r.ekGrupAd,
      iskontoTutari: r.iskonto,
      ciro: r.ciro,
      iskontoOraniPct: r.brut > 0 ? Number(((r.iskonto / r.brut) * 100).toFixed(2)) : 0,
      payPct: toplamIskonto > 0 ? Number(((r.iskonto / toplamIskonto) * 100).toFixed(2)) : 0,
      rank: i + 1,
    }));
}

// ---------- Public API ------------------------------------------------------

type RawSegmentBundle = {
  musteriGrubu: TipSegmentRawRow[];
  ekGrup: EkGrupSegmentRawRow[];
  ekSaha: TipSegmentRawRow[];
  cirosal: CirosalSegmentRawRow[];
  ekGrupIskonto: EkGrupIskontoRawRow[];
  musteriIskonto: MusteriIskontoRawRow[];
  cross: SegmentBrandCrossRawRow[];
  generatedAt: string;
};

/**
 * Cache stratejisi: full dataset (tüm dist'ler) TEK cache anahtarı
 * (`${CACHE_VERSION}-30g-all`) altında çekilir — wietnauer-stok.ts'teki
 * `scopedRows` deseniyle aynı. Dist filtresi/scope + stratejik marka vurgusu
 * runtime'da JS'te uygulanır; `strategicBrands` artık yalnızca post-processing
 * (cross heatmap `isStratejik` flag'i), cache key'e girmiyor.
 */
export async function getWietnauerSegmentSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    allowedDistKods?: number[] | null;
    distId?: number | null;
    /** Kullanıcının izinli şehirleri (null → kısıt yok). SQL'e semi-join
     * predikatı olarak uygulanır; cache key şehir kümesine göre ayrışır. */
    allowedCities?: string[] | null;
  } = {},
): Promise<WietnauerSegmentSnapshot> {
  const strategicBrands = options.strategicBrands ?? [];
  const cities = options.allowedCities ?? null;

  const cacheKey = `${CACHE_VERSION}-30g-${cityCacheTag(cities)}`;
  const result = await withCache<RawSegmentBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      // Yedi sorgu paralel — toplam latency max(her sorgu).
      const [musteriGrubu, ekGrup, ekSaha, cirosal, ekGrupIskonto, musteriIskonto, cross] = await Promise.all([
        fetchMusteriGrupSegmentRaw(cities),
        fetchEkGrupSegmentRaw(cities),
        fetchEkSahaSegmentRaw(cities),
        fetchCirosalSegmentRaw(cities),
        fetchEkGrupIskontoRaw(cities),
        fetchMusteriIskontoRaw(cities),
        fetchSegmentBrandCrossRaw(cities),
      ]);
      return {
        musteriGrubu,
        ekGrup,
        ekSaha,
        cirosal,
        ekGrupIskonto,
        musteriIskonto,
        cross,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const {
    musteriGrubu: rawMusteriGrubu,
    ekGrup: rawEkGrup,
    ekSaha: rawEkSaha,
    cirosal: rawCirosal,
    ekGrupIskonto: rawEkGrupIskonto,
    musteriIskonto: rawMusteriIskonto,
    cross: rawCross,
    generatedAt,
  } = result.value;

  // Yetki kapsamı — dist kullanıcı için önce izinli dist'lere daralt.
  const effectiveDistKods =
    options.distId != null ? [options.distId] : (options.allowedDistKods ?? null);
  const inScope = (distId: number | null): boolean => {
    if (effectiveDistKods == null) return true; // merkez, filtresiz
    if (effectiveDistKods.length === 0) return false; // izinli dist yok
    return distId != null && effectiveDistKods.includes(distId);
  };

  const musteriGrubu = aggregateTipSegment(rawMusteriGrubu.filter((r) => inScope(r.distId)));
  const ekGrup = aggregateEkGrupSegment(rawEkGrup.filter((r) => inScope(r.distId)));
  const ekSaha = aggregateTipSegment(rawEkSaha.filter((r) => inScope(r.distId)));
  const cirosal = aggregateCirosalSegment(rawCirosal.filter((r) => inScope(r.distId)));
  const ekGrupIskonto = aggregateEkGrupIskonto(rawEkGrupIskonto.filter((r) => inScope(r.distId)));
  const musteriIskonto = aggregateMusteriIskonto(rawMusteriIskonto.filter((r) => inScope(r.distId)));
  const cross = aggregateSegmentBrandCross(
    rawCross.filter((r) => inScope(r.distId)),
    strategicBrands,
  );

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    musteriGrubu,
    ekGrup,
    ekSaha,
    cirosal,
    ekGrupIskonto,
    musteriIskonto,
    cross,
  };
}
