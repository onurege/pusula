/**
 * Wietnauer Dashboard #2 — Satış Performansı.
 *
 * Kapsam (HEDEF GERÇEKLEŞMESİ HARİÇ — kullanıcı talebi):
 *   A) Distribütör Leaderboard — tüm distribütörler (ciro, müşteri, fatura,
 *      sepet, delta vs önceki 30g)
 *   B) Satış Temsilcisi Leaderboard — Top 20 temsilci (ciro, müşteri, sepet,
 *      delta)
 *   C) Drop Size — distribütör başına distinct müşteri × ortalama ciro
 *   D) Yeni Müşteri Kazanımı — son 90 günde ilk faturası kesilmiş müşteriler
 *   E) Ortalama Sipariş Büyüklüğü Trendi — son 12 ay ay × AVG net ciro
 *
 * Kaynaklar:
 *   - dbo.TBLMSDFATURA          (LNGSTKOD, LNGDISTKOD, LNGMUSTERIKOD,
 *                                DBLNETTUTAR, TRHISLEMTARIHI)
 *   - dbo.TBLDISTPERSONEL       (LNGKOD, TXTAD, TXTSOYAD, LNGDISTKOD)
 *   - dbo.TBLDIST               (LNGKOD, TXTAD, TXTGRUP)
 *   - dbo.TBLDISTEKGRUP         (TXTKOD, TXTAD) — bölge (MARMARA/EGE/ANADOLU/...)
 *     TBLDIST.TXTEKGRUP ile JOIN.
 *
 * BYTTUR=0 AND BYTDURUM=0 zorunlu. Tarih penceresi KAPALI: alt + üst sınırla.
 *
 * Cache stratejisi: tek snapshot "v5-30g-all" altında — TÜM dist'ler TEK
 * cache anahtarıyla çekilir (scope-free), dist filtresi/scope runtime'da JS'te
 * uygulanır (wietnauer-stok.ts `scopedRows` deseni). Bu sayede farklı dist
 * kullanıcıların günün ilk isteği canlı Univera'ya soğuk-cache sorgu göndermez
 * — tüm dist'ler aynı cache satırını paylaşır. Beş paralel fetcher
 * Promise.all ile birleşir; her biri dist_id'yi SELECT/GROUP BY'da tutar ki
 * JS tarafı dist bazlı filtre + re-aggregate yapabilsin.
 */
import { withCache } from "./cache.js";
import { sqlNow } from "./now.js";
import { runReadOnly } from "./db.js";
import { getTenantConfig } from "./tenant/index.js";
import { volumeUnitExpr } from "./volume.js";
import { cityFactClause, cityCacheTag } from "./auth.js";

const CACHE_DOMAIN = "wietnauer-satis";
// v5: cache-key scope fragmentation düzeltmesi (VYK-01) — dist filtresi
// SQL'den çıkarıldı, tüm fetcher'lar scope'suz (tüm dist) tek cache anahtarı
// altında çekilir; dist scope runtime'da JS'te satır bazlı filtrelenir. Eski
// `v4-*-d<n>` scope'lu cache satırları bu versiyon artışıyla geçersiz olur.
// v6: md26 — distLeaderboard'a hacim (70cl eşdeğer) eklendi; row shape değişti.
// md27: distLeaderboard'a `satisHizi` (ciro / aktif müşteri) eklendi — SQL/cache
// şemasına dokunulmadı (mevcut ciro+musteriSayi'dan post-cache türetilir), bu
// yüzden CACHE_VERSION artışı gerekmedi.
const CACHE_VERSION = "v6";

// ---------- md21: özel tarih aralığı ----------------------------------------
//
// `?from=YYYY-MM-DD&to=YYYY-MM-DD` server.ts'te `parseDateRange` ile zaten
// regex doğrulanıp geçiriliyor — ama SQL'e interpolate edilecek herhangi bir
// string'e güvenmemek (defense in depth) için burada TEKRAR doğrulanır.
// Yalnızca bu formatta değer SQL literaline gömülür.
const DATE_ONLY_RX = /^\d{4}-\d{2}-\d{2}$/;

