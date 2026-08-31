/**
 * Wietnauer Dashboard #6 — Müşteri Aktivasyon & Risk
 *
 * Bu modül 5 panele veri besler:
 *   A) 90g Aktif Müşteri sayısı + segment kırılımı (TBLMUSTERIGRUPKIRILIM —
 *      müşteri grup kırılımı: Prestige/Premium/Premium Plus/Standart/…)
 *   B) Sessizleşen Müşteri Listesi (önceki 90g'de var, son 90g'de yok)
 *   C) Stratejik Marka Sessizliği — her marka için son-90g-sessiz müşteri sayısı
 *   D) Risk Tier Dağılımı — SQLite map_customers.risk_tier_v2
 *   E) Yeniden Kazanım Fırsatları — yüksek geçmiş cirosu ama son 90g sessiz
 *
 * Pencere disiplini: tüm MSSQL sorguları KAPALI PENCERE pattern'ini kullanır
 *   (alt + üst sınır). Açık `>=` tek başına DEMO_DATE'in ötesini de sızdırır.
 *
 * Cache stratejisi: MSSQL fetcher'lar (A, B, C) full dataset (tüm dist'ler)
 * TEK cache anahtarı altında `withCache` — wietnauer-stok.ts `scopedRows`
 * deseni. SQLite fetcher'lar (D, E — `map_customers` local mirror) zaten
 * ucuz/lokal olduğu için `allowedDistKods` ile doğrudan filtrelenmeye devam
 * eder (MSSQL'e gitmiyorlar, VYK-01 kapsamı dışı).
 */
import path from "node:path";
import { withCache } from "./cache.js";
import { sqlNow } from "./now.js";
import { currentDate } from "./now.js";
import { runReadOnly } from "./db.js";
import { getLocalDb } from "./local-db.js";
import { getTenantConfig } from "./tenant/index.js";
import { fileURLToPath } from "node:url";
import { cityFactClause, cityCacheTag } from "./auth.js";

const CACHE_DOMAIN = "wietnauer-aktivasyon";
// v4: cache-key scope fragmentation düzeltmesi (VYK-01) — MSSQL fetcher'lar
// (A: aktif müşteri, B: sessiz müşteri, C: stratejik marka sessizliği)
// scope'suz (tüm dist) tek cache anahtarı altında çekilir; dist_id
// SELECT/GROUP BY'a eklendi ki JS tarafı scope filtresi + re-aggregate
// yapabilsin. D/E (SQLite) değişmedi — zaten allowedDistKods ile lokal
// filtreleniyor.
// v5: Panel A (fetchActiveCustomers90dRaw) segment kaynağı TBLMUSTERIGRUP'tan
// TBLMUSTERIGRUPKIRILIM'e (müşteri grup kırılımı: Prestige/Premium/…)
// değiştirildi — eski segment değerleriyle cache çakışmasın diye bump.
const CACHE_VERSION = "v5";

// ES module __dirname eşdeğeri — Node 22+ ESM scope'ta __dirname tanımsız.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../../..");

// ---------- Tipler ----------------------------------------------------------

export type ActiveCustomersSegment = {
  /** TBLMUSTERIGRUPKIRILIM.TXTAD — müşteri grup kırılımı (Prestige/Premium/
   *  Premium Plus/Standart/Standart Plus/Off Trade C&PS Tedarikçi vb.) veya
   *  "(Tanımsız)" (TBLMUSTERI.TXTGRUPKIRILIMKOD boş/eşleşmiyorsa). */
  segment: string;
  musteriSayi: number;
  /** Toplam aktif müşteri içindeki pay (%) */
  payPct: number;
};

export type ActiveCustomers90d = {
  /** Son 90g'de en az 1 fatura kesilmiş distinct müşteri sayısı */
  toplam: number;
  /** Önceki 90g (180-90 arası) içindeki aktif sayı — trend için */
  oncekiToplam: number;
  /** Önceki döneme göre fark (yüzde) */
  degisimPct: number;
  segments: ActiveCustomersSegment[];
};

export type SilentCustomer = {
  id: number;
  unvan: string;
  sehir: string | null;
  /** Müşterinin son satış tarihi (ISO) */
  sonSatisTarihi: string | null;
  /** Müşteri kaç gündür sessiz (son satış tarihinden bugüne) */
  sessizGun: number;
  /** Önceki 90g'de (180..90 arası) yapılmış toplam net ciro */
  oncekiCiro: number;
  /** Son alındığı dönem markası — en yüksek paylı */
  sonMarka: string | null;
};

