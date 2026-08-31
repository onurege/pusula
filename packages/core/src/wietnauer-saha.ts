/**
 * Wietnauer Dashboard #5 — Distribütör & Saha Operasyon.
 *
 * 5 panel için snapshot:
 *   A) Günlük ziyaret trendi (rut içi vs rut dışı)
 *   B) Aktif müşteri kapsama oranı (+ segment kırılımı)
 *   C) Temsilci performansı (Top 20)
 *   D) Ziyaret → sipariş dönüşüm oranı
 *   E) Distribütör karşılaştırma (Top 10)
 *
 * --- Schema notları (Wietnauer test DB üzerinden doğrulandı) -----------------
 *
 * TBLPMPZIYARETBASLIK (ziyaret header):
 *   - `LNGMUSTERIKOD` — müşteri FK
 *   - `BYTRUTKODU`    — 0=rut içi, 1=rut dışı
 *   - `TRHGIRIS`      — ziyaret başlangıcı (NULL ise ziyaret yapılmadı, sadece planlandı)
 *   - `LNGOZETKOD`    — TBLPMPZIYARETOZET FK (rep/distkod buradan gelir)
 *   - DİKKAT: header'da `LNGSTKOD` veya `LNGDISTKOD` YOK.
 *
 * TBLPMPZIYARETOZET (saha temsilcisi günlük özeti):
 *   - `LNGKOD`     — özet PK
 *   - `LNGSTKOD`   — satış temsilcisi (TBLKULLANICI.LNGKOD)
 *   - `LNGDISTKOD` — distribütör
 *
 * TBLKULLANICI:
 *   - `LNGKOD`, `TXTADSOYAD` — temsilci adı buradan gelir. Wietnauer'da
 *     `TBLDISTPERSONEL` TABLOSU BOŞ; isim sadece `TBLKULLANICI`'dan alınabilir.
 *
 * TBLPMPZIYARETDETAY (ziyaret içinde kesilen belgeler):
 *   - `LNGBASLIKKOD` — TBLPMPZIYARETBASLIK FK
 *   - `BYTISLEMKODU` — 4=Fatura, 30=İrsaliye, 60=Sipariş
 *
 * TBLMUSTERIEKSAHA (müşteri tipi segmentasyonu):
 *   - Join: `LNGMUSTERIREF` = TBLMUSTERI.LNGKOD, filtre `LNGEKSAHAKODU = 8`
 *   - Değer: `TXTEKSAHAACIKLAMA` (string '1'/'2'…) → `TBLEKSAHASECENEK.LNGKOD`
 *
 * --- KAPALI PENCERE — Wietnauer-özel ----------------------------------------
 *
 * Wietnauer test DB'sinde ziyaret verisi DEMO_DATE'in (2026-04-17) ÖTESİNE
 * de uzanır — 18-21 Nisan kayıtları mevcut. Pernod'da kullanılan
 * `< DATEADD(day, 1, sqlNow())` pattern'i, sqlNow()='2026-04-17 23:59:59'
 * olduğu için '2026-04-18 23:59:59'a kadar her şeyi içine alır → DEMO_DATE'in
 * ötesini sızdırır (367 ziyaret).
 *
 * Bu modülde sıkı üst sınır olarak `<= sqlNow()` kullanılır. sqlNow() günün
 * sonunu (23:59:59) verdiği için DEMO_DATE'in 17 Nis verisinin tamamı dahil,
 * 18 Nis hiç dahil değil.
 */
import { runReadOnly } from "./db.js";
import { sqlNow } from "./now.js";
import { withCache } from "./cache.js";
import { getTenantConfig } from "./tenant/index.js";
import { cityFactClause, cityCacheTag } from "./auth.js";

const CACHE_DOMAIN = "wietnauer-saha";
// v5: cache-key scope fragmentation düzeltmesi (VYK-01) — dist filtresi
// SQL'den çıkarıldı; tüm fetcher'lar scope'suz (tüm dist) tek cache anahtarı
// altında çekilir, dist_id (TBLPMPZIYARETOZET.LNGDISTKOD / fatura'da
// f.LNGDISTKOD) SELECT/GROUP BY'a eklendi ki JS tarafı scope filtresi +
// re-aggregate yapabilsin (wietnauer-stok.ts `scopedRows` deseni). Ziyaret
// header'ında (TBLPMPZIYARETBASLIK) LNGDISTKOD yok — dist bilgisi
// TBLPMPZIYARETOZET (o) üzerinden gelir.
// v6: md41 — RepPerformanceRow'a aktifMusteri (fatura kesen distinct) eklendi.
const CACHE_VERSION = "v6";

// ---------- Tipler ----------------------------------------------------------

