import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withCache } from "./cache.js";
import { runReadOnly } from "./db.js";
import { generate } from "./gemini.js";
import { currentDate } from "./now.js";

// Resolve repo root from this file's own location — same trick we use in
// snapshot.ts so calendar lookup doesn't depend on cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

export type CalendarEvent = {
  date: string;
  name: string;
  kind: "dini" | "milli" | "ozel" | "okul" | "maas";
  duration_days?: number;
  category_hints?: string[];
};

export type RecurringEvent = {
  name: string;
  kind: "maas";
  day_of_month: number;
  category_hints?: string[];
};

export type Calendar = {
  year: number;
  country: string;
  events: CalendarEvent[];
  recurring: RecurringEvent[];
};

let calendarCache: Calendar | null = null;

async function loadCalendar(year: number): Promise<Calendar> {
  if (calendarCache && calendarCache.year === year) return calendarCache;
  const p = path.join(REPO_ROOT, "data/calendar", `tr-${year}.json`);
  const raw = await readFile(p, "utf-8");
  calendarCache = JSON.parse(raw) as Calendar;
  return calendarCache;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export type UpcomingEvent = {
  date: string;
  name: string;
  kind: string;
  daysAhead: number;
  category_hints?: string[];
};

/**
 * Returns calendar events falling within [today, today+windowDays]. Includes
 * both fixed-date events and recurring ones (maaş günleri) materialized into
 * the window.
 */
export async function getUpcomingEvents(
  windowDays = 14,
  today: Date = currentDate(),
): Promise<UpcomingEvent[]> {
  const cal = await loadCalendar(today.getFullYear());
  const start = isoDate(today);
  const end = isoDate(addDays(today, windowDays));

  const fixed: UpcomingEvent[] = cal.events
    .filter((e) => e.date >= start && e.date <= end)
    .map((e) => ({
      date: e.date,
      name: e.name,
      kind: e.kind,
      daysAhead: Math.round(
        (new Date(e.date).getTime() - today.getTime()) / 86_400_000,
      ),
      category_hints: e.category_hints,
    }));

  const recurring: UpcomingEvent[] = [];
  for (let i = 0; i <= windowDays; i++) {
    const d = addDays(today, i);
    const dom = d.getDate();
    for (const r of cal.recurring) {
      if (r.day_of_month === dom) {
        recurring.push({
          date: isoDate(d),
          name: r.name,
          kind: r.kind,
          daysAhead: i,
          category_hints: r.category_hints,
        });
      }
    }
  }

  return [...fixed, ...recurring].sort((a, b) => a.date.localeCompare(b.date));
}

export type YoyPurchase = {
  urunGrubu: string | null;
  ciro: number;
  miktar: number;
};

/**
 * Same calendar window one year ago: what product groups did this customer
 * buy? Used to spot seasonal patterns ("geçen yıl bu hafta hurma almıştı").
 */
export async function getCustomerYoyWindow(
  customerId: number,
  windowDays = 14,
  today: Date = currentDate(),
): Promise<YoyPurchase[]> {
  const lastYear = addDays(today, -365);
  const start = isoDate(addDays(lastYear, -3));
  const end = isoDate(addDays(lastYear, windowDays));
  // Group at product-group level when TBLURUNGRUP join exists, otherwise fall
  // back to product name. COALESCE means orphan products (no group match)
  // still surface with a usable name instead of collapsing into a NULL bucket.
  const sql = `
    SELECT TOP 10
      COALESCE(g.TXTAD, u.TXTAD) AS urunGrubu,
      SUM(d.DBLNETFIYAT) AS ciro,
      SUM(d.DBLMIKTAR) AS miktar
    FROM dbo.TBLMSDFATURA f
    INNER JOIN dbo.TBLMSDBELGEDETAY d
      ON d.LNGYIL = f.LNGYIL
     AND d.LNGFATURAKOD = f.LNGBELGEKOD
     AND d.LNGDISTKOD = f.LNGDISTKOD
    INNER JOIN dbo.TBLURUN u
      ON u.LNGKOD = d.LNGURUNKOD
    LEFT JOIN dbo.TBLURUNGRUP g
      ON g.TXTKOD = u.TXTURUNGRUPKOD
     AND g.LNGDISTKOD = u.LNGDISTKOD
    WHERE f.LNGMUSTERIKOD = ${Math.floor(customerId)}
      AND f.BYTTUR = 0 AND f.BYTDURUM = 0
      AND f.TRHISLEMTARIHI >= '${start}'
      AND f.TRHISLEMTARIHI <= '${end}'
    GROUP BY COALESCE(g.TXTAD, u.TXTAD)
    ORDER BY ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 50, timeoutMs: 30_000 });
  return out.rows.map((r) => ({
    urunGrubu: (r.urunGrubu as string) ?? null,
    ciro: Number(r.ciro ?? 0),
    miktar: Number(r.miktar ?? 0),
  }));
}

export type DroppedCategoryUrgency = "high" | "medium" | "low";

export type DroppedCategory = {
  urunGrubu: string;
  baselineCiro: number;
  baselineMiktar: number;
  recentCiro: number;
  daysSinceLast: number | null;
  urgency: DroppedCategoryUrgency;
};

/**
 * Urgency scoring for a dropped category. The signal that matters is
 * `baselineCiro × daysSinceLast` — a customer who used to buy 1M ₺ in this
 * category and hasn't ordered for 40+ days is a relationship risk, not a
 * routine re-engagement note. The thresholds are intentionally simple — a
 * field rep can override but the system should never bury a HIGH item.
 */
function computeDroppedUrgency(
  baselineCiro: number,
  daysSinceLast: number | null,
): DroppedCategoryUrgency {
  const days = daysSinceLast ?? 0;
  if (baselineCiro >= 100_000 && days >= 30) return "high";
  if (baselineCiro >= 250_000) return "high"; // huge historical relationship, even short pauses matter
  if (baselineCiro >= 20_000 && days >= 30) return "medium";
  if (baselineCiro >= 50_000) return "medium";
  return "low";
}

/**
 * Categories the customer used to buy regularly (in 31-120 day baseline) but
 * has dropped in the last `recentDays`. Re-engagement signal.
 *
 * Requires ≥2 baseline purchases to filter out noise from one-off buys.
 */
export async function getDroppedCategories(
  customerId: number,
  recentDays = 30,
  baselineDays = 90,
): Promise<DroppedCategory[]> {
  const sql = `
    WITH detay AS (
      SELECT
        COALESCE(g.TXTAD, u.TXTAD) AS urunGrubu,
        d.DBLNETFIYAT AS satirCiro,
        d.DBLMIKTAR AS satirMiktar,
        f.TRHISLEMTARIHI AS tarih
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u
        ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD
       AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.LNGMUSTERIKOD = ${Math.floor(customerId)}
        AND f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -${baselineDays + recentDays}, GETDATE())
    )
    SELECT
      urunGrubu,
      SUM(CASE WHEN tarih <  DATEADD(day, -${recentDays}, GETDATE()) THEN satirCiro ELSE 0 END) AS baselineCiro,
      SUM(CASE WHEN tarih <  DATEADD(day, -${recentDays}, GETDATE()) THEN satirMiktar ELSE 0 END) AS baselineMiktar,
      SUM(CASE WHEN tarih >= DATEADD(day, -${recentDays}, GETDATE()) THEN satirCiro ELSE 0 END) AS recentCiro,
      COUNT(DISTINCT CASE WHEN tarih < DATEADD(day, -${recentDays}, GETDATE()) THEN CAST(tarih AS date) END) AS baselineDays,
      DATEDIFF(day, MAX(tarih), GETDATE()) AS daysSinceLast
    FROM detay
    GROUP BY urunGrubu
    HAVING SUM(CASE WHEN tarih >= DATEADD(day, -${recentDays}, GETDATE()) THEN satirCiro ELSE 0 END) = 0
       AND COUNT(DISTINCT CASE WHEN tarih < DATEADD(day, -${recentDays}, GETDATE()) THEN CAST(tarih AS date) END) >= 2
    ORDER BY baselineCiro DESC
  `;
  const out = await runReadOnly(sql, { limit: 20, timeoutMs: 30_000 });
  return out.rows
    .map((r) => {
      const baselineCiro = Number(r.baselineCiro ?? 0);
      const daysSinceLast = r.daysSinceLast == null ? null : Number(r.daysSinceLast);
      return {
        urunGrubu: String(r.urunGrubu ?? ""),
        baselineCiro,
        baselineMiktar: Number(r.baselineMiktar ?? 0),
        recentCiro: Number(r.recentCiro ?? 0),
        daysSinceLast,
        urgency: computeDroppedUrgency(baselineCiro, daysSinceLast),
      };
    })
    // High first, then medium, then low — and within each tier highest baseline first
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 } as const;
      if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
      return b.baselineCiro - a.baselineCiro;
    });
}

export type CohortPick = {
  urunGrubu: string;
  cohortBuyerCount: number;
  cohortTotalBuyers: number;
  cohortCiro: number;
};

/**
 * Customer's segment is (city, sales tier). Tier = sessiz / düşük / orta / yüksek
 * by 30-day ciro buckets. Returns product groups that ≥30% of the cohort bought
 * in the last `days` but this customer did NOT.
 *
 * Hand-crafted segmentation — no embeddings, no learned similarity. Good
 * enough for v1 cross-sell signal; learned similarity is a Stage-1 ML problem.
 */
export async function getCohortRecent(
  customerId: number,
  days = 7,
): Promise<CohortPick[]> {
  // Resolve segment from customer master + 30-day ciro
  const segSql = `
    SELECT
      LTRIM(RTRIM(m.TXTSEHIR)) AS sehir,
      ISNULL((
        SELECT SUM(f.DBLNETTUTAR)
        FROM dbo.TBLMSDFATURA f
        WHERE f.LNGMUSTERIKOD = m.LNGKOD
          AND f.BYTTUR = 0 AND f.BYTDURUM = 0
          AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
      ), 0) AS ciro30
    FROM dbo.TBLMUSTERI m
    WHERE m.LNGKOD = ${Math.floor(customerId)}
  `;
  const segOut = await runReadOnly(segSql, { limit: 1, timeoutMs: 20_000 });
  const seg = segOut.rows[0] as { sehir?: string; ciro30?: number } | undefined;
  if (!seg?.sehir) return [];

  const ciro = Number(seg.ciro30 ?? 0);
  const tierMin =
    ciro >= 25_000 ? 15_000 :
    ciro >= 5_000 ? 2_500 :
    ciro >= 500 ? 100 : 0;
  const tierMax =
    ciro >= 25_000 ? 9_999_999 :
    ciro >= 5_000 ? 50_000 :
    ciro >= 500 ? 10_000 : 5_000;

  // Cohort: customers in same city + same ciro band, excluding self.
  // For each group bought by cohort in last `days`, count distinct buyers and
  // require ≥30% penetration. Then exclude groups this customer bought in same window.
  const sql = `
    WITH cohort AS (
      SELECT m.LNGKOD
      FROM dbo.TBLMUSTERI m
      WHERE LTRIM(RTRIM(m.TXTSEHIR)) = '${(seg.sehir ?? "").replace(/'/g, "''")}'
        AND m.LNGKOD <> ${Math.floor(customerId)}
        AND ISNULL((
          SELECT SUM(f.DBLNETTUTAR)
          FROM dbo.TBLMSDFATURA f
          WHERE f.LNGMUSTERIKOD = m.LNGKOD
            AND f.BYTTUR = 0 AND f.BYTDURUM = 0
            AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
        ), 0) BETWEEN ${tierMin} AND ${tierMax}
    ),
    cohortBuys AS (
      SELECT
        COALESCE(g.TXTAD, u.TXTAD) AS urunGrubu,
        f.LNGMUSTERIKOD AS musteriKod,
        SUM(d.DBLNETFIYAT) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN cohort c ON c.LNGKOD = f.LNGMUSTERIKOD
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -${days}, GETDATE())
      GROUP BY COALESCE(g.TXTAD, u.TXTAD), f.LNGMUSTERIKOD
    ),
    selfBuys AS (
      SELECT DISTINCT COALESCE(g.TXTAD, u.TXTAD) AS urunGrubu
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      LEFT JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.LNGMUSTERIKOD = ${Math.floor(customerId)}
        AND f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -${days}, GETDATE())
    ),
    cohortSize AS (
      SELECT COUNT(*) AS n FROM cohort
    )
    SELECT TOP 10
      cb.urunGrubu,
      COUNT(DISTINCT cb.musteriKod) AS cohortBuyerCount,
      (SELECT n FROM cohortSize) AS cohortTotalBuyers,
      SUM(cb.ciro) AS cohortCiro
    FROM cohortBuys cb
    LEFT JOIN selfBuys s ON s.urunGrubu = cb.urunGrubu
    WHERE s.urunGrubu IS NULL
    GROUP BY cb.urunGrubu
    HAVING COUNT(DISTINCT cb.musteriKod) * 100 / NULLIF((SELECT n FROM cohortSize), 0) >= 30
    ORDER BY cohortBuyerCount DESC, cohortCiro DESC
  `;
  const out = await runReadOnly(sql, { limit: 20, timeoutMs: 40_000 });
  return out.rows.map((r) => ({
    urunGrubu: String(r.urunGrubu ?? ""),
    cohortBuyerCount: Number(r.cohortBuyerCount ?? 0),
    cohortTotalBuyers: Number(r.cohortTotalBuyers ?? 0),
    cohortCiro: Number(r.cohortCiro ?? 0),
  }));
}

export type RiskFlag = {
  kind: "dropped-high-value";
  urunGrubu: string;
  baselineCiro: number;
  daysSinceLast: number | null;
  message: string;
};

export type ForesightSignals = {
  customerId: number;
  generatedAt: string;
  events: UpcomingEvent[];
  yoy: YoyPurchase[];
  dropped: DroppedCategory[];
  cohort: CohortPick[];
  riskFlags: RiskFlag[];
};

export type ForesightResult = ForesightSignals & {
  brief: string;
  actions: string[];
};

function formatTl(n: number): string {
  return Math.round(n).toLocaleString("tr-TR") + " ₺";
}

/**
 * Orchestrator — calls all four tools in parallel, then asks Gemini to stitch
 * a foresight narrative (causal explanation + 2-3 concrete actions). Single
 * LLM call, NO agent loop. The signals themselves are the source of truth;
 * the LLM is only there to phrase them in business Turkish.
 */
export async function runForesight(
  customerId: number,
  customerLabel: string,
  windowDays = 14,
  options: { forceRefresh?: boolean } = {},
): Promise<ForesightResult> {
  const cacheKey = `${Math.floor(customerId)}:${Math.floor(windowDays)}`;
  const cached = await withCache<ForesightResult>(
    "foresight",
    cacheKey,
    () => computeForesight(customerId, customerLabel, windowDays),
    { forceRefresh: options.forceRefresh },
  );
  return cached.value;
}

async function computeForesight(
  customerId: number,
  customerLabel: string,
  windowDays: number,
): Promise<ForesightResult> {
  const [events, yoy, dropped, cohort] = await Promise.all([
    getUpcomingEvents(windowDays).catch(() => [] as UpcomingEvent[]),
    getCustomerYoyWindow(customerId, windowDays).catch(() => [] as YoyPurchase[]),
    getDroppedCategories(customerId).catch(() => [] as DroppedCategory[]),
    getCohortRecent(customerId).catch(() => [] as CohortPick[]),
  ]);

  const generatedAt = new Date().toISOString();
  const riskFlags: RiskFlag[] = dropped
    .filter((d) => d.urgency === "high")
    .map((d) => ({
      kind: "dropped-high-value" as const,
      urunGrubu: d.urunGrubu,
      baselineCiro: d.baselineCiro,
      daysSinceLast: d.daysSinceLast,
      message: `${d.urunGrubu} kategorisinden eskiden ${formatTl(d.baselineCiro)} alıyordu, ${d.daysSinceLast ?? "?"} gündür hiç sipariş yok — müşteri başka kanala kaymış olabilir`,
    }));
  const signals: ForesightSignals = {
    customerId,
    generatedAt,
    events,
    yoy,
    dropped,
    cohort,
    riskFlags,
  };

  // If we have literally nothing to say, return empty brief instead of hallucinating.
  if (events.length === 0 && yoy.length === 0 && dropped.length === 0 && cohort.length === 0) {
    return {
      ...signals,
      brief:
        "Önümüzdeki 14 günde anlamlı bir foresight sinyali tespit edilmedi. Müşterinin geçmiş satış verisi, segment kıyası ve takvim yeterli sinyal vermedi.",
      actions: [],
    };
  }

  const eventLines = events
    .map(
      (e) =>
        `- ${e.date} (T+${e.daysAhead}g): ${e.name} [${e.kind}]${
          e.category_hints?.length ? ` — sıçrayan kategoriler: ${e.category_hints.join(", ")}` : ""
        }`,
    )
    .join("\n");
  const yoyLines = yoy
    .slice(0, 5)
    .map(
      (y) =>
        `- ${y.urunGrubu ?? "(grup yok)"} — geçen yıl bu hafta ${formatTl(y.ciro)} / ${y.miktar} adet`,
    )
    .join("\n");
  const droppedLines = dropped
    .slice(0, 5)
    .map(
      (d) =>
        `- ${d.urunGrubu} — eskiden ${formatTl(d.baselineCiro)} alıyordu, son ${
          d.daysSinceLast ?? "?"
        } gündür hiç almadı`,
    )
    .join("\n");
  const cohortLines = cohort
    .slice(0, 5)
    .map(
      (c) =>
        `- ${c.urunGrubu} — aynı segmentteki ${c.cohortTotalBuyers} müşteriden ${c.cohortBuyerCount}'i bu hafta aldı, bu müşteri almadı`,
    )
    .join("\n");

  const riskLines = riskFlags.map((r) => `- ${r.message}`).join("\n");

  const userPrompt = [
    `Müşteri: ${customerLabel} (id ${customerId}).`,
    `Bugün: ${currentDate().toISOString().slice(0, 10)}. Pencere: ${windowDays} gün.`,
    "",
    riskFlags.length > 0
      ? "⚠️ YÜKSEK ÖNCELİKLİ RİSK SİNYALLERİ (BRIEF'in İLK CÜMLESİ BUNU AÇIKLAYACAK):"
      : "(yüksek öncelikli risk yok)",
    riskFlags.length > 0 ? riskLines : "",
    "",
    "ÖNÜMÜZDEKİ TAKVİM:",
    eventLines || "(önümüzdeki 14 günde özel gün yok)",
    "",
    "GEÇEN YIL AYNI HAFTA BU MÜŞTERİ NE ALDIYDI:",
    yoyLines || "(geçen yıl bu hafta için kayıt bulunamadı)",
    "",
    "DÜŞMÜŞ KATEGORİLER (eskiden alıyordu, son 30 günde hiç) — high/medium/low etiketli:",
    droppedLines || "(düşmüş kategori yok)",
    "",
    "SEGMENT KIYASI (aynı şehir + ciro bandındaki müşteriler bu hafta aldı, bu müşteri almadı):",
    cohortLines || "(segment sinyali yok)",
  ].join("\n");

  const system = [
    "Sen Univera distribütör satış operasyonu için çalışan bir saha asistanısın.",
    "Sana bir müşteri için 4 sinyal kanalı verildi (takvim, geçen yıl, düşmüş kategoriler, segment).",
    "Sahaya çıkacak satış temsilcisi okuyacak; senin işin OPS dilinde aksiyon yazmak, jenerik öneri DEĞİL.",
    "",
    "BRIEF (2-3 cümle):",
    "- Bu hafta için bir NEDEN-SONUÇ hikâyesi kur.",
    "- Sinyaldeki ÜRÜN GRUBU adlarını birebir geçir (örn. 'BİSKÜVİ', 'YAĞ', 'ŞARKÜTERİ').",
    "  KENDİN KATEGORİ İCAT ETME ('Temel Gıda', 'Atıştırmalıklar' yasak).",
    "- Toplam ciro varsa onu da yaz ama en az 1 ürün grubu adı + tutarı zikret.",
    "",
    "AKSİYONLAR (en az 2, en fazla 3):",
    "- HER aksiyon spesifik bir SİNYALE bağlı olacak ve sinyaldeki adı/sayıyı içerecek.",
    "- AKTİF FİİL kullan: 'yükle', 'ziyaret et', 'hatırlat', 'sun', 'göster', 'teklif et'.",
    "  YASAK pasif fiiller: 'yapılması', 'edilmesi', 'geliştirilmesi', 'sağlanması', 'değerlendirilmesi'.",
    "- HER aksiyonun sonuna parantez içinde kaynak: '(geçen yıl bu hafta X aldı)', '(15 May maaş günü)', '(düşmüş kategori: Y)', '(segmentin %N'i aldı)'.",
    "- YASAK genel ifadeler: 'stok kontrolü yap', 'görünürlüğü artır', 'kampanya geliştir', 'strateji oluştur', 'potansiyeli değerlendir'.",
    "- En az bir aksiyonda bir SAYI olsun (kg, adet, ₺, kasa, gün).",
    "",
    "ÖRNEK iyi aksiyon:",
    "- Cuma maaş günü öncesi BİSKÜVİ kategorisinde 4 koli stok yükle — geçen yıl aynı hafta 5.200 ₺ ciro buradan gelmişti (geçen yıl bu hafta BİSKÜVİ)",
    "ÖRNEK kötü aksiyon (YAZMA):",
    "- Maaş günü öncesinde Temel Gıda ve Atıştırmalıklarda stok kontrolü yapılması (Nedeni: harcama potansiyelinin artmasıdır)",
    "",
    "Hiç güçlü sinyal yoksa AKSİYONLAR bölümünü tamamen boş bırak — uydurma.",
    "",
    "Çıktı formatı (KESİN UYULACAK):",
    "BRIEF:",
    "<2-3 cümle>",
    "AKSİYONLAR:",
    "- <aksiyon 1>",
    "- <aksiyon 2>",
  ].join("\n");

  let llmOut = "";
  try {
    llmOut = await generate(system, userPrompt, { temperature: 0.3, maxOutputTokens: 1024 });
  } catch (err) {
    console.error("[foresight] generate failed:", err);
    llmOut = "";
  }

  const { brief: llmBrief, actions: rawActions } = parseForesightOutput(llmOut);

  // Quality filter: drop actions that are (a) passive-voice ops fluff or
  // (b) reference categories not present in any signal. The signals are the
  // truth set — if an action names a kategori the data doesn't support, it's
  // hallucinated and should not reach the rep.
  const signalNames = new Set<string>();
  for (const e of events) {
    signalNames.add(e.name.toLocaleLowerCase("tr"));
    for (const h of e.category_hints ?? []) signalNames.add(h.toLocaleLowerCase("tr"));
  }
  for (const y of yoy) if (y.urunGrubu) signalNames.add(y.urunGrubu.toLocaleLowerCase("tr"));
  for (const d of dropped) signalNames.add(d.urunGrubu.toLocaleLowerCase("tr"));
  for (const c of cohort) signalNames.add(c.urunGrubu.toLocaleLowerCase("tr"));

  const fluffRx =
    /\b(yapılması|edilmesi|geliştirilmesi|sağlanması|değerlendirilmesi|değerlend|göz önünde|potansiyeli|önemlidir|önemli ?\.?$|kontrol[üu] yap|görünürlüğü artır|kampanya geliştir|strateji|odaklan)/i;

  const llmActions = rawActions.filter((a) => {
    if (fluffRx.test(a)) return false;
    const lower = a.toLocaleLowerCase("tr");
    const refsSignal = [...signalNames].some((n) => n.length > 2 && lower.includes(n));
    return refsSignal;
  });

  // Deterministic floor: brief + actions built mechanically from signals.
  // Used either standalone (LLM down/failed) or as a fallback when the LLM
  // output is fluff that doesn't survive the quality gate.
  const detBrief = buildDeterministicBrief(customerLabel, signals);
  const detActions = buildDeterministicActions(signals);

  // Accept LLM brief only if (a) it has at least one signal name AND (b) no
  // banned fluff phrase. Otherwise prefer deterministic.
  const llmBriefLower = llmBrief.toLocaleLowerCase("tr");
  const briefRefsSignal = [...signalNames].some(
    (n) => n.length > 2 && llmBriefLower.includes(n),
  );
  const briefIsClean = !fluffRx.test(llmBrief);
  const brief = llmBrief && briefRefsSignal && briefIsClean ? llmBrief : detBrief;

  // Actions: prefer LLM if it survived the filter with ≥2 entries, else fall
  // back to deterministic. Never return empty if signals exist.
  const actions = llmActions.length >= 2 ? llmActions : detActions;

  return { ...signals, brief, actions };
}