export type StrategicBrandSilence = {
  marka: string;
  /** Bu markadan satış yapan tüm müşteri sayısı (180..0 gün penceresi) */
  toplamMusteri: number;
  /** Son 90 günde bu markadan satış yapmayan müşteri sayısı */
  sessizMusteri: number;
  sessizPct: number;
};

export type RiskTierBucket = {
  /** "critical" | "risk" | "watch" | "healthy" | "unknown" */
  tier: string;
  musteriSayi: number;
  payPct: number;
};

export type RecoveryTarget = {
  id: number;
  unvan: string;
  sehir: string | null;
  /** SQLite: ciro_t90 — son 90g ciro mirror'ı */
  cirot90: number;
  /** SQLite: days_since_last_sale */
  sessizGun: number;
  riskTier: string | null;
};

export type WietnauerAktivasyonSnapshot = {
  generatedAt: string;
  demoDate: string | null;
  active: ActiveCustomers90d;
  silent: SilentCustomer[];
  strategicSilence: StrategicBrandSilence[];
  riskTiers: RiskTierBucket[];
  recovery: RecoveryTarget[];
};

// ---------- MSSQL fetcher'ları ---------------------------------------------

/**
 * Son 90 günde en az 1 fatura kesilmiş distinct müşteri sayısı +
 * TBLMUSTERIEKSAHA (saha 8) müşteri tipi kırılımı.
 *
 * Bonus: önceki 90 günün (180..90 arası) sayısını da getirir → trend.
 */
type ActiveCustomers90dRawRow = {
  distId: number | null;
  musteriId: number;
  isAktif: boolean;
  isOnceki: boolean;
  segment: string;
};

/**
 * Son 90g / önceki 90g aktif müşteri × dist × segment ham satırları —
 * scope-free. Distinct müşteri satır seviyesinde döner (~8-9K aktif, aynı
 * mertebede wietnauer-stok.ts ile) — dist ve segment JS tarafında
 * hesaplanabilsin diye. `f.LNGDISTKOD` her satırda mevcut.
 */
async function fetchActiveCustomers90dRaw(cities?: string[] | null): Promise<ActiveCustomers90dRawRow[]> {
  // Segment = müşteri grup kırılımı: TBLMUSTERI.TXTGRUPKIRILIMKOD →
  // TBLMUSTERIGRUPKIRILIM.TXTAD (Prestige/Premium/Premium Plus/Standart/
  // Standart Plus/Off Trade C&PS Tedarikçi vb.).
  const sql = `
    WITH aktif AS (
      SELECT DISTINCT f.LNGMUSTERIKOD AS musteri_id, f.LNGDISTKOD AS dist_id
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -90, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    ),
    onceki AS (
      SELECT DISTINCT f.LNGMUSTERIKOD AS musteri_id, f.LNGDISTKOD AS dist_id
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -180, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -90, ${sqlNow()})${cityFactClause(cities)}
    ),
    combos AS (
      SELECT musteri_id, dist_id FROM aktif
      UNION
      SELECT musteri_id, dist_id FROM onceki
    )
    SELECT
      c.musteri_id,
      c.dist_id,
      CASE WHEN a.musteri_id IS NOT NULL THEN 1 ELSE 0 END AS is_aktif,
      CASE WHEN o.musteri_id IS NOT NULL THEN 1 ELSE 0 END AS is_onceki,
      ISNULL(NULLIF(LTRIM(RTRIM(k.TXTAD)), ''), '(Tanımsız)') AS segment
    FROM combos c
    LEFT JOIN aktif a ON a.musteri_id = c.musteri_id AND a.dist_id = c.dist_id
    LEFT JOIN onceki o ON o.musteri_id = c.musteri_id AND o.dist_id = c.dist_id
    LEFT JOIN dbo.TBLMUSTERI m ON m.LNGKOD = c.musteri_id
    LEFT JOIN dbo.TBLMUSTERIGRUPKIRILIM k ON k.TXTKOD = m.TXTGRUPKIRILIMKOD
  `;
  // ~8-9K distinct müşteri (90g aktif) — wietnauer-stok.ts cardinality ile
  // aynı mertebede.
  const result = await runReadOnly(sql, { limit: 20_000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    musteriId: Number(r.musteri_id),
    isAktif: Number(r.is_aktif ?? 0) === 1,
    isOnceki: Number(r.is_onceki ?? 0) === 1,
    segment: String(r.segment ?? "(Tanımsız)"),
  }));
}

