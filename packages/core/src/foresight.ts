import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReadOnly } from "./db.js";
import { generate } from "./gemini.js";

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
  today: Date = new Date(),
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
  today: Date = new Date(),
): Promise<YoyPurchase[]> {
  const lastYear = addDays(today, -365);
  const start = isoDate(addDays(lastYear, -3));
  const end = isoDate(addDays(lastYear, windowDays));
  const sql = `
    SELECT TOP 10
      g.TXTAD AS urunGrubu,
      SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro,
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
    GROUP BY g.TXTAD
    ORDER BY ciro DESC
  `;
  const out = await runReadOnly(sql, { limit: 50, timeoutMs: 30_000 });
  return out.rows.map((r) => ({
    urunGrubu: (r.urunGrubu as string) ?? null,
    ciro: Number(r.ciro ?? 0),
    miktar: Number(r.miktar ?? 0),
  }));
}

export type DroppedCategory = {
  urunGrubu: string;
  baselineCiro: number;
  baselineMiktar: number;
  recentCiro: number;
  daysSinceLast: number | null;
};

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
        g.TXTAD AS urunGrubu,
        d.DBLNETFIYAT * d.DBLMIKTAR AS satirCiro,
        d.DBLMIKTAR AS satirMiktar,
        f.TRHISLEMTARIHI AS tarih
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u
        ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN dbo.TBLURUNGRUP g
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
  return out.rows.map((r) => ({
    urunGrubu: String(r.urunGrubu ?? ""),
    baselineCiro: Number(r.baselineCiro ?? 0),
    baselineMiktar: Number(r.baselineMiktar ?? 0),
    recentCiro: Number(r.recentCiro ?? 0),
    daysSinceLast: r.daysSinceLast == null ? null : Number(r.daysSinceLast),
  }));
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
        g.TXTAD AS urunGrubu,
        f.LNGMUSTERIKOD AS musteriKod,
        SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro
      FROM dbo.TBLMSDFATURA f
      INNER JOIN cohort c ON c.LNGKOD = f.LNGMUSTERIKOD
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN dbo.TBLURUNGRUP g
        ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
      WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
        AND f.TRHISLEMTARIHI >= DATEADD(day, -${days}, GETDATE())
      GROUP BY g.TXTAD, f.LNGMUSTERIKOD
    ),
    selfBuys AS (
      SELECT DISTINCT g.TXTAD AS urunGrubu
      FROM dbo.TBLMSDFATURA f
      INNER JOIN dbo.TBLMSDBELGEDETAY d
        ON d.LNGYIL = f.LNGYIL
       AND d.LNGFATURAKOD = f.LNGBELGEKOD
       AND d.LNGDISTKOD = f.LNGDISTKOD
      INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
      INNER JOIN dbo.TBLURUNGRUP g
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

export type ForesightSignals = {
  customerId: number;
  generatedAt: string;
  events: UpcomingEvent[];
  yoy: YoyPurchase[];
  dropped: DroppedCategory[];
  cohort: CohortPick[];
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
): Promise<ForesightResult> {
  const [events, yoy, dropped, cohort] = await Promise.all([
    getUpcomingEvents(windowDays).catch(() => [] as UpcomingEvent[]),
    getCustomerYoyWindow(customerId, windowDays).catch(() => [] as YoyPurchase[]),
    getDroppedCategories(customerId).catch(() => [] as DroppedCategory[]),
    getCohortRecent(customerId).catch(() => [] as CohortPick[]),
  ]);

  const generatedAt = new Date().toISOString();
  const signals: ForesightSignals = { customerId, generatedAt, events, yoy, dropped, cohort };

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

  const userPrompt = [
    `Müşteri: ${customerLabel} (id ${customerId}).`,
    `Bugün: ${new Date().toISOString().slice(0, 10)}. Pencere: ${windowDays} gün.`,
    "",
    "ÖNÜMÜZDEKİ TAKVİM:",
    eventLines || "(önümüzdeki 14 günde özel gün yok)",
    "",
    "GEÇEN YIL AYNI HAFTA BU MÜŞTERİ NE ALDIYDI:",
    yoyLines || "(geçen yıl bu hafta için kayıt bulunamadı)",
    "",
    "DÜŞMÜŞ KATEGORİLER (eskiden alıyordu, son 30 günde hiç):",
    droppedLines || "(düşmüş kategori yok)",
    "",
    "SEGMENT KIYASI (aynı şehir + ciro bandındaki müşteriler bu hafta aldı, bu müşteri almadı):",
    cohortLines || "(segment sinyali yok)",
  ].join("\n");

  const system = [
    "Sen Univera distribütör satış operasyonu için çalışan bir saha asistanısın.",
    "Sana bir müşteri için 4 farklı sinyal kanalı verilecek (takvim, geçen yıl, düşmüş kategoriler, segment).",
    "",
    "Görev: bu sinyallerden nedensel bir foresight oluştur ve sahaya çıkacak satış temsilcisine 2-3 SOMUT aksiyon öner.",
    "",
    "ZORUNLU:",
    "- Türkçe yaz, sade iş dilinde.",
    "- Sinyallerdeki tüm adları (kategori, ürün grubu, etkinlik, gün) BİREBİR kullan.",
    "- Sayıları ve tarihleri olduğu gibi aktar.",
    "- Aksiyonları madde madde ver (en fazla 3 madde). Her madde: ne yapılmalı + neden (hangi sinyalden geldi).",
    "- Sinyaller çelişiyorsa veya zayıfsa o şekilde söyle ('zayıf sinyal' / 'sadece segment kıyasından geliyor').",
    "",
    "YASAK:",
    "- 'Önemlidir', 'değerlendirilmiştir', 'genel olarak' gibi içi boş ifadeler.",
    "- Sinyal yokken aksiyon uydurma — boşsa boş bırak.",
    "- SQL/teknik jargon ('tablo', 'sorgu', 'segment SQL').",
    "",
    "Çıktı formatı (KESİN UYULACAK):",
    "BRIEF:",
    "<2-3 cümle, müşteri için nedensel hikâye>",
    "AKSIYONLAR:",
    "- <aksiyon 1>",
    "- <aksiyon 2>",
    "- <aksiyon 3 (opsiyonel)>",
  ].join("\n");

  let llmOut = "";
  try {
    llmOut = await generate(system, userPrompt, { temperature: 0.3, maxOutputTokens: 1024 });
  } catch (err) {
    console.error("[foresight] generate failed:", err);
    llmOut = "";
  }

  const { brief, actions } = parseForesightOutput(llmOut);
  return { ...signals, brief, actions };
}

function parseForesightOutput(raw: string): { brief: string; actions: string[] } {
  if (!raw) return { brief: "", actions: [] };
  const briefMatch = raw.match(/BRIEF:\s*([\s\S]*?)(?:AKSIYONLAR:|$)/i);
  const actionsMatch = raw.match(/AKSIYONLAR:\s*([\s\S]*)$/i);
  const brief = (briefMatch?.[1] ?? "").trim();
  const actionsBlock = (actionsMatch?.[1] ?? "").trim();
  const actions = actionsBlock
    .split("\n")
    .map((l) => l.replace(/^[-*•\s]+/, "").trim())
    .filter((l) => l.length > 2);
  return { brief: brief || raw.trim(), actions };
}