function normDateOnly(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return DATE_ONLY_RX.test(s) ? s : null;
}

type DateWindow = {
  /** current pencere alt sınır (dahil) SQL ifadesi */
  curLower: string;
  /** current pencere üst sınır (HARİÇ) SQL ifadesi */
  curUpper: string;
  /** karşılaştırma (prev) pencere alt sınır (dahil) SQL ifadesi */
  prevLower: string;
  /** karşılaştırma (prev) pencere üst sınır (HARİÇ) SQL ifadesi */
  prevUpper: string;
};

/**
 * Seçili tarih aralığına göre current + kaydırılmış prev (aynı gün sayısı
 * kadar geri) pencere SQL ifadelerini üretir.
 *
 * dateFrom/dateTo ikisi de geçerli YYYY-MM-DD DEĞİLSE (biri eksik/geçersiz)
 * `fallbackDays` ile mevcut varsayılan davranış (bugüne bağıl, sqlNow
 * tabanlı `DATEADD(day,-N,sqlNow())..DATEADD(day,1,sqlNow())`) AYNEN korunur
 * — regresyon yok. from > to gibi geçersiz aralıklarda da aynı fallback'e
 * düşülür.
 */
function resolveWindow(
  dateFrom: string | null,
  dateTo: string | null,
  fallbackDays: number,
): DateWindow {
  if (dateFrom && dateTo) {
    const fromMs = Date.parse(`${dateFrom}T00:00:00Z`);
    const toMs = Date.parse(`${dateTo}T00:00:00Z`);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs <= toMs) {
      // Kapsayıcı gün sayısı (from..to dahil) — prev pencere bu kadar geri kayar.
      const spanDays = Math.round((toMs - fromMs) / 86400000) + 1;
      return {
        curLower: `CAST('${dateFrom}' AS DATE)`,
        curUpper: `DATEADD(day, 1, CAST('${dateTo}' AS DATE))`,
        prevLower: `DATEADD(day, -${spanDays}, CAST('${dateFrom}' AS DATE))`,
        prevUpper: `CAST('${dateFrom}' AS DATE)`,
      };
    }
  }
  return {
    curLower: `DATEADD(day, -${fallbackDays}, ${sqlNow()})`,
    curUpper: `DATEADD(day, 1, ${sqlNow()})`,
    prevLower: `DATEADD(day, -${fallbackDays * 2}, ${sqlNow()})`,
    prevUpper: `DATEADD(day, -${fallbackDays}, ${sqlNow()})`,
  };
}

// ---------- Tipler ----------------------------------------------------------

export type SatisDistRow = {
  /** TBLDIST.LNGKOD */
  id: number;
  ad: string;
  region: string | null;
  /** Son 30g net ciro */
  ciro: number;
  /** md26: Son 30g hacim (70cl eşdeğer) — Σ(DBLMIKTAR×litre-eşdeğer) */
  hacim: number;
  /** Son 30g distinct müşteri sayısı */
  musteriSayi: number;
  faturaSayi: number;
  /** AVG sepet = ciro / faturaSayi */
  ortSepet: number;
  /** Önceki 30g ciro (60..30 gün arası) */
  prevCiro: number;
  /** (ciro - prevCiro) / prevCiro * 100 */
  deltaPct: number;
  /**
   * md27: Nokta başına satış hızı = ciro / aktif nokta (aktif müşteri).
   * `musteriSayi` zaten distinct aktif müşteri sayısı — SQL/cache'e
   * dokunmadan, mevcut cache'lenmiş satırdan runtime'da türetilir (bkz.
   * `getWietnauerSatisSnapshot`). musteriSayi=0 ise 0 (bölme sıfır koruması).
   */
  satisHizi: number;
  rank: number;
};

export type SatisRepRow = {
  /** TBLDISTPERSONEL.LNGKOD */
  id: number;
  ad: string;
  distAd: string | null;
  region: string | null;
  ciro: number;
  musteriSayi: number;
  faturaSayi: number;
  ortSepet: number;
  prevCiro: number;
  deltaPct: number;
  rank: number;
};