/** dist-scope uygulanmış ham satırları toplayıp aktif müşteri KPI + segment kırılımına çevirir. */
function aggregateActiveCustomers90d(rows: ActiveCustomers90dRawRow[]): ActiveCustomers90d {
  const aktifRows = rows.filter((r) => r.isAktif);
  const toplam = aktifRows.length;
  const oncekiToplam = rows.filter((r) => r.isOnceki).length;
  const degisimPct = oncekiToplam > 0 ? ((toplam - oncekiToplam) / oncekiToplam) * 100 : 0;

  const bySegment = new Map<string, number>();
  for (const row of aktifRows) {
    bySegment.set(row.segment, (bySegment.get(row.segment) ?? 0) + 1);
  }
  const segments: ActiveCustomersSegment[] = [...bySegment.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([segment, sayi]) => ({
      segment,
      musteriSayi: sayi,
      payPct: toplam > 0 ? (sayi / toplam) * 100 : 0,
    }));

  return { toplam, oncekiToplam, degisimPct, segments };
}

/**
 * Sessizleşen müşteri listesi: önceki 90g'de (180..90 arası) fatura kesilmiş
 * ama son 90g'de hiç fatura olmayan müşteriler. Top 50, önceki 90g cirosuna
 * göre DESC. Her satırda son fatura tarihi + önceki 90g cirosu + son alınan
 * marka (önceki 90g'de en yüksek paylı marka).
 */
type SilentCustomerRawRow = Omit<SilentCustomer, "sessizGun"> & { distId: number | null };

/**
 * Tüm sessizleşen müşteriler (önceki 90g'de var, son 90g'de yok) — scope-free.
 * `TOP 50` kaldırıldı; dist scope uygulanmadan Top 50 kesilirse küçük dist'in
 * kendi sessiz müşterileri listeden düşebilir. Ölçüldü: ~4000 satır (tüm
 * dist'ler) — ucuz. `dist_id` müşterinin önceki-90g faturasındaki dist'i
 * (ROW_NUMBER ile en yüksek ciro) temsil eder. Top 50 scope SONRASI public
 * API'de hesaplanır.
 */
