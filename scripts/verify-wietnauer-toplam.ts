/**
 * Wietnauer Yönetim Kurulu KPI doğrulaması — "₺325.0M son 30g net ciro"
 * gerçekten doğru mu? Çapraz sorgularla:
 *   1. DEMO_DATE etkisi
 *   2. Tarih aralığı görünür
 *   3. BYTTUR/BYTDURUM filtreleri ne kadar etkili
 *   4. Günlük dağılım (gap/spike var mı)
 *   5. Aylık karşılaştırma
 */
import "dotenv/config";
import { runReadOnly } from "../packages/core/src/db";
import { sqlNow, demoDate } from "../packages/core/src/now";

async function row(title: string, sql: string) {
  console.log(`\n--- ${title} ---`);
  try {
    const r = await runReadOnly(sql);
    if (!r.rows.length) return console.log("  (boş)");
    for (const row of r.rows.slice(0, 30)) {
      const parts = Object.entries(row).map(([k, v]) => {
        if (v === null) return `${k}=·`;
        if (typeof v === "number")
          return `${k}=${v >= 1000 ? v.toLocaleString("tr-TR") : v}`;
        if (v instanceof Date) return `${k}=${v.toISOString().slice(0, 10)}`;
        return `${k}=${String(v).slice(0, 30)}`;
      });
      console.log("  " + parts.join("  ·  "));
    }
  } catch (e) {
    console.log("  ERROR:", (e as Error).message);
  }
}

async function main() {
  console.log("=== Zaman referansı ===");
  console.log(`  DEMO_DATE env  : ${demoDate() ?? "(yok)"}`);
  console.log(`  sqlNow() çıktısı: ${sqlNow()}`);
  console.log(`  Gerçek tarih   : ${new Date().toISOString().slice(0, 10)}`);

  await row(
    "Pencere uçları — son 30g range",
    `SELECT
       DATEADD(day, -30, ${sqlNow()}) AS baslangic,
       ${sqlNow()} AS bitis,
       DATEDIFF(day, DATEADD(day, -30, ${sqlNow()}), ${sqlNow()}) AS gun_sayisi`,
  );

  await row(
    "Toplam (filtre yok)",
    `SELECT
       COUNT(*) AS toplam_fatura,
       ISNULL(SUM(DBLNETTUTAR), 0) AS toplam_net,
       ISNULL(SUM(DBLBRUTTUTAR), 0) AS toplam_brut
     FROM dbo.TBLMSDFATURA
     WHERE TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
       AND TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})`,
  );

  await row(
    "BYTTUR kırılımı — son 30g (0=satış, 1=alış, 99=satış iade, vb.)",
    `SELECT BYTTUR, COUNT(*) AS adet, ISNULL(SUM(DBLNETTUTAR), 0) AS net
     FROM dbo.TBLMSDFATURA
     WHERE TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
     GROUP BY BYTTUR ORDER BY BYTTUR`,
  );

  await row(
    "BYTDURUM kırılımı — son 30g (0=aktif, diğer=iptal)",
    `SELECT BYTDURUM, COUNT(*) AS adet, ISNULL(SUM(DBLNETTUTAR), 0) AS net
     FROM dbo.TBLMSDFATURA
     WHERE TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
     GROUP BY BYTDURUM ORDER BY BYTDURUM`,
  );

  await row(
    "API KPI'ı ile birebir aynı sorgu — ₺325M kontrolü",
    `SELECT
       ISNULL(SUM(DBLBRUTTUTAR), 0) AS brut,
       ISNULL(SUM(DBLISKONTOTUTARI), 0) AS iskonto,
       ISNULL(SUM(DBLNETTUTAR), 0) AS net,
       COUNT(*) AS fatura_count,
       COUNT(DISTINCT LNGMUSTERIKOD) AS aktif_musteri
     FROM dbo.TBLMSDFATURA
     WHERE BYTTUR = 0 AND BYTDURUM = 0
       AND TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
       AND TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})`,
  );

  await row(
    "Günlük dağılım son 30g — anomali var mı?",
    `SELECT
       CAST(TRHISLEMTARIHI AS DATE) AS gun,
       COUNT(*) AS fatura,
       ISNULL(SUM(DBLNETTUTAR), 0) AS net
     FROM dbo.TBLMSDFATURA
     WHERE BYTTUR = 0 AND BYTDURUM = 0
       AND TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
       AND TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})
     GROUP BY CAST(TRHISLEMTARIHI AS DATE)
     ORDER BY CAST(TRHISLEMTARIHI AS DATE) DESC`,
  );

  await row(
    "Aylık karşılaştırma — son 90g (₺325M tek ay normal mi?)",
    `SELECT
       FORMAT(TRHISLEMTARIHI, 'yyyy-MM') AS ay,
       COUNT(*) AS fatura,
       ISNULL(SUM(DBLNETTUTAR), 0) AS net,
       COUNT(DISTINCT LNGMUSTERIKOD) AS aktif_m
     FROM dbo.TBLMSDFATURA
     WHERE BYTTUR = 0 AND BYTDURUM = 0
       AND TRHISLEMTARIHI >= DATEADD(day, -120, ${sqlNow()})
     GROUP BY FORMAT(TRHISLEMTARIHI, 'yyyy-MM')
     ORDER BY ay DESC`,
  );

  await row(
    "Aynı aralıkta TBLMSDIRSALIYE — bağımsız teyit",
    `SELECT COUNT(*) AS irsaliye_adet, ISNULL(SUM(DBLNETTUTAR), 0) AS net
     FROM dbo.TBLMSDIRSALIYE
     WHERE BYTTUR = 0 AND BYTDURUM = 0
       AND TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
       AND TRHISLEMTARIHI <  DATEADD(day, 1, ${sqlNow()})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