export type DropSizeRow = {
  /** TBLDIST.LNGKOD */
  id: number;
  ad: string;
  region: string | null;
  ciro: number;
  musteriSayi: number;
  /** Drop size = ciro / musteriSayi (nokta başına ortalama ciro) */
  dropSize: number;
  rank: number;
};

export type NewCustomerRow = {
  /** TBLDIST.LNGKOD */
  distId: number;
  distAd: string;
  region: string | null;
  /** Son 90g'de İLK faturası kesilmiş müşteri sayısı */
  yeniMusteriSayi: number;
  /** Bu yeni müşterilerin son 90g toplam cirosu */
  yeniMusteriCiro: number;
};

export type AvgOrderTrendPoint = {
  /** YYYY-MM */
  ay: string;
  /** Ay başlangıç ISO (sort için) */
  ayBaslangic: string;
  /** AVG(DBLNETTUTAR) bu ayın faturaları üzerinden */
  ortSepet: number;
  faturaSayi: number;
  toplamCiro: number;
};

export type WietnauerSatisSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  distLeaderboard: SatisDistRow[];
  repLeaderboard: SatisRepRow[];
  dropSize: DropSizeRow[];
  newCustomers: {
    items: NewCustomerRow[];
    totalYeniMusteri: number;
    totalYeniCiro: number;
  };
  avgOrderTrend: AvgOrderTrendPoint[];
};

// ---------- Fetcher'lar -----------------------------------------------------

/**
 * Tüm distribütörler — son 30g vs önceki 30g delta dahil.
 * Pencere kapalı: `>= -30` AND `< +1` (sqlNow ÜST SINIR ile).
 *
 * Scope-free: dist filtresi SQL'den çıkarıldı, TÜM dist'ler tek sorguda
 * çekilir (zaten dist_id GROUP BY anahtarı — cardinality ~31 dist, ucuz).
 * `rank` burada atanmaz; scope uygulandıktan sonra çağıran taraf re-rank eder.
 */
async function fetchDistributorLeaderboard(
  cities: string[] | null | undefined,
  win: DateWindow,
): Promise<Omit<SatisDistRow, "rank" | "satisHizi">[]> {
  // Kapalı pencere pattern x2 (current/prev) — UNION yerine iki CTE; SQL Server
  // her ikisini de aynı index üzerinden tarayabilir, planner birleştirir.
  // md21: pencere sınırları artık `win` (seçili tarih aralığı VEYA varsayılan
  // son 30g) üzerinden parametrik — bkz. `resolveWindow`.
  const sql = `
    WITH cur AS (
      SELECT f.LNGDISTKOD AS dist_id,
             SUM(f.DBLNETTUTAR) AS ciro,
             COUNT(*) AS fatura,
             COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= ${win.curLower}
        AND f.TRHISLEMTARIHI <  ${win.curUpper}${cityFactClause(cities)}
      GROUP BY f.LNGDISTKOD
    ),
    prev AS (
      SELECT f.LNGDISTKOD AS dist_id,
             SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= ${win.prevLower}
        AND f.TRHISLEMTARIHI <  ${win.prevUpper}${cityFactClause(cities)}
      GROUP BY f.LNGDISTKOD
    ),
    -- md26: dist bazında seçili pencerede hacim (70cl eşdeğer) — fatura DETAY seviyesi.
    hacimq AS (
      SELECT f.LNGDISTKOD AS dist_id,
             ISNULL(SUM(${volumeUnitExpr("d2", "u", "ue")}), 0) AS hacim
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d2
        ON d2.LNGYIL = f.LNGYIL
       AND d2.LNGFATURAKOD = f.LNGBELGEKOD
       AND d2.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d2.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNEKSAHA ue
        ON ue.LNGURUNREF = u.LNGKOD AND ue.LNGEKSAHAKODU = 26
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= ${win.curLower}
        AND f.TRHISLEMTARIHI <  ${win.curUpper}${cityFactClause(cities)}
      GROUP BY f.LNGDISTKOD
    )
    SELECT
      c.dist_id,
      d.TXTAD AS ad,
      dg.TXTAD AS region,
      c.ciro,
      c.fatura,
      c.musteri,
      ISNULL(h.hacim, 0) AS hacim,
      ISNULL(p.ciro, 0) AS prev_ciro
    FROM cur c
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = c.dist_id
    LEFT JOIN dbo.TBLDISTEKGRUP dg ON dg.TXTKOD = d.TXTEKGRUP
    LEFT JOIN prev p ON p.dist_id = c.dist_id
    LEFT JOIN hacimq h ON h.dist_id = c.dist_id
    ORDER BY c.ciro DESC
  `;
  const result = await runReadOnly(sql, { limit: 1000 });
  return result.rows.map((r) => {
    const ciro = Number(r.ciro ?? 0);
    const fatura = Number(r.fatura ?? 0);
    const prevCiro = Number(r.prev_ciro ?? 0);
    const deltaPct = prevCiro > 0 ? ((ciro - prevCiro) / prevCiro) * 100 : 0;
    return {
      id: Number(r.dist_id),
      ad: String(r.ad ?? ""),
      region: r.region ? String(r.region) : null,
      ciro,
      hacim: Number(r.hacim ?? 0),
      faturaSayi: fatura,
      musteriSayi: Number(r.musteri ?? 0),
      ortSepet: fatura > 0 ? ciro / fatura : 0,
      prevCiro,
      deltaPct,
    };
  });
}

