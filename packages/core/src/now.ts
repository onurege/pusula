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
export function sqlNow(): string {
  const demo = readDemoDate();
  if (demo) {
    return `CAST('${demo} 23:59:59' AS DATETIME)`;
  }
  // Bozuk DB saati modu: bazı pilot/replika DB'lerde host'un GETDATE()'i
  // aylarca geride donabiliyor (ör. GETDATE=17 Nis) ama ETL güncel tarihli
  // fatura eklemeye devam ediyor. Böyle DB'lerde "now" olarak en son fatura
  // tarihini (gün sonu) baz alırız — pencere her gün kendiliğinden ilerler,
  // DEMO_DATE'i elle güncellemeye gerek kalmaz.
  //   NOW_MODE=max-invoice  → aç
  // Uncorrelated scalar subquery; DATEADD/karşılaştırma bağlamında geçerli.
  if (process.env.NOW_MODE?.trim() === "max-invoice") {
    return (
      "(SELECT DATEADD(second, -1, DATEADD(day, 1, " +
      "CAST(CAST(MAX(TRHISLEMTARIHI) AS DATE) AS DATETIME))) " +
      "FROM dbo.TBLMSDFATURA WHERE BYTTUR = 0 AND BYTDURUM = 0)"
    );
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
