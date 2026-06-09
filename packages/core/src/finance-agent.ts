/**
 * Finans Agentı — bir bölgenin YoY anomalisini finans diliyle decompose eder.
 *
 * Akış:
 *   1. Bölge bazında 4 paralel SQL: distribütör × YoY, müşteri grubu × YoY,
 *      ürün grubu × YoY, müşteri sayısı (aktif/kayıp).
 *   2. Yapılandırılmış decomposition tablosu üretilir (delta, ağırlık,
 *      katkı yüzdesi).
 *   3. Gemini'ye finans analisti rolüyle ham veriler ve sezgisel sınırlar
 *      verilir; markdown çıktı üretir (Özet · Kök neden · Aksiyon).
 *
 * Kullanım:
 *   const result = await analyzeRegionAnomaly("IST-AVRUPA");
 *   // result.markdown, result.facts (yapılandırılmış)
 */

import { generate } from "./gemini.js";
import { runReadOnly } from "./db.js";
import { withCache } from "./cache.js";
import { currentDate, sqlNow } from "./now.js";

const CACHE_DOMAIN = "finance-agent";

/**
 * MSSQL string literal'ı için tek tırnak escape. Kullanım: `'${esc(s)}'`
 * runReadOnly parametre desteklemediği için inline kullanılır; ayrıca SELECT
 * dışına geçişi assertReadOnly engelliyor.
 */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type FinanceFactor = {
  /** Kırılım adı (örn. "BH ANKARA", "HORECA", "ULTRA PREMIUM VISKI") */
  ad: string;
  /** Bu dönem cirosu */
  buDonem: number;
  /** Geçen yıl aynı dönem cirosu */
  gecenYil: number;
  /** Mutlak delta (TL) */
  delta: number;
  /** YoY % (null = geçen yıl 0) */
  yoyPct: number | null;
  /** Bölgenin toplam delta'sındaki bu kırılımın katkı yüzdesi */
  contributionPct: number;
};

export type FinanceCustomerStats = {
  aktifBu: number;
  aktifGecen: number;
  kaybedilen: number; // geçen yıl alışveriş yapıp bu yıl yapmayan müşteri sayısı
};

export type FinanceFacts = {
  region: string;
  /** Eğer analiz tek bir ürün grubuna fokuslandıysa onun adı; tüm bölge
   *  içinse undefined. UI bu bilgiyi başlığa bağlam olarak ekler ve
   *  Gemini prompt'una "bu grup için" cümlesi ekler. */
  productGroup?: string;
  buDonem: number;
  gecenYil: number;
  delta: number;
  yoyPct: number | null;
  /** Distribütör kırılımı, delta'ya göre en kötüden en iyiye */
  distFactors: FinanceFactor[];
  /** Müşteri grubu kırılımı (HORECA/Off-trade/Otel vs) */
  channelFactors: FinanceFactor[];
  /** Ürün grubu kırılımı (top kategoriler) — productGroup verildiyse
   *  o grubun içindeki SKU breakdown. */
  productFactors: FinanceFactor[];
  /** Müşteri sayısı istatistikleri */
  customers: FinanceCustomerStats;
};

export type FinanceAnalysis = {
  region: string;
  generatedAt: string;
  facts: FinanceFacts;
  /** Gemini'den dönen markdown analiz */
  markdown: string;
};

// ---------------------------------------------------------------------------
// SQL fetchers (her biri tek bir kırılım, paralel çalışır)
// ---------------------------------------------------------------------------

/**
 * Bölge toplam YoY: son 30g vs 12 ay öncesinin aynı 30g penceresi.
 *
 * NOT: `TBLDIST.TXTGRUP` numeric **kod**'u tutar (örn. "60"); bölgenin
 * display adı (örn. "IST-AVRUPA") için `TBLDISTGRUP.TXTAD`'a JOIN'le.
 * Filtre `dg.TXTAD` üzerinden, case-insensitive (UPPER + TRIM).
 */