/** Rep leaderboard satırı + dist_id — JS-scope filtresi için gerekli. */
type SatisRepRawRow = Omit<SatisRepRow, "rank"> & { distId: number | null };

/**
 * Tüm satış temsilcileri — son 30g vs önceki 30g delta dahil.
 * TBLMSDFATURA.LNGSTKOD = satış temsilcisi kodu.
 *
 * Scope-free: `TOP 20` kaldırıldı — dist scope uygulanmadan Top 20 kesilirse
 * dist kullanıcının kendi temsilcileri listeden düşebilir (yanlış sonuç).
 * JS tarafı scope uyguladıktan SONRA Top 20'ye keser (bkz. public API).
 * dist_id çıktıya eklendi (rep'in bağlı olduğu distribütör — TBLPERSONEL.LNGDISTKOD).
 */
async function fetchSalesRepLeaderboard(
  cities: string[] | null | undefined,
  win: DateWindow,
): Promise<SatisRepRawRow[]> {
  // md21: pencere sınırları `win` üzerinden parametrik (bkz. `resolveWindow`).
  const sql = `
    WITH cur AS (
      SELECT f.LNGSTKOD AS rep_id,
             SUM(f.DBLNETTUTAR) AS ciro,
             COUNT(*) AS fatura,
             COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= ${win.curLower}
        AND f.TRHISLEMTARIHI <  ${win.curUpper}
        AND f.LNGSTKOD IS NOT NULL${cityFactClause(cities)}
      GROUP BY f.LNGSTKOD
    ),
    prev AS (
      SELECT f.LNGSTKOD AS rep_id,
             SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= ${win.prevLower}
        AND f.TRHISLEMTARIHI <  ${win.prevUpper}
        AND f.LNGSTKOD IS NOT NULL${cityFactClause(cities)}
      GROUP BY f.LNGSTKOD
    )
    SELECT
      c.rep_id,
      p.TXTAD AS ad,
      p.LNGDISTKOD AS dist_id,
      d.TXTAD AS dist_ad,
      dg.TXTAD AS region,
      c.ciro,
      c.fatura,
      c.musteri,
      ISNULL(pr.ciro, 0) AS prev_ciro
    FROM cur c
    INNER JOIN dbo.TBLPERSONEL p ON p.LNGPERSONELKOD = c.rep_id
    LEFT JOIN dbo.TBLDIST d ON d.LNGKOD = p.LNGDISTKOD
    LEFT JOIN dbo.TBLDISTEKGRUP dg ON dg.TXTKOD = d.TXTEKGRUP
    LEFT JOIN prev pr ON pr.rep_id = c.rep_id
    ORDER BY c.ciro DESC
  `;
  // ~204 distinct rep (all-time) — scope-free full fetch ucuz.
  const result = await runReadOnly(sql, { limit: 500 });
  return result.rows.map((r) => {
    const ciro = Number(r.ciro ?? 0);
    const fatura = Number(r.fatura ?? 0);
    const prevCiro = Number(r.prev_ciro ?? 0);
    const deltaPct = prevCiro > 0 ? ((ciro - prevCiro) / prevCiro) * 100 : 0;
    return {
      id: Number(r.rep_id),
      ad: String(r.ad ?? "").trim() || `#${r.rep_id}`,
      distId: r.dist_id != null ? Number(r.dist_id) : null,
      distAd: r.dist_ad ? String(r.dist_ad) : null,
      region: r.region ? String(r.region) : null,
      ciro,
      faturaSayi: fatura,
      musteriSayi: Number(r.musteri ?? 0),
      ortSepet: fatura > 0 ? ciro / fatura : 0,
      prevCiro,
      deltaPct,
    };
  });
}