export type VisitDailyRow = {
  /** YYYY-MM-DD */
  gun: string;
  /** Toplam ziyaret (rut içi + rut dışı) */
  toplam: number;
  /** BYTRUTKODU=0 — planlı rut */
  rutIci: number;
  /** BYTRUTKODU=1 — rut dışı */
  rutDisi: number;
};

export type CoverageSegmentRow = {
  /** TBLEKSAHASECENEK.TXTACIKLAMA (örn "OFF-TRADE WHITE OUTLET") veya "(Tanımsız)" */
  segment: string;
  /** Son 30g'de ziyaret edilen distinct müşteri sayısı (bu segmentte) */
  ziyaretEdilen: number;
  /** Son 90g'de fatura kesilen distinct müşteri sayısı (aktif portföy) */
  aktif: number;
  /** ziyaretEdilen / aktif * 100 */
  kapsamaPct: number;
};

export type RepPerformanceRow = {
  /** TBLPMPZIYARETOZET.LNGSTKOD (TBLKULLANICI.LNGKOD) */
  repId: number;
  /** TBLKULLANICI.TXTADSOYAD — boşsa "Temsilci #<id>" */
  ad: string;
  /** TBLDIST.TXTAD */
  distributor: string | null;
  /** Son 30g ziyaret adedi */
  ziyaret: number;
  /** Son 30g unique müşteri ziyareti (ziyaret edilen) */
  uniqueMusteri: number;
  /** md41: Son 30g fatura kesilen distinct müşteri (aktif müşteri) —
   *  TBLMSDFATURA.LNGSTKOD üzerinden, ziyaret değil satış tabanlı. */
  aktifMusteri: number;
  /** Son 30g sipariş alınan distinct ziyaret sayısı */
  siparisliZiyaret: number;
  /** siparisliZiyaret / ziyaret * 100 */
  donusumPct: number;
  /** Son 30g rut dışı oranı (rutDisi / ziyaret * 100) */
  rutDisiPct: number;
  rank: number;
};

export type VisitConversionRow = {
  /** "Rut İçi" veya "Rut Dışı" */
  tip: "Rut İçi" | "Rut Dışı";
  /** Toplam ziyaret (son 30g) */
  ziyaret: number;
  /** Sipariş alınan distinct ziyaret (BYTISLEMKODU=60) */
  siparisli: number;
  /** Fatura kesilen distinct ziyaret (BYTISLEMKODU=4) */
  faturali: number;
  /** İrsaliye kesilen distinct ziyaret (BYTISLEMKODU=30) */
  irsaliyeli: number;
  /** siparisli / ziyaret * 100 */
  donusumPct: number;
};

export type DistributorComparisonRow = {
  distKod: number;
  distributor: string;
  /** Bölge (TBLDISTEKGRUP.TXTAD) */
  bolge: string | null;
  /** Son 30g aktif temsilci (en az 1 ziyaret yapan distinct LNGSTKOD) */
  aktifTemsilci: number;
  /** Son 30g toplam ziyaret */
  ziyaret: number;
  /** Son 30g ziyaret edilen distinct müşteri */
  kapsananMusteri: number;
  /** Sipariş dönüşüm oranı (siparisli ziyaret / toplam ziyaret * 100) */
  donusumPct: number;
  rank: number;
};

export type VisitKpi = {
  /** Son 7g toplam ziyaret */
  son7gZiyaret: number;
  /** Son 7g unique müşteri */
  son7gUniqueMusteri: number;
  /** Son 7g unique aktif temsilci */
  son7gAktifTemsilci: number;
  /** Son 7g sipariş dönüşüm % */
  son7gDonusumPct: number;
};

export type WietnauerSahaSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  /** A panel — son 30g */
  visitDaily: VisitDailyRow[];
  /** Son 7g KPI özet */
  kpi: VisitKpi;
  /** B panel — segment kırılımı */
  coverage: {
    totalZiyaretEdilen: number;
    totalAktif: number;
    kapsamaPct: number;
    segments: CoverageSegmentRow[];
  };
  /** C panel — temsilci Top 20 */
  reps: RepPerformanceRow[];
  /** D panel — rut içi/dışı dönüşüm */
  conversion: VisitConversionRow[];
  /** E panel — Top 10 distribütör */
  distributors: DistributorComparisonRow[];
};

// ---------- Fetcher'lar -----------------------------------------------------

/**
 * Panel A — Günlük ziyaret trendi (son 30g, rut içi vs rut dışı).
 *
 * Pernod'un Komuta'da kullandığı `< DATEADD(day,1, sqlNow())` yerine `<= sqlNow()`
 * kullanılıyor — yukarıdaki schema notu bkz.
 */
type VisitDailyRawRow = VisitDailyRow & { distId: number | null };