async function fetchRegionTotal(
  region: string,
  productGroup?: string,
): Promise<{ bu: number; gecen: number }> {
  const escRegion = esc(region);
  // productGroup verildiyse fatura toplamı yerine detay-bazlı (DBLNETFIYAT)
  // hesaplıyoruz ve TBLURUN/TBLURUNGRUP üzerinden filtreliyoruz.
  // Fatura toplamı (DBLNETTUTAR) tek bir grup için filtre yapılamaz çünkü
  // bir fatura birden fazla ürün grubu içerebilir.
  const isFiltered = !!productGroup;
  const valExpr = isFiltered ? "bd.DBLNETFIYAT" : "f.DBLNETTUTAR";
  const productJoin = isFiltered
    ? `INNER JOIN dbo.TBLMSDBELGEDETAY bd
         ON bd.LNGYIL = f.LNGYIL
        AND bd.LNGFATURAKOD = f.LNGBELGEKOD
        AND bd.LNGDISTKOD = f.LNGDISTKOD
       INNER JOIN dbo.TBLURUN u ON u.LNGKOD = bd.LNGURUNKOD
       LEFT JOIN dbo.TBLURUNGRUP ug
         ON ug.TXTKOD = u.TXTURUNGRUPKOD`
    : "";
  const productFilter = isFiltered
    ? `AND UPPER(LTRIM(RTRIM(COALESCE(ug.TXTAD, u.TXTAD)))) = UPPER(LTRIM(RTRIM('${esc(productGroup!)}')))`
    : "";
  const sql = `
    SELECT
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
               THEN ${valExpr} ELSE 0 END) AS bu,
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
               THEN ${valExpr} ELSE 0 END) AS gecen
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = d.TXTGRUP
    ${productJoin}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND d.BYTDURUM = 0
      AND UPPER(LTRIM(RTRIM(dg.TXTAD))) = UPPER(LTRIM(RTRIM('${escRegion}')))
      ${productFilter}
      AND (
        f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        OR (
          f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
          AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()})
        )
      )
  `;
  const out = await runReadOnly(sql, {
    limit: 1,
    timeoutMs: 30_000,
  });
  const r = out.rows[0] ?? { bu: 0, gecen: 0 };
  return { bu: Number(r.bu ?? 0), gecen: Number(r.gecen ?? 0) };
}

/** Bölge × Distribütör YoY (son 30g vs 12 ay öncesi aynı pencere).
 *  productGroup verildiyse sadece o grup için distribütör kırılımı. */
async function fetchDistFactors(
  region: string,
  productGroup?: string,
): Promise<FinanceFactor[]> {
  const escRegion = esc(region);
  const isFiltered = !!productGroup;
  const valExpr = isFiltered ? "bd.DBLNETFIYAT" : "f.DBLNETTUTAR";
  const productJoin = isFiltered
    ? `INNER JOIN dbo.TBLMSDBELGEDETAY bd
         ON bd.LNGYIL = f.LNGYIL
        AND bd.LNGFATURAKOD = f.LNGBELGEKOD
        AND bd.LNGDISTKOD = f.LNGDISTKOD
       INNER JOIN dbo.TBLURUN u ON u.LNGKOD = bd.LNGURUNKOD
       LEFT JOIN dbo.TBLURUNGRUP ug
         ON ug.TXTKOD = u.TXTURUNGRUPKOD`
    : "";
  const productFilter = isFiltered
    ? `AND UPPER(LTRIM(RTRIM(COALESCE(ug.TXTAD, u.TXTAD)))) = UPPER(LTRIM(RTRIM('${esc(productGroup!)}')))`
    : "";
  const sql = `
    SELECT TOP 10
      d.TXTAD AS ad,
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
               THEN ${valExpr} ELSE 0 END) AS bu,
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
               THEN ${valExpr} ELSE 0 END) AS gecen
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = d.TXTGRUP
    ${productJoin}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND d.BYTDURUM = 0
      AND UPPER(LTRIM(RTRIM(dg.TXTAD))) = UPPER(LTRIM(RTRIM('${escRegion}')))
      ${productFilter}
      AND (
        f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        OR (
          f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
          AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()})
        )
      )
    GROUP BY d.TXTAD
    ORDER BY ABS(SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
                          THEN ${valExpr} ELSE 0 END)
              - SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                          AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
                          THEN ${valExpr} ELSE 0 END)) DESC
  `;
  const out = await runReadOnly(sql, {
    limit: 12,
    timeoutMs: 45_000,
  });
  return out.rows.map((r) => {
    const bu = Number(r.bu ?? 0);
    const gecen = Number(r.gecen ?? 0);
    const delta = bu - gecen;
    return {
      ad: String(r.ad ?? "(?)"),
      buDonem: bu,
      gecenYil: gecen,
      delta,
      yoyPct: gecen > 0 ? (delta / gecen) * 100 : null,
      contributionPct: 0, // post-process'te dolduruluyor
    };
  });
}