/**
 * Drop Size = ciro / distinct müşteri (son 30g). Hangi distribütör daha az
 * müşteriyle daha yüksek ciro yapıyor? Filtre: en az 5 distinct müşterisi
 * olan distribütörler — tek müşterilik büyük cirolar (ör. zincir alımı)
 * listeyi yanıltmasın.
 *
 * Scope-free: `TOP 15` kaldırıldı (dist zaten group key, ~31 satır max) —
 * JS tarafı scope + Top 15'i public API'de uygular.
 */
async function fetchDropSizeByDist(
  cities: string[] | null | undefined,
  win: DateWindow,
): Promise<Omit<DropSizeRow, "rank">[]> {
  // md21: pencere sınırları `win` üzerinden parametrik (bkz. `resolveWindow`).
  const sql = `
    WITH stats AS (
      SELECT f.LNGDISTKOD AS dist_id,
             SUM(f.DBLNETTUTAR) AS ciro,
             COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= ${win.curLower}
        AND f.TRHISLEMTARIHI <  ${win.curUpper}${cityFactClause(cities)}
      GROUP BY f.LNGDISTKOD
      HAVING COUNT(DISTINCT f.LNGMUSTERIKOD) >= 5
    )
    SELECT
      s.dist_id,
      d.TXTAD AS ad,
      dg.TXTAD AS region,
      s.ciro,
      s.musteri,
      CAST(s.ciro / NULLIF(s.musteri, 0) AS DECIMAL(18, 2)) AS drop_size
    FROM stats s
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = s.dist_id
    LEFT JOIN dbo.TBLDISTEKGRUP dg ON dg.TXTKOD = d.TXTEKGRUP
    ORDER BY drop_size DESC
  `;
  const result = await runReadOnly(sql, { limit: 50 });
  return result.rows.map((r) => ({
    id: Number(r.dist_id),
    ad: String(r.ad ?? ""),
    region: r.region ? String(r.region) : null,
    ciro: Number(r.ciro ?? 0),
    musteriSayi: Number(r.musteri ?? 0),
    dropSize: Number(r.drop_size ?? 0),
  }));
}

/**
 * Yeni Müşteri Kazanımı — son 90 günde İLK faturası kesilmiş müşteriler.
 *
 * Her müşteri için MIN(TRHISLEMTARIHI) hesaplanır; bu değer son 90g
 * içindeyse "yeni müşteri" sayılır. Müşterinin ait olduğu distribütör =
 * ilk faturasını kesen distribütör (aynı CTE).
 *
 * Çıktı: distribütör × yeni müşteri sayısı + bu müşterilerin son 90g
 * toplam cirosu — TÜM dist'ler (scope-free). Top-15 kesme + toplam KPI
 * hesaplaması scope uygulandıktan SONRA public API'de yapılır (aksi halde
 * dist kullanıcı için toplamlar merkez rakamlarını sızdırır).
 */