async function fetchSilentCustomersRaw(cities?: string[] | null): Promise<SilentCustomerRawRow[]> {
  const tenant = getTenantConfig();
  const brandTable = tenant.brandTable;
  const joinCol = tenant.brandJoinColumn;
  if (!["TBLURUNEKGRUP", "TBLURUNGRUP"].includes(brandTable))
    throw new Error(`Geçersiz brandTable: ${brandTable}`);
  if (!["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"].includes(joinCol))
    throw new Error(`Geçersiz brandJoinColumn: ${joinCol}`);

  const sql = `
    WITH son_90 AS (
      SELECT DISTINCT f.LNGMUSTERIKOD AS musteri_id
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -90, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    ),
    onceki_90 AS (
      SELECT
        f.LNGMUSTERIKOD AS musteri_id,
        SUM(f.DBLNETTUTAR) AS onceki_ciro,
        MAX(f.TRHISLEMTARIHI) AS son_satis,
        -- Müşterinin önceki-90g'deki en yüksek cirolu dist'i — çoklu dist
        -- faturası olan müşteri için tek satır garantisi.
        (SELECT TOP 1 f2.LNGDISTKOD
         FROM dbo.TBLMSDFATURA f2
         WHERE f2.LNGMUSTERIKOD = f.LNGMUSTERIKOD
           AND f2.BYTTUR = 0 AND f2.BYTDURUM = 0
           AND f2.TRHISLEMTARIHI >= DATEADD(day, -180, ${sqlNow()})
           AND f2.TRHISLEMTARIHI <  DATEADD(day, -90, ${sqlNow()})
         GROUP BY f2.LNGDISTKOD
         ORDER BY SUM(f2.DBLNETTUTAR) DESC
        ) AS dist_id
      FROM dbo.TBLMSDFATURA f
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -180, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -90, ${sqlNow()})${cityFactClause(cities)}
      GROUP BY f.LNGMUSTERIKOD
    ),
    sessiz AS (
      SELECT o.musteri_id, o.onceki_ciro, o.son_satis, o.dist_id
      FROM onceki_90 o
      LEFT JOIN son_90 s ON s.musteri_id = o.musteri_id
      WHERE s.musteri_id IS NULL
    ),
    son_marka AS (
      SELECT
        sx.musteri_id,
        b.TXTAD AS marka,
        SUM(d.DBLNETFIYAT) AS marka_ciro,
        ROW_NUMBER() OVER (
          PARTITION BY sx.musteri_id ORDER BY SUM(d.DBLNETFIYAT) DESC
        ) AS rn
      FROM sessiz sx
      INNER JOIN dbo.TBLMSDFATURA f ON f.LNGMUSTERIKOD = sx.musteri_id
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN dbo.${brandTable} b ON b.TXTKOD = u.${joinCol}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -180, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, -90, ${sqlNow()})
      GROUP BY sx.musteri_id, b.TXTAD
    )
    SELECT
      sx.musteri_id AS id,
      sx.dist_id,
      m.TXTUNVAN AS unvan,
      m.TXTSEHIR AS sehir,
      sx.son_satis,
      sx.onceki_ciro,
      sm.marka AS son_marka
    FROM sessiz sx
    INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = sx.musteri_id
    LEFT JOIN son_marka sm ON sm.musteri_id = sx.musteri_id AND sm.rn = 1
    ORDER BY sx.onceki_ciro DESC
  `;
  const result = await runReadOnly(sql, { limit: 10_000, timeoutMs: 60_000 });
  return result.rows.map((r) => ({
    id: Number(r.id),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    unvan: String(r.unvan ?? ""),
    sehir: r.sehir ? String(r.sehir) : null,
    sonSatisTarihi: r.son_satis ? new Date(r.son_satis as string).toISOString() : null,
    oncekiCiro: Number(r.onceki_ciro ?? 0),
    sonMarka: r.son_marka ? String(r.son_marka) : null,
  }));
}

/** dist-scope uygulanmış satırları önceki ciro DESC sıralayıp Top 50 + sessizGün'ü hesaplar. */
function aggregateSilentCustomers(rows: SilentCustomerRawRow[]): SilentCustomer[] {
  const now = currentDate();
  return [...rows]
    .sort((a, b) => b.oncekiCiro - a.oncekiCiro)
    .slice(0, 50)
    .map((r) => {
      const sessizGun = r.sonSatisTarihi
        ? Math.max(0, Math.floor((now.getTime() - new Date(r.sonSatisTarihi).getTime()) / 86_400_000))
        : 0;
      return {
        id: r.id,
        unvan: r.unvan,
        sehir: r.sehir,
        sonSatisTarihi: r.sonSatisTarihi,
        sessizGun,
        oncekiCiro: r.oncekiCiro,
        sonMarka: r.sonMarka,
      };
    });
}

/**
 * Stratejik marka sessizliği: her stratejik marka için
 *   - toplam müşteri = son 180g içinde o markadan en az 1 fatura kesen müşteri
 *   - sessiz müşteri = bunlardan son 90g'de o markadan alım YAPMAYAN'lar
 *
 * Marka adları case-insensitive eşleşir (TR-aware). Marka tablosu Pernod ile
 * farklı olabilir (Wietnauer: TBLURUNGRUP) — config'ten okunur.
 */
type StrategicBrandSilenceRawRow = {
  marka: string;
  distId: number | null;
  toplamMusteri: number;
  sessizMusteri: number;
};

/**
 * Stratejik marka × dist sessizlik ham satırları — scope-free. `f.LNGDISTKOD`
 * hem `son_90` hem `toplam` CTE'sine eklendi; final GROUP BY marka+dist.
 * `toplamMusteri`/`sessizMusteri` dist bazında COUNT DISTINCT olduğundan
 * scope sonrası SUM ile doğru toplanır (bir müşteri faturası tek dist'e
 * bağlı). `strategicBrands` tenant config'ten (küçük, sabit liste).
 */