function buildDeterministicBrief(
  customerLabel: string,
  s: ForesightSignals,
): string {
  const parts: string[] = [];

  // Lead with risk if any HIGH urgency dropped category exists. A relationship
  // worth six figures going dark is the headline, not the upcoming bayram.
  const risk = s.riskFlags[0];
  if (risk) {
    parts.push(
      `${customerLabel}: ${risk.urunGrubu} kategorisinden eskiden ${formatTl(risk.baselineCiro)} alıyordu, ${risk.daysSinceLast ?? "?"} gündür hiç sipariş yok — yüksek öncelikli risk.`,
    );
  }

  const topEvents = s.events.slice(0, 2);
  if (topEvents.length > 0) {
    const evt = topEvents
      .map((e) => `${e.date} ${e.name}`)
      .join(" + ");
    const prefix = risk ? "Bu arada önümüzdeki 14 günde" : `${customerLabel} için önümüzdeki 14 günde`;
    parts.push(`${prefix}: ${evt}.`);
  }

  if (s.yoy.length > 0) {
    const total = s.yoy.reduce((a, b) => a + b.ciro, 0);
    const top = s.yoy.filter((y) => y.urunGrubu).slice(0, 2);
    if (top.length > 0) {
      const topStr = top.map((y) => `${y.urunGrubu} (${formatTl(y.ciro)})`).join(", ");
      parts.push(
        `Geçen yıl aynı hafta toplam ${formatTl(total)} ciro, en yüksek kalemler: ${topStr}.`,
      );
    } else {
      parts.push(`Geçen yıl aynı hafta toplam ${formatTl(total)} ciro yapılmıştı.`);
    }
  }

  const d = s.dropped[0];
  if (d) {
    parts.push(
      `${d.urunGrubu} kategorisi ${d.daysSinceLast ?? "?"} gündür hiç sipariş edilmiyor (eskiden ${formatTl(d.baselineCiro)} alıyordu).`,
    );
  }

  const c = s.cohort[0];
  if (c) {
    parts.push(
      `Aynı segmentten ${c.cohortBuyerCount}/${c.cohortTotalBuyers} müşteri bu hafta ${c.urunGrubu} aldı, bu müşteri almadı.`,
    );
  }

  if (parts.length === 0) {
    return "Önümüzdeki 14 günde anlamlı bir foresight sinyali yok.";
  }
  return parts.join(" ");
}