/** Bölge × Müşteri grubu YoY (HORECA/Off-trade/Otel vs).
 *  productGroup verildiyse sadece o grup için kanal kırılımı. */
async function fetchChannelFactors(
  region: string,
  productGroup?: string,
): Promise<FinanceFactor[]> {
  const escRegion = esc(region);
  const isFiltered = !!productGroup;
  const valExpr = isFiltered ? "bd.DBLNETFIYAT" : "f.DBLNETTUTAR";
  const productJoin = isFiltered
    ? `INNER JOIN dbo.TBLMSDBELGEDETAY bd
         ON bd.LNGYIL = f.LNGYIL
        AND bd.LNGFATURAKOD = f.LNGBELGEKOD
        AND bd.LNGDISTKOD = f.LNGDISTKOD
       INNER JOIN dbo.TBLURUN u ON u.LNGKOD = bd.LNGURUNKOD
       LEFT JOIN dbo.TBLURUNGRUP ug
         ON ug.TXTKOD = u.TXTURUNGRUPKOD`
    : "";
  const productFilter = isFiltered
    ? `AND UPPER(LTRIM(RTRIM(COALESCE(ug.TXTAD, u.TXTAD)))) = UPPER(LTRIM(RTRIM('${esc(productGroup!)}')))`
    : "";
  const sql = `
    SELECT TOP 10
      ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Grupsuz)') AS ad,
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
               THEN ${valExpr} ELSE 0 END) AS bu,
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
               THEN ${valExpr} ELSE 0 END) AS gecen
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = d.TXTGRUP
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
    LEFT JOIN dbo.TBLMUSTERIGRUP g ON g.TXTKOD = m.TXTGRUPKOD
    ${productJoin}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND d.BYTDURUM = 0
      AND m.BYTDURUM = 0
      AND UPPER(LTRIM(RTRIM(dg.TXTAD))) = UPPER(LTRIM(RTRIM('${escRegion}')))
      ${productFilter}
      AND (
        f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        OR (
          f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
          AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()})
        )
      )
    GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(g.TXTAD)), ''), '(Grupsuz)')
    ORDER BY ABS(SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
                          THEN ${valExpr} ELSE 0 END)
              - SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                          AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
                          THEN ${valExpr} ELSE 0 END)) DESC
  `;
  const out = await runReadOnly(sql, {
    limit: 12,
    timeoutMs: 45_000,
  });
  return out.rows.map((r) => {
    const bu = Number(r.bu ?? 0);
    const gecen = Number(r.gecen ?? 0);
    const delta = bu - gecen;
    return {
      ad: String(r.ad ?? "(?)"),
      buDonem: bu,
      gecenYil: gecen,
      delta,
      yoyPct: gecen > 0 ? (delta / gecen) * 100 : null,
      contributionPct: 0,
    };
  });
}

/** Bölge × Ürün grubu YoY (top kategoriler).
 *  productGroup verildiyse o grup içindeki SKU breakdown'a geçer
 *  (örn. VODKA seçildiyse → Absolut, Stoli, Smirnoff vb. SKU kırılımı). */