/** Scope-free: dist_id GROUP BY'a eklendi (~31 dist × 30 gün ≈ 930 satır, ucuz). */
async function fetchVisitDaily(cities?: string[] | null): Promise<VisitDailyRawRow[]> {
  const sql = `
    SELECT
      o.LNGDISTKOD                                                AS dist_id,
      CAST(z.TRHGIRIS AS DATE)                                   AS gun,
      COUNT(*)                                                   AS toplam,
      SUM(CASE WHEN z.BYTRUTKODU = 0 THEN 1 ELSE 0 END)          AS rut_ici,
      SUM(CASE WHEN z.BYTRUTKODU = 1 THEN 1 ELSE 0 END)          AS rut_disi
    FROM dbo.TBLPMPZIYARETBASLIK AS z
    INNER JOIN dbo.TBLPMPZIYARETOZET AS o ON o.LNGKOD = z.LNGOZETKOD
    WHERE z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -30, ${sqlNow()})
      AND z.TRHGIRIS <= ${sqlNow()}${cityFactClause(cities, "z.LNGMUSTERIKOD")}
    GROUP BY o.LNGDISTKOD, CAST(z.TRHGIRIS AS DATE)
    ORDER BY gun
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 30_000 });
  return result.rows.map((r) => {
    // SQL Server `DATE` türü Node-mssql tarafında genelde Date olarak gelir.
    const raw = r.gun;
    const day =
      raw instanceof Date
        ? raw.toISOString().slice(0, 10)
        : String(raw ?? "").slice(0, 10);
    return {
      distId: r.dist_id != null ? Number(r.dist_id) : null,
      gun: day,
      toplam: Number(r.toplam ?? 0),
      rutIci: Number(r.rut_ici ?? 0),
      rutDisi: Number(r.rut_disi ?? 0),
    };
  });
}

/** dist-scope uygulanmış günlük ham satırları gün bazında re-aggregate eder. */
function aggregateVisitDaily(rows: VisitDailyRawRow[]): VisitDailyRow[] {
  const byDay = new Map<string, VisitDailyRow>();
  for (const row of rows) {
    const existing = byDay.get(row.gun);
    if (existing) {
      existing.toplam += row.toplam;
      existing.rutIci += row.rutIci;
      existing.rutDisi += row.rutDisi;
    } else {
      byDay.set(row.gun, { gun: row.gun, toplam: row.toplam, rutIci: row.rutIci, rutDisi: row.rutDisi });
    }
  }
  return [...byDay.values()].sort((a, b) => a.gun.localeCompare(b.gun));
}

type VisitKpi7gRawRow = {
  distId: number | null;
  ziyaret: number;
  uniqueMusteri: number;
  aktifRep: number;
  siparisli: number;
};

/**
 * Son 7g KPI özet ham satırları — dist bazında (COUNT DISTINCT'ler dist
 * sınırları içinde hesaplandığı için re-aggregate ederken unique_musteri /
 * aktif_rep TOPLAMLARI dist'ler arası kesişmeyeceğinden basit SUM ile
 * doğru sonuç verir — bir müşteri/rep birden fazla dist'e ait olamaz.
 */
async function fetchVisitKpi7g(cities?: string[] | null): Promise<VisitKpi7gRawRow[]> {
  const sql = `
    SELECT
      o.LNGDISTKOD                                               AS dist_id,
      COUNT(*)                                                   AS ziyaret,
      COUNT(DISTINCT z.LNGMUSTERIKOD)                            AS unique_musteri,
      COUNT(DISTINCT o.LNGSTKOD)                                 AS aktif_rep,
      COUNT(DISTINCT CASE WHEN sip.LNGBASLIKKOD IS NOT NULL
                          THEN z.LNGKOD END)                     AS siparisli
    FROM dbo.TBLPMPZIYARETBASLIK z
    INNER JOIN dbo.TBLPMPZIYARETOZET o ON o.LNGKOD = z.LNGOZETKOD
    LEFT JOIN (
      SELECT DISTINCT LNGBASLIKKOD
      FROM dbo.TBLPMPZIYARETDETAY
      WHERE BYTISLEMKODU = 60
    ) sip ON sip.LNGBASLIKKOD = z.LNGKOD
    WHERE z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -7, ${sqlNow()})
      AND z.TRHGIRIS <= ${sqlNow()}${cityFactClause(cities, "z.LNGMUSTERIKOD")}
    GROUP BY o.LNGDISTKOD
  `;
  const result = await runReadOnly(sql, { limit: 200, timeoutMs: 30_000 });
  return result.rows.map((r) => ({
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    ziyaret: Number(r.ziyaret ?? 0),
    uniqueMusteri: Number(r.unique_musteri ?? 0),
    aktifRep: Number(r.aktif_rep ?? 0),
    siparisli: Number(r.siparisli ?? 0),
  }));
}

/** dist-scope uygulanmış satırları toplayıp KPI'ya çevirir. */
function aggregateVisitKpi7g(rows: VisitKpi7gRawRow[]): VisitKpi {
  const ziyaret = rows.reduce((a, r) => a + r.ziyaret, 0);
  const uniqueMusteri = rows.reduce((a, r) => a + r.uniqueMusteri, 0);
  const aktifRep = rows.reduce((a, r) => a + r.aktifRep, 0);
  const siparisli = rows.reduce((a, r) => a + r.siparisli, 0);
  return {
    son7gZiyaret: ziyaret,
    son7gUniqueMusteri: uniqueMusteri,
    son7gAktifTemsilci: aktifRep,
    son7gDonusumPct: ziyaret > 0 ? Number(((siparisli / ziyaret) * 100).toFixed(2)) : 0,
  };
}

type CoverageRawRow = CoverageSegmentRow & { distId: number | null };

/**
 * Panel B ham satırları — segment × dist kırılımı (müşteri-seviyesi DISTINCT
 * SQL'de korunur, `dist_id` sadece hangi dist'in faturasından/ziyaretinden
 * geldiğini etiketler; bir müşteri fatura kestiği/ziyaret edildiği HER dist
 * için ayrı satırda sayılabilir — bu Wietnauer'da nadir, kabul edilebilir).
 *
 * Aktif tanımı: son 90g'de en az 1 fatura kesilmiş müşteri.
 * Kapsanan tanımı: son 30g'de en az 1 ziyaret edilmiş müşteri (TRHGIRIS IS NOT NULL).
 *
 * Segment = TBLMUSTERIGRUP.TXTAD (TBLMUSTERI.TXTGRUPKOD ile JOIN).
 * Müşterinin grubu yoksa "(Tanımsız)" altında raporlanır.
 */
async function fetchCoverage(cities?: string[] | null): Promise<CoverageRawRow[]> {
  const sql = `
    WITH aktif AS (
      SELECT DISTINCT f.LNGMUSTERIKOD, f.LNGDISTKOD AS dist_id
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -90, ${sqlNow()})
        AND f.TRHISLEMTARIHI <= ${sqlNow()}${cityFactClause(cities)}
    ),
    ziyaret AS (
      SELECT DISTINCT z.LNGMUSTERIKOD, o.LNGDISTKOD AS dist_id
      FROM dbo.TBLPMPZIYARETBASLIK z
      INNER JOIN dbo.TBLPMPZIYARETOZET o ON o.LNGKOD = z.LNGOZETKOD
      WHERE z.TRHGIRIS IS NOT NULL
        AND z.TRHGIRIS >= DATEADD(day, -30, ${sqlNow()})
        AND z.TRHGIRIS <= ${sqlNow()}${cityFactClause(cities, "z.LNGMUSTERIKOD")}
    ),
    musteri_seg AS (
      SELECT
        m.LNGKOD AS musteri_kod,
        ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Tanımsız)') AS segment
      FROM dbo.TBLMUSTERI m
      LEFT JOIN dbo.TBLMUSTERIGRUP g ON g.TXTKOD = m.TXTGRUPKOD
    ),
    dist_musteri AS (
      -- Her müşteri × dist kombinasyonu (aktif veya ziyaret kaynaklı).
      SELECT musteri_kod, dist_id FROM (
        SELECT LNGMUSTERIKOD AS musteri_kod, dist_id FROM aktif
        UNION
        SELECT LNGMUSTERIKOD AS musteri_kod, dist_id FROM ziyaret
      ) u
    )
    SELECT
      dm.dist_id,
      ms.segment,
      COUNT(DISTINCT CASE WHEN z.LNGMUSTERIKOD IS NOT NULL THEN dm.musteri_kod END) AS ziyaret_edilen,
      COUNT(DISTINCT CASE WHEN a.LNGMUSTERIKOD IS NOT NULL THEN dm.musteri_kod END) AS aktif
    FROM dist_musteri dm
    INNER JOIN musteri_seg ms ON ms.musteri_kod = dm.musteri_kod
    LEFT JOIN aktif a ON a.LNGMUSTERIKOD = dm.musteri_kod AND a.dist_id = dm.dist_id
    LEFT JOIN ziyaret z ON z.LNGMUSTERIKOD = dm.musteri_kod AND z.dist_id = dm.dist_id
    GROUP BY dm.dist_id, ms.segment
    ORDER BY dm.dist_id, aktif DESC, ziyaret_edilen DESC
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 60_000 });
  return result.rows.map((r) => {
    const ziyaretEdilen = Number(r.ziyaret_edilen ?? 0);
    const aktif = Number(r.aktif ?? 0);
    return {
      distId: r.dist_id != null ? Number(r.dist_id) : null,
      segment: String(r.segment ?? "(Tanımsız)"),
      ziyaretEdilen,
      aktif,
      kapsamaPct: aktif > 0 ? Number(((ziyaretEdilen / aktif) * 100).toFixed(2)) : 0,
    };
  });
}