async function fetchStrategicBrandSilenceRaw(
  strategicBrands: string[],
  cities?: string[] | null,
): Promise<StrategicBrandSilenceRawRow[]> {
  if (strategicBrands.length === 0) return [];

  const tenant = getTenantConfig();
  const brandTable = tenant.brandTable;
  const joinCol = tenant.brandJoinColumn;
  if (!["TBLURUNEKGRUP", "TBLURUNGRUP"].includes(brandTable))
    throw new Error(`Geçersiz brandTable: ${brandTable}`);
  if (!["TXTURUNEKGRUPKOD", "TXTURUNGRUPKOD"].includes(joinCol))
    throw new Error(`Geçersiz brandJoinColumn: ${joinCol}`);

  // Marka isim listesi inline SQL'e quote-escape ile yazılır — SQL injection
  // emniyeti: tek tek REPLACE ile tek tırnak kaçırma.
  const escaped = strategicBrands
    .map((b) => `'${b.replace(/'/g, "''")}'`)
    .join(",");

  const sql = `
    WITH strat AS (
      SELECT TXTKOD, TXTAD
      FROM dbo.${brandTable}
      WHERE UPPER(TXTAD) IN (${escaped.toUpperCase()})
    ),
    son_90 AS (
      SELECT DISTINCT
        b.TXTKOD AS marka_kod,
        f.LNGDISTKOD AS dist_id,
        f.LNGMUSTERIKOD AS musteri_id
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN strat b ON b.TXTKOD = u.${joinCol}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -90, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    ),
    toplam AS (
      SELECT DISTINCT
        b.TXTKOD AS marka_kod,
        b.TXTAD AS marka,
        f.LNGDISTKOD AS dist_id,
        f.LNGMUSTERIKOD AS musteri_id
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN strat b ON b.TXTKOD = u.${joinCol}
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -180, ${sqlNow()})
        AND f.TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})${cityFactClause(cities)}
    )
    SELECT
      t.marka,
      t.dist_id,
      COUNT(DISTINCT t.musteri_id) AS toplam_musteri,
      SUM(CASE WHEN s.musteri_id IS NULL THEN 1 ELSE 0 END) AS sessiz_musteri
    FROM toplam t
    LEFT JOIN son_90 s
      ON s.marka_kod = t.marka_kod AND s.dist_id = t.dist_id AND s.musteri_id = t.musteri_id
    GROUP BY t.marka, t.dist_id
    ORDER BY sessiz_musteri DESC, toplam_musteri DESC
  `;
  const result = await runReadOnly(sql, { limit: 2000, timeoutMs: 45_000 });
  return result.rows.map((r) => ({
    marka: String(r.marka ?? ""),
    distId: r.dist_id != null ? Number(r.dist_id) : null,
    toplamMusteri: Number(r.toplam_musteri ?? 0),
    sessizMusteri: Number(r.sessiz_musteri ?? 0),
  }));
}

/** dist-scope uygulanmış ham satırları marka bazında re-aggregate eder. */
function aggregateStrategicBrandSilence(rows: StrategicBrandSilenceRawRow[]): StrategicBrandSilence[] {
  const byMarka = new Map<string, { marka: string; toplamMusteri: number; sessizMusteri: number }>();
  for (const row of rows) {
    const existing = byMarka.get(row.marka);
    if (existing) {
      existing.toplamMusteri += row.toplamMusteri;
      existing.sessizMusteri += row.sessizMusteri;
    } else {
      byMarka.set(row.marka, { marka: row.marka, toplamMusteri: row.toplamMusteri, sessizMusteri: row.sessizMusteri });
    }
  }
  return [...byMarka.values()]
    .sort((a, b) => (b.sessizMusteri - a.sessizMusteri) || (b.toplamMusteri - a.toplamMusteri))
    .map((m) => ({
      marka: m.marka,
      toplamMusteri: m.toplamMusteri,
      sessizMusteri: m.sessizMusteri,
      sessizPct: m.toplamMusteri > 0 ? Number(((m.sessizMusteri * 100) / m.toplamMusteri).toFixed(2)) : 0,
    }));
}

// ---------- SQLite (mirror) fetcher'ları -----------------------------------

/**
 * Risk tier dağılımı — SQLite mirror'dan tek-pass GROUP BY.
 * Tier değerleri: healthy / watch / risk / critical / unknown.
 *
 * map_customers tablosu boşsa veya `risk_tier_v2` kolonu null'sa boş array
 * döner — UI tarafı bu durumu "henüz hesaplanmamış" olarak ele alır.
 */