function buildDeterministicActions(s: ForesightSignals): string[] {
  const out: string[] = [];

  // 1) HIGH-urgency risk first — relationship at risk trumps event-based picks
  const risk = s.riskFlags[0];
  if (risk) {
    out.push(
      `Bu hafta ziyaret listesine al ve ${risk.urunGrubu} için neden sipariş gelmediğini sor — ${risk.daysSinceLast ?? "?"} gündür hiç almıyor, eskiden ${formatTl(risk.baselineCiro)} alıyordu (yüksek öncelikli risk)`,
    );
  }

  // 2) Strongest YoY pick around the next calendar event
  const nextEvent = s.events[0];
  const topYoy = s.yoy.find((y) => y.urunGrubu);
  if (nextEvent && topYoy) {
    out.push(
      `${nextEvent.date} ${nextEvent.name} öncesi ${topYoy.urunGrubu} kategorisini hatırlat — geçen yıl aynı hafta ${formatTl(topYoy.ciro)} ciro buradan gelmişti`,
    );
  } else if (topYoy) {
    out.push(
      `${topYoy.urunGrubu} kategorisinde bu hafta stok teklif et — geçen yıl aynı hafta ${formatTl(topYoy.ciro)} ciro buradan gelmişti`,
    );
  } else if (nextEvent) {
    const cats = nextEvent.category_hints?.slice(0, 2).join(", ");
    if (cats) {
      out.push(
        `${nextEvent.date} ${nextEvent.name} öncesi ${cats} kategorilerinde stok hatırlat (takvim sinyali)`,
      );
    }
  }

  // 3) If no HIGH risk already covered, include lower-urgency dropped item
  if (!risk) {
    const dropped = s.dropped[0];
    if (dropped) {
      out.push(
        `${dropped.urunGrubu} için yeniden teklif sun — ${dropped.daysSinceLast ?? "?"} gündür hiç almadı, eskiden ${formatTl(dropped.baselineCiro)} alıyordu (düşmüş kategori)`,
      );
    }
  }

  // 4) Cross-sell via cohort
  const cohort = s.cohort[0];
  if (cohort) {
    out.push(
      `${cohort.urunGrubu} öner — aynı segmentteki ${cohort.cohortBuyerCount}/${cohort.cohortTotalBuyers} müşteri bu hafta aldı, bu hesap almadı (segment kıyası)`,
    );
  }

  return out.slice(0, 3);
}