/** dist-scope uygulanmış ham satırları segment bazında re-aggregate eder. */
function aggregateCoverage(rows: CoverageRawRow[]): WietnauerSahaSnapshot["coverage"] {
  const bySegment = new Map<string, { segment: string; ziyaretEdilen: number; aktif: number }>();
  for (const row of rows) {
    const existing = bySegment.get(row.segment);
    if (existing) {
      existing.ziyaretEdilen += row.ziyaretEdilen;
      existing.aktif += row.aktif;
    } else {
      bySegment.set(row.segment, {
        segment: row.segment,
        ziyaretEdilen: row.ziyaretEdilen,
        aktif: row.aktif,
      });
    }
  }
  const segments: CoverageSegmentRow[] = [...bySegment.values()]
    .map((s) => ({
      ...s,
      kapsamaPct: s.aktif > 0 ? Number(((s.ziyaretEdilen / s.aktif) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => (b.aktif - a.aktif) || (b.ziyaretEdilen - a.ziyaretEdilen));
  const totalZiyaretEdilen = segments.reduce((a, s) => a + s.ziyaretEdilen, 0);
  const totalAktif = segments.reduce((a, s) => a + s.aktif, 0);
  return {
    totalZiyaretEdilen,
    totalAktif,
    kapsamaPct:
      totalAktif > 0 ? Number(((totalZiyaretEdilen / totalAktif) * 100).toFixed(2)) : 0,
    segments,
  };
}

type RepPerformanceRawRow = Omit<RepPerformanceRow, "rank"> & { distId: number | null };

/**
 * Panel C ham satırları — tüm temsilciler (son 30g). `TOP 20` kaldırıldı;
 * dist scope uygulanmadan Top 20 kesilirse dist kullanıcının kendi
 * temsilcileri listeden düşebilir. JS tarafı scope + Top 20'yi public API'de
 * uygular. dist_id zaten `o.LNGDISTKOD` üzerinden GROUP BY'da.
 *
 * Temsilci adı `TBLKULLANICI.TXTADSOYAD` üzerinden gelir (TBLDISTPERSONEL boş).
 * Adsız rep'ler "Temsilci #<id>" fallback ile gösterilir.
 */
async function fetchRepPerformance(cities?: string[] | null): Promise<RepPerformanceRawRow[]> {
  const sql = `
    WITH baz AS (
      SELECT
        o.LNGSTKOD,
        o.LNGDISTKOD,
        z.LNGKOD                                                   AS ziyaret_kod,
        z.LNGMUSTERIKOD,
        z.BYTRUTKODU,
        CASE WHEN sip.LNGBASLIKKOD IS NOT NULL THEN 1 ELSE 0 END   AS siparis_var
      FROM dbo.TBLPMPZIYARETBASLIK z
      INNER JOIN dbo.TBLPMPZIYARETOZET o ON o.LNGKOD = z.LNGOZETKOD
      LEFT JOIN (
        SELECT DISTINCT LNGBASLIKKOD
        FROM dbo.TBLPMPZIYARETDETAY
        WHERE BYTISLEMKODU = 60
      ) sip ON sip.LNGBASLIKKOD = z.LNGKOD
      WHERE z.TRHGIRIS IS NOT NULL
        AND z.TRHGIRIS >= DATEADD(day, -30, ${sqlNow()})
        AND z.TRHGIRIS <= ${sqlNow()}${cityFactClause(cities, "z.LNGMUSTERIKOD")}
    ),
    -- md41: temsilci (LNGSTKOD) × dist bazında son 30g fatura kesilen distinct
    -- müşteri = "aktif müşteri". Ziyaret tablosundan bağımsız, satış tabanlı.
    fat AS (
      SELECT f.LNGSTKOD, f.LNGDISTKOD,
             COUNT(DISTINCT f.LNGMUSTERIKOD) AS aktif
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
      GROUP BY f.LNGSTKOD, f.LNGDISTKOD
    )
    SELECT
      b.LNGSTKOD                                                   AS rep_id,
      b.LNGDISTKOD                                                 AS dist_id,
      -- İsim öncelik: TBLPERSONEL.TXTAD (Wietnauer'da daha dolu),
      -- yedek TBLKULLANICI.TXTADSOYAD. İkisinde de yoksa "Temsilci #<id>".
      COALESCE(
        NULLIF(LTRIM(RTRIM(p.TXTAD)), ''),
        NULLIF(LTRIM(RTRIM(k.TXTADSOYAD)), '')
      )                                                            AS ad,
      d.TXTAD                                                      AS distributor,
      COUNT(*)                                                     AS ziyaret,
      COUNT(DISTINCT b.LNGMUSTERIKOD)                              AS unique_musteri,
      ISNULL(MAX(fat.aktif), 0)                                    AS aktif_musteri,
      SUM(b.siparis_var)                                           AS siparisli,
      SUM(CASE WHEN b.BYTRUTKODU = 1 THEN 1 ELSE 0 END)            AS rut_disi
    FROM baz b
    LEFT JOIN dbo.TBLPERSONEL p ON p.LNGPERSONELKOD = b.LNGSTKOD
    LEFT JOIN dbo.TBLKULLANICI k ON k.LNGKOD = b.LNGSTKOD
    LEFT JOIN dbo.TBLDIST d ON d.LNGKOD = b.LNGDISTKOD
    LEFT JOIN fat ON fat.LNGSTKOD = b.LNGSTKOD AND fat.LNGDISTKOD = b.LNGDISTKOD
    GROUP BY b.LNGSTKOD, b.LNGDISTKOD, p.TXTAD, k.TXTADSOYAD, d.TXTAD
    ORDER BY COUNT(*) DESC
  `;
  // ~204 distinct rep (all-time) — scope-free full fetch ucuz.
  const result = await runReadOnly(sql, { limit: 500, timeoutMs: 45_000 });
  return result.rows.map((r) => {
    const repId = Number(r.rep_id ?? 0);
    const ziyaret = Number(r.ziyaret ?? 0);
    const siparisli = Number(r.siparisli ?? 0);
    const rutDisi = Number(r.rut_disi ?? 0);
    const rawAd = r.ad ? String(r.ad).trim() : "";
    return {
      repId,
      distId: r.dist_id != null ? Number(r.dist_id) : null,
      ad: rawAd || `Temsilci #${repId}`,
      distributor: r.distributor ? String(r.distributor) : null,
      ziyaret,
      uniqueMusteri: Number(r.unique_musteri ?? 0),
      aktifMusteri: Number(r.aktif_musteri ?? 0),
      siparisliZiyaret: siparisli,
      donusumPct: ziyaret > 0 ? Number(((siparisli / ziyaret) * 100).toFixed(2)) : 0,
      rutDisiPct: ziyaret > 0 ? Number(((rutDisi / ziyaret) * 100).toFixed(2)) : 0,
    };
  });
}

type VisitConversionRawRow = Omit<VisitConversionRow, "donusumPct"> & {
  distId: number | null;
};

/**
 * Panel D ham satırları — rut içi/dışı × dist (son 30g). Scope-free: dist_id
 * (`o.LNGDISTKOD`) GROUP BY'a eklendi (~31 dist × 2 rut ≈ 62 satır, ucuz).
 *
 * TBLPMPZIYARETDETAY.BYTISLEMKODU = 60 (sipariş), 4 (fatura), 30 (irsaliye).
 * Bir ziyarette aynı belge tipi birden fazla kez çıkabilir → DISTINCT
 * z.LNGKOD ile ziyaret-bazlı sayım yapılır.
 */
async function fetchConversion(cities?: string[] | null): Promise<VisitConversionRawRow[]> {
  const sql = `
    SELECT
      o.LNGDISTKOD                                                                    AS dist_id,
      z.BYTRUTKODU,
      COUNT(DISTINCT z.LNGKOD)                                                       AS ziyaret,
      COUNT(DISTINCT CASE WHEN d.BYTISLEMKODU = 60 THEN z.LNGKOD END)                AS siparisli,
      COUNT(DISTINCT CASE WHEN d.BYTISLEMKODU = 4  THEN z.LNGKOD END)                AS faturali,
      COUNT(DISTINCT CASE WHEN d.BYTISLEMKODU = 30 THEN z.LNGKOD END)                AS irsaliyeli
    FROM dbo.TBLPMPZIYARETBASLIK z
    INNER JOIN dbo.TBLPMPZIYARETOZET o ON o.LNGKOD = z.LNGOZETKOD
    LEFT JOIN dbo.TBLPMPZIYARETDETAY d ON d.LNGBASLIKKOD = z.LNGKOD
    WHERE z.TRHGIRIS IS NOT NULL
      AND z.TRHGIRIS >= DATEADD(day, -30, ${sqlNow()})
      AND z.TRHGIRIS <= ${sqlNow()}${cityFactClause(cities, "z.LNGMUSTERIKOD")}
    GROUP BY o.LNGDISTKOD, z.BYTRUTKODU
    ORDER BY o.LNGDISTKOD, z.BYTRUTKODU
  `;
  const result = await runReadOnly(sql, { limit: 200, timeoutMs: 45_000 });
  return result.rows.map((r) => {
    const tip: VisitConversionRow["tip"] =
      Number(r.BYTRUTKODU ?? 0) === 1 ? "Rut Dışı" : "Rut İçi";
    return {
      distId: r.dist_id != null ? Number(r.dist_id) : null,
      tip,
      ziyaret: Number(r.ziyaret ?? 0),
      siparisli: Number(r.siparisli ?? 0),
      faturali: Number(r.faturali ?? 0),
      irsaliyeli: Number(r.irsaliyeli ?? 0),
    };
  });
}

/** dist-scope uygulanmış satırları rut tipine göre re-aggregate eder. */
function aggregateConversion(rows: VisitConversionRawRow[]): VisitConversionRow[] {
  const byTip = new Map<
    VisitConversionRow["tip"],
    { tip: VisitConversionRow["tip"]; ziyaret: number; siparisli: number; faturali: number; irsaliyeli: number }
  >();
  for (const row of rows) {
    const existing = byTip.get(row.tip);
    if (existing) {
      existing.ziyaret += row.ziyaret;
      existing.siparisli += row.siparisli;
      existing.faturali += row.faturali;
      existing.irsaliyeli += row.irsaliyeli;
    } else {
      byTip.set(row.tip, {
        tip: row.tip,
        ziyaret: row.ziyaret,
        siparisli: row.siparisli,
        faturali: row.faturali,
        irsaliyeli: row.irsaliyeli,
      });
    }
  }
  return [...byTip.values()]
    .sort((a, b) => (a.tip === "Rut İçi" ? -1 : 1) - (b.tip === "Rut İçi" ? -1 : 1))
    .map((t) => ({
      ...t,
      donusumPct: t.ziyaret > 0 ? Number(((t.siparisli / t.ziyaret) * 100).toFixed(2)) : 0,
    }));
}

/**
 * Panel E — Top 10 distribütör karşılaştırması (son 30g).
 */
/**
 * Panel E ham satırları — tüm distribütörler (son 30g). `TOP 10` kaldırıldı;
 * dist zaten group key (~31 satır max) — Top 10 kesme scope SONRASI public
 * API'de yapılır.
 */
async function fetchDistributorComparison(
  cities?: string[] | null,
): Promise<Omit<DistributorComparisonRow, "rank">[]> {
  // Bölge kaynağı tenant'a göre TERS: Pernod TBLDISTGRUP(TXTGRUP)=bölge,
  // Wietnauer TBLDISTEKGRUP(TXTEKGRUP)=bölge. (komuta fetchHeatmap ile aynı.)
  const tenant = getTenantConfig();
  const distRegionTable = tenant.distRegionTable ?? "TBLDISTGRUP";
  const distRegionColumn = tenant.distRegionColumn ?? "TXTGRUP";
  const sql = `
    WITH baz AS (
      SELECT
        o.LNGDISTKOD,
        o.LNGSTKOD,
        z.LNGKOD                                                   AS ziyaret_kod,
        z.LNGMUSTERIKOD,
        CASE WHEN sip.LNGBASLIKKOD IS NOT NULL THEN 1 ELSE 0 END   AS siparis_var
      FROM dbo.TBLPMPZIYARETBASLIK z
      INNER JOIN dbo.TBLPMPZIYARETOZET o ON o.LNGKOD = z.LNGOZETKOD
      LEFT JOIN (
        SELECT DISTINCT LNGBASLIKKOD
        FROM dbo.TBLPMPZIYARETDETAY
        WHERE BYTISLEMKODU = 60
      ) sip ON sip.LNGBASLIKKOD = z.LNGKOD
      WHERE z.TRHGIRIS IS NOT NULL
        AND z.TRHGIRIS >= DATEADD(day, -30, ${sqlNow()})
        AND z.TRHGIRIS <= ${sqlNow()}${cityFactClause(cities, "z.LNGMUSTERIKOD")}
    )
    SELECT
      b.LNGDISTKOD                                                 AS dist_kod,
      d.TXTAD                                                      AS distributor,
      g.TXTAD                                                      AS bolge,
      COUNT(DISTINCT b.LNGSTKOD)                                   AS aktif_rep,
      COUNT(*)                                                     AS ziyaret,
      COUNT(DISTINCT b.LNGMUSTERIKOD)                              AS kapsanan,
      SUM(b.siparis_var)                                           AS siparisli
    FROM baz b
    LEFT JOIN dbo.TBLDIST       d ON d.LNGKOD = b.LNGDISTKOD
    LEFT JOIN dbo.${distRegionTable} g ON g.TXTKOD = d.${distRegionColumn}
    GROUP BY b.LNGDISTKOD, d.TXTAD, g.TXTAD
    ORDER BY COUNT(*) DESC
  `;
  const result = await runReadOnly(sql, { limit: 100, timeoutMs: 45_000 });
  return result.rows.map((r) => {
    const ziyaret = Number(r.ziyaret ?? 0);
    const siparisli = Number(r.siparisli ?? 0);
    const distKod = Number(r.dist_kod ?? 0);
    return {
      distKod,
      distributor: String(r.distributor ?? `Distribütör #${distKod}`),
      bolge: r.bolge ? String(r.bolge) : null,
      aktifTemsilci: Number(r.aktif_rep ?? 0),
      ziyaret,
      kapsananMusteri: Number(r.kapsanan ?? 0),
      donusumPct: ziyaret > 0 ? Number(((siparisli / ziyaret) * 100).toFixed(2)) : 0,
    };
  });
}

// ---------- Public API ------------------------------------------------------

type RawSahaBundle = {
  visitDaily: VisitDailyRawRow[];
  kpi: VisitKpi7gRawRow[];
  coverage: CoverageRawRow[];
  reps: RepPerformanceRawRow[];
  conversion: VisitConversionRawRow[];
  distributors: Omit<DistributorComparisonRow, "rank">[];
  generatedAt: string;
};

function rerank<T>(rows: T[]): (T & { rank: number })[] {
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Saha Operasyon Dashboard #5 için tek snapshot — 6 sorgu paralel.
 *
 * Cache stratejisi: full dataset (tüm dist'ler) TEK cache anahtarı
 * (`${CACHE_VERSION}-30g-all`) altında çekilir — wietnauer-stok.ts'teki
 * `scopedRows` deseniyle aynı. Dist filtresi/scope runtime'da JS'te
 * uygulanır; Top-N kesme + rank ataması scope SONRASI yapılır.
 *
 * `forceRefresh=true` → MSSQL'i yeniden vurur (saha aktif saatlerinde
 * kullanmayın).
 */
export async function getWietnauerSahaSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    allowedDistKods?: number[] | null;
    distId?: number | null;
    /** Kullanıcının izinli şehirleri (null → kısıt yok). SQL'e semi-join
     * predikatı olarak uygulanır; cache key şehir kümesine göre ayrışır. */
    allowedCities?: string[] | null;
  } = {},
): Promise<WietnauerSahaSnapshot> {
  // strategicBrands şu an saha modülünde kullanılmıyor.
  void options.strategicBrands;
  void getTenantConfig;

  const cities = options.allowedCities ?? null;
  const cacheKey = `${CACHE_VERSION}-30g-${cityCacheTag(cities)}`;
  const result = await withCache<RawSahaBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      const [visitDaily, kpi, coverage, reps, conversion, distributors] = await Promise.all([
        fetchVisitDaily(cities),
        fetchVisitKpi7g(cities),
        fetchCoverage(cities),
        fetchRepPerformance(cities),
        fetchConversion(cities),
        fetchDistributorComparison(cities),
      ]);
      return {
        visitDaily,
        kpi,
        coverage,
        reps,
        conversion,
        distributors,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const {
    visitDaily: rawVisitDaily,
    kpi: rawKpi,
    coverage: rawCoverage,
    reps: rawReps,
    conversion: rawConversion,
    distributors: rawDistributors,
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

  const scopedVisitDaily = rawVisitDaily.filter((r) => inScope(r.distId));
  const scopedKpi = rawKpi.filter((r) => inScope(r.distId));
  const scopedCoverage = rawCoverage.filter((r) => inScope(r.distId));
  const scopedReps = rawReps.filter((r) => inScope(r.distId));
  const scopedConversion = rawConversion.filter((r) => inScope(r.distId));
  const scopedDistributors = rawDistributors.filter((r) => inScope(r.distKod));

  const visitDaily = aggregateVisitDaily(scopedVisitDaily);
  const kpi = aggregateVisitKpi7g(scopedKpi);
  const coverage = aggregateCoverage(scopedCoverage);
  const reps = rerank(
    scopedReps
      .map(({ distId: _distId, ...rest }) => rest)
      .sort((a, b) => b.ziyaret - a.ziyaret),
  ).slice(0, 20);
  const conversion = aggregateConversion(scopedConversion);
  const distributors = rerank(
    [...scopedDistributors].sort((a, b) => b.ziyaret - a.ziyaret),
  ).slice(0, 10);

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    visitDaily,
    kpi,
    coverage,
    reps,
    conversion,
    distributors,
  };
}