/**
 * SQLite (map_customers) mirror'u için şehir filtresi — MSSQL cityColClause'un
 * sqlite lehçesi karşılığı (N'...' yok, TRIM + tek-tırnak escape). cities null
 * → "" (kısıt yok), boş dizi → "AND 1=0". `map_customers.sehir` MSSQL TXTSEHIR'
 * den seed edildiği için birebir eşleşir.
 */
function citySqliteFilter(cities: string[] | null | undefined): string {
  if (!cities) return "";
  if (cities.length === 0) return "AND 1=0";
  const esc = cities.map((c) => `'${c.trim().replace(/'/g, "''")}'`).join(",");
  return `AND TRIM(sehir) IN (${esc})`;
}

function fetchRiskTierDistribution(
  allowedDistKods: number[] | null,
  cities: string[] | null,
): RiskTierBucket[] {
  const db = getLocalDb(DEFAULT_REPO_ROOT);
  try {
    // Dist kullanıcı → yalnızca izinli dist_kod'lara sahip müşteriler.
    // better-sqlite3 named/positional params kullanır — dizi elemanları
    // int garantili (auth.ts'de filtrelenmiş) olduğu için doğrudan `IN (...)`
    // interpolasyonu güvenlidir (stok modülündeki desenle aynı).
    const distFilter =
      allowedDistKods == null
        ? ""
        : allowedDistKods.length === 0
          ? "AND 1=0"
          : `AND dist_kod IN (${allowedDistKods.join(",")})`;
    const rows = db
      .prepare(
        `SELECT
           COALESCE(NULLIF(TRIM(risk_tier_v2), ''), 'unknown') AS tier,
           COUNT(*) AS sayi
         FROM map_customers
         WHERE 1=1 ${distFilter} ${citySqliteFilter(cities)}
         GROUP BY COALESCE(NULLIF(TRIM(risk_tier_v2), ''), 'unknown')`,
      )
      .all() as Array<{ tier: string; sayi: number }>;
    const toplam = rows.reduce((a, r) => a + Number(r.sayi || 0), 0);
    return rows.map((r) => ({
      tier: String(r.tier),
      musteriSayi: Number(r.sayi || 0),
      payPct: toplam > 0 ? (Number(r.sayi || 0) / toplam) * 100 : 0,
    }));
  } catch {
    // map_customers henüz oluşturulmamış olabilir → fail-soft.
    return [];
  }
}

/**
 * Yeniden kazanım fırsatları: SQLite mirror'da yüksek geçmiş cirosu olup
 * son 60g+ sessiz kalan müşteriler. ciro_t90 (son 90g ciro) DESC, üst 20.
 *
 * NOT: ciro_t90 mirror'da son 90 günlük net ciro snapshot'ıdır. "Yüksek
 * geçmiş cirosu ama sessiz" anlamı için ciro_t90 > 0 olan ama son satış
 * 60 günden eski olan müşterileri sıralıyoruz — sessiz olmasına rağmen 90g
 * pencere içinde küçük bir aktivite olabilir (geriye doğru kayan pencere).
 */
function fetchRecoveryTargets(
  allowedDistKods: number[] | null,
  cities: string[] | null,
): RecoveryTarget[] {
  const db = getLocalDb(DEFAULT_REPO_ROOT);
  try {
    const distFilter =
      allowedDistKods == null
        ? ""
        : allowedDistKods.length === 0
          ? "AND 1=0"
          : `AND dist_kod IN (${allowedDistKods.join(",")})`;
    const rows = db
      .prepare(
        `SELECT
           id,
           COALESCE(unvan, '') AS unvan,
           sehir,
           COALESCE(ciro_t90, 0) AS ciro_t90,
           COALESCE(days_since_last_sale, 999) AS sessiz_gun,
           risk_tier_v2
         FROM map_customers
         WHERE COALESCE(days_since_last_sale, 999) > 60
           AND COALESCE(ciro_t90, 0) > 0
           ${distFilter} ${citySqliteFilter(cities)}
         ORDER BY ciro_t90 DESC, sessiz_gun DESC
         LIMIT 20`,
      )
      .all() as Array<{
        id: number;
        unvan: string;
        sehir: string | null;
        ciro_t90: number;
        sessiz_gun: number;
        risk_tier_v2: string | null;
      }>;
    return rows.map((r) => ({
      id: Number(r.id),
      unvan: String(r.unvan ?? ""),
      sehir: r.sehir ? String(r.sehir) : null,
      cirot90: Number(r.ciro_t90 ?? 0),
      sessizGun: Number(r.sessiz_gun ?? 0),
      riskTier: r.risk_tier_v2 ? String(r.risk_tier_v2) : null,
    }));
  } catch {
    return [];
  }
}