async function fetchProductFactors(
  region: string,
  productGroup?: string,
): Promise<FinanceFactor[]> {
  const escRegion = esc(region);
  const isFiltered = !!productGroup;
  // Filtre varsa GROUP BY ürün adına (u.TXTAD) düş — kullanıcı zaten "VODKA"
  // grubunu seçti, içeride hangi SKU'lar performans değiştirdi onu görmeli.
  // Filtre yoksa eski davranış: ürün grubuna göre grupla.
  const groupByExpr = isFiltered
    ? "u.TXTAD"
    : "ISNULL(NULLIF(LTRIM(RTRIM(ug.TXTAD)), ''), u.TXTAD)";
  const productFilter = isFiltered
    ? `AND UPPER(LTRIM(RTRIM(COALESCE(ug.TXTAD, u.TXTAD)))) = UPPER(LTRIM(RTRIM('${esc(productGroup!)}')))`
    : "";
  const sql = `
    SELECT TOP 10
      ${groupByExpr} AS ad,
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
               THEN bd.DBLNETFIYAT ELSE 0 END) AS bu,
      SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
               THEN bd.DBLNETFIYAT ELSE 0 END) AS gecen
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = d.TXTGRUP
    INNER JOIN dbo.TBLMSDBELGEDETAY bd
      ON bd.LNGYIL = f.LNGYIL
     AND bd.LNGFATURAKOD = f.LNGBELGEKOD
     AND bd.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u ON u.LNGKOD = bd.LNGURUNKOD
    LEFT JOIN dbo.TBLURUNGRUP ug
      ON ug.TXTKOD = u.TXTURUNGRUPKOD
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND d.BYTDURUM = 0
      AND UPPER(LTRIM(RTRIM(dg.TXTAD))) = UPPER(LTRIM(RTRIM('${escRegion}')))
      ${productFilter}
      AND (
        f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        OR (
          f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
          AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()})
        )
      )
    GROUP BY ${groupByExpr}
    ORDER BY ABS(SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
                          THEN bd.DBLNETFIYAT ELSE 0 END)
              - SUM(CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                          AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
                          THEN bd.DBLNETFIYAT ELSE 0 END)) DESC
  `;
  const out = await runReadOnly(sql, {
    limit: 12,
    timeoutMs: 60_000,
  });
  return out.rows.map((r) => {
    const bu = Number(r.bu ?? 0);
    const gecen = Number(r.gecen ?? 0);
    const delta = bu - gecen;
    return {
      ad: String(r.ad ?? "(?)"),
      buDonem: bu,
      gecenYil: gecen,
      delta,
      yoyPct: gecen > 0 ? (delta / gecen) * 100 : null,
      contributionPct: 0,
    };
  });
}

/** Aktif/kaybedilen müşteri sayıları. productGroup verildiyse sadece o
 *  grubu satın alan müşteri sayıları. */