async function fetchNewCustomersAcquisition(cities?: string[] | null): Promise<NewCustomerRow[]> {
  // Strateji:
  //   1) "first_invoice" CTE — her müşterinin TÜM zaman ilk fatura tarihi +
  //      o faturadaki distribütör (ROW_NUMBER ile en eski seçilir).
  //   2) Yalnızca ilk faturası son 90g'de olanları al.
  //   3) Bu müşterilerin son 90g toplam net cirosunu da hesapla.
  const sql = `
    WITH first_invoice AS (
      SELECT
        f.LNGMUSTERIKOD AS musteri_id,
        f.LNGDISTKOD AS dist_id,
        f.TRHISLEMTARIHI AS first_date,
        ROW_NUMBER() OVER (
          PARTITION BY f.LNGMUSTERIKOD
          ORDER BY f.TRHISLEMTARIHI ASC, f.LNGBELGEKOD ASC
        ) AS rn
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0${cityFactClause(cities)}
    ),
    yeni_musteri AS (
      SELECT musteri_id, dist_id, first_date
      FROM first_invoice
      WHERE rn = 1
        AND first_date >= DATEADD(day, -90, ${sqlNow()})
        AND first_date <  DATEADD(day, 1, ${sqlNow()})
    ),
    ciro90 AS (
      SELECT f.LNGMUSTERIKOD AS musteri_id,
             SUM(f.DBLNETTUTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN yeni_musteri ym ON ym.musteri_id = f.LNGMUSTERIKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -90, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
      GROUP BY f.LNGMUSTERIKOD
    )
    SELECT
      ym.dist_id,
      d.TXTAD AS dist_ad,
      dg.TXTAD AS region,
      COUNT(*) AS yeni_sayi,
      ISNULL(SUM(c.ciro), 0) AS yeni_ciro
    FROM yeni_musteri ym
    LEFT JOIN ciro90 c ON c.musteri_id = ym.musteri_id
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = ym.dist_id
    LEFT JOIN dbo.TBLDISTEKGRUP dg ON dg.TXTKOD = d.TXTEKGRUP
    GROUP BY ym.dist_id, d.TXTAD, dg.TXTAD
    ORDER BY yeni_sayi DESC
  `;
  const result = await runReadOnly(sql, { limit: 200 });
  return result.rows.map((r) => ({
    distId: Number(r.dist_id),
    distAd: String(r.dist_ad ?? ""),
    region: r.region ? String(r.region) : null,
    yeniMusteriSayi: Number(r.yeni_sayi ?? 0),
    yeniMusteriCiro: Number(r.yeni_ciro ?? 0),
  }));
}

/** Aylık trend satırı + dist_id — JS-scope filtresi + re-aggregate için. */
type AvgOrderTrendRawRow = {
  distId: number;
  ayBaslangic: string;
  net: number;
  faturaSayi: number;
};

/**
 * Ortalama Sipariş Büyüklüğü Trendi — son 12 ay × dist × {net, fatura_sayi}.
 *
 * Scope-free: dist_id GROUP BY'a eklendi (31 dist × 12 ay ≈ 372 satır — ucuz)
 * ki JS tarafı scope filtresi sonrası ay bazında re-aggregate (SUM/AVG)
 * yapabilsin. Aylar sqlNow()'in bulunduğu ayın sonundan geriye doğru 12.
 */