// ---------- Public API ------------------------------------------------------

type RawAktivasyonMssqlBundle = {
  active: ActiveCustomers90dRawRow[];
  silent: SilentCustomerRawRow[];
  strategicSilence: StrategicBrandSilenceRawRow[];
  generatedAt: string;
};

/**
 * Cache stratejisi: MSSQL fetcher'lar (A/B/C) full dataset (tüm dist'ler) TEK
 * cache anahtarı (`${CACHE_VERSION}-90g-<stratKey>-all`) altında çekilir —
 * wietnauer-stok.ts'teki `scopedRows` deseniyle aynı. Dist filtresi/scope
 * runtime'da JS'te uygulanır. SQLite fetcher'lar (D/E) zaten lokal + ucuz —
 * `allowedDistKods` ile doğrudan filtrelenmeye devam eder, cache'e girmez.
 */
export async function getWietnauerAktivasyonSnapshot(
  options: {
    forceRefresh?: boolean;
    strategicBrands?: string[];
    allowedDistKods?: number[] | null;
    distId?: number | null;
    /** Kullanıcının izinli şehirleri (null → kısıt yok). SQL'e semi-join
     * predikatı olarak uygulanır; cache key şehir kümesine göre ayrışır. */
    allowedCities?: string[] | null;
  } = {},
): Promise<WietnauerAktivasyonSnapshot> {
  const strategicBrands = options.strategicBrands ?? [];
  const cities = options.allowedCities ?? null;
  const stratKey = strategicBrands
    .map((b) => b.toLocaleLowerCase("tr"))
    .sort()
    .join("|");

  const cacheKey = `${CACHE_VERSION}-90g-${stratKey || "none"}-${cityCacheTag(cities)}`;
  const result = await withCache<RawAktivasyonMssqlBundle>(
    CACHE_DOMAIN,
    cacheKey,
    async () => {
      // MSSQL sorguları paralel.
      const [active, silent, strategicSilence] = await Promise.all([
        fetchActiveCustomers90dRaw(cities),
        fetchSilentCustomersRaw(cities),
        fetchStrategicBrandSilenceRaw(strategicBrands, cities),
      ]);
      return {
        active,
        silent,
        strategicSilence,
        generatedAt: new Date().toISOString(),
      };
    },
    { forceRefresh: options.forceRefresh },
  );

  const { active: rawActive, silent: rawSilent, strategicSilence: rawStrategicSilence, generatedAt } =
    result.value;

  // Yetki kapsamı — dist kullanıcı için önce izinli dist'lere daralt.
  const effectiveDistKods =
    options.distId != null ? [options.distId] : (options.allowedDistKods ?? null);
  const inScope = (distId: number | null): boolean => {
    if (effectiveDistKods == null) return true; // merkez, filtresiz
    if (effectiveDistKods.length === 0) return false; // izinli dist yok
    return distId != null && effectiveDistKods.includes(distId);
  };

  const active = aggregateActiveCustomers90d(rawActive.filter((r) => inScope(r.distId)));
  const silent = aggregateSilentCustomers(rawSilent.filter((r) => inScope(r.distId)));
  const strategicSilence = aggregateStrategicBrandSilence(
    rawStrategicSilence.filter((r) => inScope(r.distId)),
  );

  // SQLite çağrıları senkron (better-sqlite3) — zaten lokal mirror, cache'e
  // girmiyor; allowedDistKods doğrudan filtre olarak uygulanır.
  const riskTiers = fetchRiskTierDistribution(effectiveDistKods, cities);
  const recovery = fetchRecoveryTargets(effectiveDistKods, cities);

  return {
    generatedAt,
    demoDate: process.env.DEMO_DATE?.trim() || null,
    active,
    silent,
    strategicSilence,
    riskTiers,
    recovery,
  };
}
