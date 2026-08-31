/**
 * Demo "bugün" katmanı — gerçek `GETDATE()` veya sabit demo tarih.
 *
 * Proje geneli — tüm SQL sorguları (GETDATE) ve JS tarafı (new Date) bu
 * helper'lar üzerinden çalışır.
 *
 * Test/pilot DB'lerde ETL'in en son aktardığı gün ile gerçek bugün arasında
 * gap olabiliyor (örn. veriler 17 Nis'te kesilmiş, sistem bugünü 12 May).
 * Bu da YoY/30g pencerelerini boşa düşürür ve KPI'ları yanıltır.
 *
 * Çözüm: `DEMO_DATE=YYYY-MM-DD` env değişkeni set edilirse, hem SQL
 * sorgularındaki `GETDATE()` hem de JS tarafındaki `new Date()` bu sabit
 * tarih gibi davranır. Boşsa veya geçersizse normal canlı tarih.
 *
 * Geri uyumluluk: eski `KOMUTA_DEMO_DATE` ismi de okunur (öncelik DEMO_DATE).
 *
 * Kullanım:
 *   SQL: `WHERE f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})`
 *   JS:  const today = currentDate();
 */

/** YYYY-MM-DD regex. */
const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Demo tarih env'den okunur. Geçersizse veya yoksa null döner.
 * Module cache yok — değişiklik anında yansısın.
 *
 * Öncelik: DEMO_DATE > KOMUTA_DEMO_DATE (legacy).
 */
function readDemoDate(): string | null {
  const raw =
    process.env.DEMO_DATE?.trim() ||
    process.env.KOMUTA_DEMO_DATE?.trim() ||
    "";
  if (!raw) return null;
  if (!DATE_RX.test(raw)) {
    console.warn(
      `[now] DEMO_DATE "${raw}" geçersiz format (YYYY-MM-DD beklenir) — yok sayılıyor.`,
    );
    return null;
  }
  // Geçerli takvim tarihi mi?
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    console.warn(`[now] DEMO_DATE "${raw}" geçersiz tarih — yok sayılıyor.`);
    return null;
  }
  return raw;
}

/**
 * SQL içine inline olarak basılır. `GETDATE()` veya
 * `CAST('YYYY-MM-DD' AS DATETIME)` döner.
 *
 * Demo modda günün sonuna sabitlemek için 23:59:59 ekliyoruz; aksi takdirde
 * `>=` filter'ı o günün satırlarını dahil etmez.
 */
/**
 * NOW_MODE=max-invoice anchor'ı. Bozuk DB saatine (GETDATE aylarca geride
 * donuk) karşı "now" = en son fatura tarihi. Bu değer DB'den BİR KEZ çözülüp
 * (resolveNowAnchor, db.ts) buraya yazılır; sqlNow() onu LITERAL basar.
 *
 * Neden literal, subquery değil: sqlNow() çıktısı ~30 sorguya `${sqlNow()}`
 * ile gömülüyor; subquery gömmek (a) agregat içinde "aggregate on subquery"
 * SQL hatası, (b) her sorguda tekrar MAX taraması → timeout yaratıyordu.
 * Literal tarih ikisini de ortadan kaldırır.
 */
let nowAnchor: string | null = null;

/** YYYY-MM-DD anchor'ı set eder (geçersizse null'lar). db.ts/resolveNowAnchor çağırır. */
export function setNowAnchor(d: string | null): void {
  nowAnchor = d && DATE_RX.test(d) ? d : null;
}

/** NOW_MODE=max-invoice aktif mi (env). */
function nowModeMax(): boolean {
  return process.env.NOW_MODE?.trim() === "max-invoice";
}

/** Aktif anchor tarihi (çözülmüşse). Banner/log için. */
export function nowAnchorDate(): string | null {
  return nowModeMax() ? nowAnchor : null;
}

/**
 * "now" GETDATE()'ten sapıyor mu — DEMO_DATE ya da çözülmüş max-invoice anchor.
 * db.ts'teki GETDATE→sqlNow replace guard'ı bunu kullanır.
 */
export function nowIsOverridden(): boolean {
  return readDemoDate() != null || (nowModeMax() && nowAnchor != null);
}

export function sqlNow(): string {
  const demo = readDemoDate();
  if (demo) {
    return `CAST('${demo} 23:59:59' AS DATETIME)`;
  }
  if (nowModeMax() && nowAnchor) {
    return `CAST('${nowAnchor} 23:59:59' AS DATETIME)`;
  }
  return "GETDATE()";
}

/**
 * JS tarafı için. Demo modda env'deki tarihin sonu (23:59:59 lokal),
 * canlıda `new Date()`.
 */
export function currentDate(): Date {
  const demo = readDemoDate();
  if (demo) {
    return new Date(`${demo}T23:59:59`);
  }
  if (nowModeMax() && nowAnchor) {
    return new Date(`${nowAnchor}T23:59:59`);
  }
  return new Date();
}

/**
 * Şu an demo modda mıyız? Logging / UI banner için.
 */
export function isDemoMode(): boolean {
  return readDemoDate() != null;
}

/**
 * Demo tarihini olduğu gibi string döndürür (null'sa null).
 * Banner gibi "veri 17 Nis'te kesildi" göstergesi için.
 */
export function demoDate(): string | null {
  return readDemoDate();
}

/**
 * md2 — Fatura tarih penceresinin alt/üst SQL sınırları (ortak yardımcı).
 *
 * `dateFrom`&`dateTo` geçerli (YYYY-MM-DD, from<=to) ise seçili KAPALI pencere
 * `[from, to]` (üst hariç, +1 gün); değilse anchor-bağıl (donuk-saat) son
 * `fallbackDays` gün. `key` cache anahtarına eklenir (pencereye göre ayrışsın).
 *
 * Kullanım: `const win = resolveWindowBounds(dateFrom, dateTo);` sonra SQL'de
 * `f.TRHISLEMTARIHI >= ${win.lower} AND f.TRHISLEMTARIHI < ${win.upper}`.
 */
export function resolveWindowBounds(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  fallbackDays = 30,
): { lower: string; upper: string; key: string } {
  const RX = /^\d{4}-\d{2}-\d{2}$/;
  if (dateFrom && dateTo && RX.test(dateFrom) && RX.test(dateTo) && dateFrom <= dateTo) {
    return {
      lower: `CAST('${dateFrom}' AS DATE)`,
      upper: `DATEADD(day, 1, CAST('${dateTo}' AS DATE))`,
      key: `${dateFrom}_${dateTo}`,
    };
  }
  return {
    lower: `DATEADD(day, -${fallbackDays}, ${sqlNow()})`,
    upper: `DATEADD(day, 1, ${sqlNow()})`,
    key: `${fallbackDays}g`,
  };
}