async function fetchAvgOrderTrend(cities?: string[] | null): Promise<AvgOrderTrendRawRow[]> {
  const sql = `
    WITH t AS (
      SELECT
        f.LNGDISTKOD AS dist_id,
        DATEFROMPARTS(YEAR(f.TRHISLEMTARIHI), MONTH(f.TRHISLEMTARIHI), 1) AS ay_baslangic,
        f.DBLNETTUTAR AS net
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(month, -12, DATEFROMPARTS(YEAR(${sqlNow()}), MONTH(${sqlNow()}), 1))
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    )
    SELECT
      dist_id,
      ay_baslangic,
      SUM(net) AS toplam_ciro,
      COUNT(*) AS fatura_sayi
    FROM t
    GROUP BY dist_id, ay_baslangic
    ORDER BY ay_baslangic ASC
  `;
  const result = await runReadOnly(sql, { limit: 1000 });
  return result.rows.map((r) => {
    // ay_baslangic genellikle ISO string ya da Date olarak gelir.
    const raw = r.ay_baslangic;
    const d = raw instanceof Date ? raw : new Date(String(raw));
    return {
      distId: Number(r.dist_id),
      ayBaslangic: d.toISOString(),
      net: Number(r.toplam_ciro ?? 0),
      faturaSayi: Number(r.fatura_sayi ?? 0),
    };
  });
}

/** dist-scope uygulanmış aylık ham satırları ay bazında re-aggregate eder. */
function aggregateAvgOrderTrend(rows: AvgOrderTrendRawRow[]): AvgOrderTrendPoint[] {
  const byMonth = new Map<string, { ayBaslangic: string; net: number; fatura: number }>();
  for (const row of rows) {
    const existing = byMonth.get(row.ayBaslangic);
    if (existing) {
      existing.net += row.net;
      existing.fatura += row.faturaSayi;
    } else {
      byMonth.set(row.ayBaslangic, { ayBaslangic: row.ayBaslangic, net: row.net, fatura: row.faturaSayi });
    }
  }
  return [...byMonth.values()]
    .sort((a, b) => a.ayBaslangic.localeCompare(b.ayBaslangic))
    .map((m) => {
      const d = new Date(m.ayBaslangic);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      return {
        ay: `${yyyy}-${mm}`,
        ayBaslangic: m.ayBaslangic,
        ortSepet: m.fatura > 0 ? m.net / m.fatura : 0,
        faturaSayi: m.fatura,
        toplamCiro: m.net,
      };
    });
}

// ---------- Public API ------------------------------------------------------

type RawSatisBundle = {
  distLeaderboard: Omit<SatisDistRow, "rank" | "satisHizi">[];
  repLeaderboard: SatisRepRawRow[];
  dropSize: Omit<DropSizeRow, "rank">[];
  newCustomers: NewCustomerRow[];
  avgOrderTrendRaw: AvgOrderTrendRawRow[];
  generatedAt: string;
};