function parseForesightOutput(raw: string): { brief: string; actions: string[] } {
  if (!raw) return { brief: "", actions: [] };
  // Match either AKSIYONLAR or AKSİYONLAR (model writes both ways depending on
  // whether dotted-I makes it through the tokenizer cleanly).
  const aksRx = /(AKS[İI]YONLAR):/i;
  const briefMatch = raw.match(new RegExp(`BRIEF:\\s*([\\s\\S]*?)(?:${aksRx.source}|$)`, "i"));
  const actionsMatch = raw.match(/AKS[İI]YONLAR:\s*([\s\S]*)$/i);
  const brief = (briefMatch?.[1] ?? "").trim();
  const actionsBlock = (actionsMatch?.[1] ?? "").trim();
  const actions = actionsBlock
    .split("\n")
    // Strip only well-formed list prefixes: "1. ", "1) ", "- ", "* ", "• ".
    // The greedy "[-*•\s\d.)]+" variant also ate genuine leading digits in the
    // action text (e.g. "48 gündür..." became "gündür..."). Match the prefix
    // shape explicitly instead.
    .map((l) => l.replace(/^\s*(?:\d+[.)]\s+|[-*•]\s+)/, "").trim())
    .filter((l) => l.length > 2);
  return { brief: brief || raw.trim(), actions };
}