async function fetchCustomerStats(
  region: string,
  productGroup?: string,
): Promise<FinanceCustomerStats> {
  const escRegion = esc(region);
  const isFiltered = !!productGroup;
  const productJoin = isFiltered
    ? `INNER JOIN dbo.TBLMSDBELGEDETAY bd
         ON bd.LNGYIL = f.LNGYIL
        AND bd.LNGFATURAKOD = f.LNGBELGEKOD
        AND bd.LNGDISTKOD = f.LNGDISTKOD
       INNER JOIN dbo.TBLURUN u ON u.LNGKOD = bd.LNGURUNKOD
       LEFT JOIN dbo.TBLURUNGRUP ug
         ON ug.TXTKOD = u.TXTURUNGRUPKOD`
    : "";
  const productFilter = isFiltered
    ? `AND UPPER(LTRIM(RTRIM(COALESCE(ug.TXTAD, u.TXTAD)))) = UPPER(LTRIM(RTRIM('${esc(productGroup!)}')))`
    : "";
  // Aynı JOIN+filter churn sorgusunda da kullanılacak, alias kollizyonu olmasın
  // diye prev/cur subquery'lerine ayrı verisi gönderiyoruz.
  const productJoinPrev = isFiltered
    ? productJoin.replace(/\bbd\b/g, "bd_p").replace(/\bu\b/g, "u_p").replace(/\bug\b/g, "ug_p").replace(/\bf\b/g, "f").replace(/\bbd_p\b/g, "bd_p")
    : "";
  // Yukarıdaki replace zinciri kırılgan — daha güvenli, prev/cur için
  // baştan ayrı join string'leri yazıyoruz:
  const productJoinForChurn = (faturaAlias: string, suffix: string) =>
    isFiltered
      ? `INNER JOIN dbo.TBLMSDBELGEDETAY bd_${suffix}
           ON bd_${suffix}.LNGYIL = ${faturaAlias}.LNGYIL
          AND bd_${suffix}.LNGFATURAKOD = ${faturaAlias}.LNGBELGEKOD
          AND bd_${suffix}.LNGDISTKOD = ${faturaAlias}.LNGDISTKOD
         INNER JOIN dbo.TBLURUN u_${suffix} ON u_${suffix}.LNGKOD = bd_${suffix}.LNGURUNKOD
         LEFT JOIN dbo.TBLURUNGRUP ug_${suffix}
           ON ug_${suffix}.TXTKOD = u_${suffix}.TXTURUNGRUPKOD`
      : "";
  const productFilterForChurn = (suffix: string) =>
    isFiltered
      ? `AND UPPER(LTRIM(RTRIM(COALESCE(ug_${suffix}.TXTAD, u_${suffix}.TXTAD)))) = UPPER(LTRIM(RTRIM('${esc(productGroup!)}')))`
      : "";
  void productJoinPrev; // helper'ı ayrı yazdığımız için artık kullanılmıyor

  const sql = `
    SELECT
      COUNT(DISTINCT CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
                          THEN f.LNGMUSTERIKOD END) AS aktif_bu,
      COUNT(DISTINCT CASE WHEN f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
                            AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
                          THEN f.LNGMUSTERIKOD END) AS aktif_gecen
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = d.TXTGRUP
    ${productJoin}
    WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND d.BYTDURUM = 0
      AND UPPER(LTRIM(RTRIM(dg.TXTAD))) = UPPER(LTRIM(RTRIM('${escRegion}')))
      ${productFilter}
      AND (
        f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
        OR (
          f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
          AND f.TRHISLEMTARIHI < DATEADD(day, -365, ${sqlNow()})
        )
      )
  `;
  const out = await runReadOnly(sql, {
    limit: 1,
    timeoutMs: 30_000,
  });
  const r = out.rows[0] ?? { aktif_bu: 0, aktif_gecen: 0 };

  // Kaybedilen müşteri: geçen yıl alışveriş yapıp bu yıl yapmayan
  // (productGroup verildiyse "bu grubu") — prev/cur ayrı alias suffix
  const churnSql = `
    SELECT COUNT(DISTINCT prev.LNGMUSTERIKOD) AS kaybedilen
    FROM (
      SELECT DISTINCT f.LNGMUSTERIKOD
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLDIST d ON d.LNGKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLDISTGRUP dg ON dg.TXTKOD = d.TXTGRUP
      ${productJoinForChurn("f", "p")}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND d.BYTDURUM = 0
        AND UPPER(LTRIM(RTRIM(dg.TXTAD))) = UPPER(LTRIM(RTRIM('${escRegion}')))
        ${productFilterForChurn("p")}
        AND f.TRHISLEMTARIHI >= DATEADD(day, -395, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -365, ${sqlNow()})
    ) prev
    LEFT JOIN (
      SELECT DISTINCT f2.LNGMUSTERIKOD
      FROM dbo.TBLMSDFATURA f2
      INNER JOIN dbo.TBLDIST d2 ON d2.LNGKOD = f2.LNGDISTKOD
      INNER JOIN dbo.TBLDISTGRUP dg2 ON dg2.TXTKOD = d2.TXTGRUP
      ${productJoinForChurn("f2", "c")}
      WHERE f2.BYTTUR = 0 AND f2.BYTDURUM = 0
        AND d2.BYTDURUM = 0
        AND UPPER(LTRIM(RTRIM(dg2.TXTAD))) = UPPER(LTRIM(RTRIM('${escRegion}')))
        ${productFilterForChurn("c")}
        AND f2.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
    ) cur ON cur.LNGMUSTERIKOD = prev.LNGMUSTERIKOD
    WHERE cur.LNGMUSTERIKOD IS NULL
  `;
  const churnOut = await runReadOnly(churnSql, {
    limit: 1,
    timeoutMs: 30_000,
  });

  return {
    aktifBu: Number(r.aktif_bu ?? 0),
    aktifGecen: Number(r.aktif_gecen ?? 0),
    kaybedilen: Number(
      (churnOut.rows[0] as { kaybedilen?: number } | undefined)?.kaybedilen ?? 0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Gemini prompt — finans analisti rolü
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `Sen bir finans analistisin (FP&A — Financial Planning & Analysis).
Görevin: bir satış bölgesinin YoY (yıldan yıla) ciro değişimini decompose etmek
ve KÖKEN nedenlerini belirlemek.

Çıktı formatı (Türkçe, markdown):

## Özet
Tek paragraf, finans diliyle. Variance kaynaklarını belirt (mix, volume,
distribütör kaybı, müşteri kaybı vs.). Spekülasyon yok — sadece veriden çıkan.

## Kök Nedenler
3-5 madde. Her madde:
- **[Kırılım adı]**: -₺X.X M (-%Y YoY) — sebep açıklaması.

Madde sıralaması delta'nın mutlak büyüklüğüne göre (en kötü en üstte).

## Aksiyon Önerisi
2-3 madde. Spesifik, ölçülebilir, finans tarafının takip edebileceği
(örn. "BH ANKARA'da geçen yıl alan 23 müşterinin 15'i bu yıl alış yapmadı —
saha satış müdüründen sebep raporu istenmeli").

KURALLAR:
- "potansiyelini değerlendir" gibi içi boş ifade KULLANMA.
- Spekülasyon yapma — verilen rakamlara bağlı kal.
- Yorumlar finans diliyle (variance, mix, volume) olsun ama jargon abartısı yok.
- Para birimi: TL. Büyük rakamları "M" (milyon) veya "Mr" (milyar) ile kısalt.
- Yüzdeleri "%" işaretiyle ve tek ondalık göster (örn. "-%72.4").`;

function buildUserPrompt(facts: FinanceFacts): string {
  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} Mr`;
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)} K`;
    return n.toFixed(0);
  };
  const pct = (n: number | null) =>
    n == null ? "(geçen yıl 0)" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

  const distLines = facts.distFactors
    .slice(0, 8)
    .map(
      (f) =>
        `  - ${f.ad}: bu=₺${fmt(f.buDonem)}, geçen=₺${fmt(f.gecenYil)}, delta=₺${fmt(f.delta)} (${pct(f.yoyPct)}), katkı=%${f.contributionPct.toFixed(1)}`,
    )
    .join("\n");

  const chLines = facts.channelFactors
    .slice(0, 6)
    .map(
      (f) =>
        `  - ${f.ad}: bu=₺${fmt(f.buDonem)}, geçen=₺${fmt(f.gecenYil)}, delta=₺${fmt(f.delta)} (${pct(f.yoyPct)}), katkı=%${f.contributionPct.toFixed(1)}`,
    )
    .join("\n");

  const prodLines = facts.productFactors
    .slice(0, 6)
    .map(
      (f) =>
        `  - ${f.ad}: bu=₺${fmt(f.buDonem)}, geçen=₺${fmt(f.gecenYil)}, delta=₺${fmt(f.delta)} (${pct(f.yoyPct)}), katkı=%${f.contributionPct.toFixed(1)}`,
    )
    .join("\n");

  const scopeHeader = facts.productGroup
    ? `Bölge: **${facts.region}** · Ürün grubu fokusu: **${facts.productGroup}**

⚠️ Bu analiz YALNIZCA "${facts.productGroup}" ürün grubunun ${facts.region} bölgesindeki performansına odaklanır. Diğer ürün gruplarından bahsetme — onlar bu analizin dışında. Tüm rakamlar (ciro, müşteri sayısı, distribütör/kanal kırılımı) bu grupla filtrelenmiştir.`
    : `Bölge: **${facts.region}**`;

  const productSectionLabel = facts.productGroup
    ? `SKU kırılımı (${facts.productGroup} ürün grubu içinde, delta büyüklüğüne göre):`
    : "Ürün grubu kırılımı:";

  return `${scopeHeader}

Son 30 gün ciro: ₺${fmt(facts.buDonem)}
Geçen yıl aynı 30 gün: ₺${fmt(facts.gecenYil)}
YoY delta: ₺${fmt(facts.delta)} (${pct(facts.yoyPct)})

Müşteri sayısı${facts.productGroup ? ` (${facts.productGroup} grubunu alan müşteriler)` : ""}:
  - Bu dönem aktif: ${facts.customers.aktifBu}
  - Geçen yıl aktif: ${facts.customers.aktifGecen}
  - Kaybedilen (geçen yıl alıp bu yıl almayan): ${facts.customers.kaybedilen}

Distribütör kırılımı (delta büyüklüğüne göre, en üstte en kötü)${facts.productGroup ? ` · sadece ${facts.productGroup}` : ""}:
${distLines || "  (veri yok)"}

Müşteri grubu kırılımı${facts.productGroup ? ` · sadece ${facts.productGroup}` : ""}:
${chLines || "  (veri yok)"}

${productSectionLabel}
${prodLines || "  (veri yok)"}

Yukarıdaki verileri kullanarak finans analizi yap.`;
}

// ---------------------------------------------------------------------------
// Helper: contributionPct hesaplama (her kırılım için delta / toplam delta)
// ---------------------------------------------------------------------------

function fillContributions(factors: FinanceFactor[], totalDelta: number): void {
  if (totalDelta === 0) return;
  for (const f of factors) {
    f.contributionPct = (f.delta / totalDelta) * 100;
  }
}

// ---------------------------------------------------------------------------
// Ana entry — cached
// ---------------------------------------------------------------------------

export async function analyzeRegionAnomaly(
  region: string,
  options: { forceRefresh?: boolean; productGroup?: string } = {},
): Promise<FinanceAnalysis> {
  const cleaned = region.trim();
  if (!cleaned) throw new Error("region parametresi boş.");
  const productGroup = options.productGroup?.trim() || undefined;

  // CACHE_VERSION — SQL JOIN şekli veya prompt değiştiğinde bump et
  // (TTL yok, eski entry'ler aksi halde yaşamaya devam eder).
  // v2: TBLURUNGRUP JOIN'inde LNGDISTKOD constraint'i kaldırıldı.
  const CACHE_VERSION = "v2";
  // Cache key'e productGroup'u dahil et — aynı bölge için "tüm gruplar"
  // ve "VODKA" analizleri ayrı cache satırı olmalı.
  const cacheKey = productGroup
    ? `${CACHE_VERSION}::${cleaned.toUpperCase()}::pg::${productGroup.toUpperCase()}`
    : `${CACHE_VERSION}::${cleaned.toUpperCase()}`;

  const cached = await withCache<FinanceAnalysis>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      // Paralel veri toplama — productGroup tüm fetcher'lara geçer
      const [total, distFactors, channelFactors, productFactors, customers] =
        await Promise.all([
          fetchRegionTotal(cleaned, productGroup),
          fetchDistFactors(cleaned, productGroup).catch((e) => {
            console.error("[finance-agent dist]", e);
            return [] as FinanceFactor[];
          }),
          fetchChannelFactors(cleaned, productGroup).catch((e) => {
            console.error("[finance-agent channel]", e);
            return [] as FinanceFactor[];
          }),
          fetchProductFactors(cleaned, productGroup).catch((e) => {
            console.error("[finance-agent product]", e);
            return [] as FinanceFactor[];
          }),
          fetchCustomerStats(cleaned, productGroup).catch((e) => {
            console.error("[finance-agent customers]", e);
            return { aktifBu: 0, aktifGecen: 0, kaybedilen: 0 };
          }),
        ]);

      const delta = total.bu - total.gecen;
      const yoyPct = total.gecen > 0 ? (delta / total.gecen) * 100 : null;

      // Contribution yüzdeleri
      fillContributions(distFactors, delta);
      fillContributions(channelFactors, delta);
      fillContributions(productFactors, delta);

      const facts: FinanceFacts = {
        region: cleaned,
        ...(productGroup ? { productGroup } : {}),
        buDonem: total.bu,
        gecenYil: total.gecen,
        delta,
        yoyPct,
        distFactors,
        channelFactors,
        productFactors,
        customers,
      };

      // Gemini analiz
      let markdown = "";
      try {
        markdown = await generate(SYSTEM_INSTRUCTION, buildUserPrompt(facts), {
          temperature: 0.15,
          maxOutputTokens: 1600,
        });
      } catch (e) {
        console.error("[finance-agent gemini]", e);
        markdown = `_AI analiz şu an üretilemedi. Yapılandırılmış veri aşağıda._\n\n**${cleaned}**: YoY ${yoyPct != null ? yoyPct.toFixed(1) : "?"}% (₺${(delta / 1_000_000).toFixed(2)} M değişim)`;
      }

      return {
        region: cleaned,
        generatedAt: new Date().toISOString(),
        facts,
        markdown,
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  return cached.value;
}