function rerank<T>(rows: T[]): (T & { rank: number })[] {
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Satış Performansı Dashboard snapshot'ı.
 *
 * Cache stratejisi: full dataset (tüm dist'ler) TEK cache anahtarı
 * (`${CACHE_VERSION}-30g-all`) altında çekilir — wietnauer-stok.ts'teki
 * `scopedRows` deseniyle aynı. Dist filtresi/scope runtime'da JS'te
 * uygulanır; Top-N kesme ve rank ataması scope SONRASI yapılır (aksi halde
 * dist kullanıcı merkez sıralamasının "kırpılmış" halini görür, yanlış).
 *
 * `strategicBrands` parametresi imza uyumu için kabul edilir, bu snapshot
 * marka kırılımı içermez — yok sayılır.
 */
export async function getWietnauerSatisSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    allowedDistKods?: number[] | null;
    distId?: number | null;
    /** Kullanıcının izinli şehirleri (null → kısıt yok). SQL'e semi-join
     * predikatı olarak uygulanır; cache key şehir kümesine göre ayrışır. */
    allowedCities?: string[] | null;
    /**
     * md21 — özel tarih aralığı (YYYY-MM-DD). Server tarafında
     * `parseDateRange` zaten regex doğruladı; burada da (defense in depth)
     * tekrar doğrulanır. İkisi de verilmezse/geçersizse distLeaderboard,
     * repLeaderboard ve dropSize fetcher'ları mevcut varsayılan pencereyi
     * (son 30g / önceki 30g karşılaştırması) kullanmaya devam eder —
     * newCustomers (90g ilk fatura) ve avgOrderTrend (12 ay) bu aralıktan
     * bağımsız, kendi sabit pencerelerini korur (farklı KPI semantiği).
     */
    dateFrom?: string | null;
    dateTo?: string | null;
  } = {},
): Promise<WietnauerSatisSnapshot> {
  // strategicBrands bu snapshot için kullanılmıyor; imza uyumu için kabul
  // ediliyor (server.ts genel makeV3Handler aynı imzayı bekliyor).
  void getTenantConfig;
  void options.strategicBrands;

  const cities = options.allowedCities ?? null;
  const dateFrom = normDateOnly(options.dateFrom);
  const dateTo = normDateOnly(options.dateTo);
  const win = resolveWindow(dateFrom, dateTo, 30);
  // Aralık verilmemişken cache key AYNEN korunur (regresyon yok); verildiğinde
  // ayrı bir satırda cache'lenir ki farklı aralıklar birbirini ezmesin.
  const dateTag = dateFrom || dateTo ? `-${dateFrom ?? "d"}_${dateTo ?? "d"}` : "";
  const cacheKey = `${CACHE_VERSION}-30g-${cityCacheTag(cities)}${dateTag}`;
  const result = await withCache<RawSatisBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      const [distLeaderboard, repLeaderboard, dropSize, newCustomers, avgOrderTrendRaw] =
        await Promise.all([
          fetchDistributorLeaderboard(cities, win),
          fetchSalesRepLeaderboard(cities, win),
          fetchDropSizeByDist(cities, win),
          fetchNewCustomersAcquisition(cities),
          fetchAvgOrderTrend(cities),
        ]);
      return {
        distLeaderboard,
        repLeaderboard,
        dropSize,
        newCustomers,
        avgOrderTrendRaw,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const {
    distLeaderboard: rawDistLeaderboard,
    repLeaderboard: rawRepLeaderboard,
    dropSize: rawDropSize,
    newCustomers: rawNewCustomers,
    avgOrderTrendRaw,
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

  // md27: satisHizi = ciro / aktif nokta (musteriSayi) — mevcut cache'lenmiş
  // ciro/musteriSayi'dan türetilir, SQL/cache şemasına dokunulmaz. Bölme
  // sıfır koruması: musteriSayi=0 ise 0.
  const scopedDistLeaderboard = rawDistLeaderboard
    .filter((r) => inScope(r.id))
    .map((r) => ({
      ...r,
      satisHizi: r.musteriSayi > 0 ? r.ciro / r.musteriSayi : 0,
    }));
  const scopedRepLeaderboard = rawRepLeaderboard.filter((r) => inScope(r.distId));
  const scopedDropSize = rawDropSize.filter((r) => inScope(r.id));
  const scopedNewCustomers = rawNewCustomers.filter((r) => inScope(r.distId));
  const scopedAvgOrderTrendRaw = avgOrderTrendRaw.filter((r) => inScope(r.distId));

  const distLeaderboard = rerank(scopedDistLeaderboard);
  const repLeaderboard = rerank(scopedRepLeaderboard.map(({ distId: _distId, ...rest }) => rest)).slice(0, 20);
  const dropSize = rerank(
    [...scopedDropSize].sort((a, b) => b.dropSize - a.dropSize),
  ).slice(0, 15);
  const newCustomersItems = [...scopedNewCustomers].sort(
    (a, b) => b.yeniMusteriSayi - a.yeniMusteriSayi,
  );
  const totalYeniMusteri = newCustomersItems.reduce((a, b) => a + b.yeniMusteriSayi, 0);
  const totalYeniCiro = newCustomersItems.reduce((a, b) => a + b.yeniMusteriCiro, 0);
  const avgOrderTrend = aggregateAvgOrderTrend(scopedAvgOrderTrendRaw);

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    distLeaderboard,
    repLeaderboard,
    dropSize,
    newCustomers: {
      items: newCustomersItems.slice(0, 15),
      totalYeniMusteri,
      totalYeniCiro,
    },
    avgOrderTrend,
  };
}
