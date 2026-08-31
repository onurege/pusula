/**
 * Wietnauer dashboards için tablo keşfi:
 *   - TBLURUNHIYERARSI1: marka yapısı (Jagermeister, Edrington, Beluga vb.)
 *   - TBLMUSTERIEKGRUP: müşteri ek grup tanımları
 *   - TBLCIROSALSEGMENT(MUSTERI): tüketici segment yapısı
 *   - Top müşteri sorgusu sample
 *   - İskonto KPI sample
 *
 * Kullanım:
 *   TENANT=pernod npx tsx scripts/probe-wietnauer.ts
 */
import "dotenv/config";
import { runReadOnly } from "../packages/core/src/db";
import { sqlNow } from "../packages/core/src/now";

async function section(title: string, sql: string) {
  console.log(`\n=== ${title} ===`);
  try {
    const result = await runReadOnly(sql);
    const rows = result.rows;
    if (rows.length === 0) {
      console.log("  (sonuç yok)");
      return;
    }
    const keys = Object.keys(rows[0]!);
    console.log("  " + keys.join(" | "));
    console.log("  " + keys.map(() => "---").join(" | "));
    for (const r of rows.slice(0, 30)) {
      console.log(
        "  " +
          keys
            .map((k) => {
              const v = (r as any)[k];
              if (v === null) return "·";
              if (typeof v === "number")
                return v >= 1000 ? v.toLocaleString("tr-TR") : String(v);
              if (v instanceof Date) return v.toISOString().slice(0, 10);
              return String(v).slice(0, 40);
            })
            .join(" | "),
      );
    }
    if (rows.length > 30) console.log(`  ... +${rows.length - 30} more`);
  } catch (e) {
    console.error("  ERROR:", (e as Error).message);
  }
}

async function main() {
  // 0a) TBLURUNGRUP — Komuta'nın kullandığı seviye (VODKA, WHISKY...)
  await section(
    "TBLURUNGRUP — mevcut Komuta ürün grupları (top 25)",
    `SELECT TOP 25 TXTKOD, TXTAD, LNGDISTKOD
     FROM dbo.TBLURUNGRUP
     WHERE BYTUYGULAMAYERI IN (0, 4)
     ORDER BY TXTAD`,
  );

  // 0b) TBLURUNEKGRUP — muhtemelen MARKA katmanı (Jagermeister, Edrington, Beluga)
  await section(
    "TBLURUNEKGRUP — muhtemelen MARKA tanımları (top 50)",
    `SELECT TOP 50 TXTKOD, TXTAD, LNGDISTKOD
     FROM dbo.TBLURUNEKGRUP
     WHERE BYTUYGULAMAYERI IN (0, 4)
     ORDER BY TXTAD`,
  );

  // 0c) TBLURUN'da TXTURUNEKGRUPKOD dolu mu? Kontrol et
  await section(
    "TBLURUN'da TXTURUNEKGRUPKOD dolu mu? (5 örnek)",
    `SELECT TOP 5 LNGKOD, TXTAD, TXTURUNGRUPKOD, TXTURUNEKGRUPKOD, LNGHIYERARSI1, LNGDISTKOD
     FROM dbo.TBLURUN
     WHERE BYTDURUM = 0`,
  );

  // 0d) Marka × ciro — TBLURUNEKGRUP üzerinden (LNGDISTKOD koşulu kaldırıldı)
  await section(
    "MARKA × ciro (TBLURUNEKGRUP) — son 30g",
    `SELECT TOP 20
       ekg.TXTAD AS marka,
       SUM(d.DBLNETFIYAT) AS ciro,
       COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri_sayi
     FROM dbo.TBLMSDFATURA f
     INNER JOIN dbo.TBLMSDBELGEDETAY d
       ON d.LNGYIL = f.LNGYIL
      AND d.LNGFATURAKOD = f.LNGBELGEKOD
      AND d.LNGDISTKOD = f.LNGDISTKOD
     INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
     INNER JOIN dbo.TBLURUNEKGRUP ekg
       ON ekg.TXTKOD = u.TXTURUNEKGRUPKOD
     WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
       AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
     GROUP BY ekg.TXTAD
     ORDER BY SUM(d.DBLNETFIYAT) DESC`,
  );

  // 1) TBLURUNHIYERARSI1 — seviye dağılımı
  await section(
    "Marka hiyerarşi seviye dağılımı",
    `SELECT BYTSEVIYESIRA, COUNT(*) AS adet
     FROM dbo.TBLURUNHIYERARSI1
     WHERE BYTUYGULAMAYERI IN (0, 4)
     GROUP BY BYTSEVIYESIRA
     ORDER BY BYTSEVIYESIRA`,
  );

  // 2) Üst seviye (muhtemelen marka) — top 30
  await section(
    "Hiyerarşi seviye 1 — muhtemelen MARKA",
    `SELECT TOP 30 LNGKOD, TXTKOD, TXTISIM, LNGBAG, BYTSEVIYESIRA, BYTUYGULAMAYERI
     FROM dbo.TBLURUNHIYERARSI1
     WHERE BYTSEVIYESIRA = 1 AND BYTUYGULAMAYERI IN (0, 4)
     ORDER BY TXTISIM`,
  );

  // 3) Seviye 2 sample (alt-marka veya kategori)
  await section(
    "Hiyerarşi seviye 2 — alt marka/kategori sample",
    `SELECT TOP 20 h2.LNGKOD, h2.TXTISIM AS alt, h1.TXTISIM AS ust
     FROM dbo.TBLURUNHIYERARSI1 h2
     LEFT JOIN dbo.TBLURUNHIYERARSI1 h1 ON h1.LNGKOD = h2.LNGBAG
     WHERE h2.BYTSEVIYESIRA = 2 AND h2.BYTUYGULAMAYERI IN (0, 4)
     ORDER BY h1.TXTISIM, h2.TXTISIM`,
  );

  // 4) TBLURUN'da kaç ürün hangi markaya bağlı (top markalar)
  await section(
    "Ürün adedine göre TOP markalar (TBLURUN.LNGHIYERARSI1 → seviye 1)",
    `SELECT TOP 25
       h1.TXTISIM AS marka,
       COUNT(*) AS urun_adedi
     FROM dbo.TBLURUN u
     INNER JOIN dbo.TBLURUNHIYERARSI1 h1 ON h1.LNGKOD = u.LNGHIYERARSI1
     WHERE u.BYTDURUM = 0
     GROUP BY h1.TXTISIM
     ORDER BY COUNT(*) DESC`,
  );

  // 5) TBLMUSTERIEKGRUP sample
  await section(
    "Müşteri Ek Grup tanımları (top 25)",
    `SELECT TOP 25 TXTKOD, TXTAD, LNGDISTKOD, BYTUYGULAMAYERI
     FROM dbo.TBLMUSTERIEKGRUP
     WHERE BYTUYGULAMAYERI IN (0, 4)
     ORDER BY TXTAD`,
  );

  // 6) Müşteri ek grup linki — TBLMUSTERI'de hangi kolonlar var?
  await section(
    "TBLMUSTERI grup-link kolonları (5 örnek)",
    `SELECT TOP 5 LNGKOD, TXTUNVAN, TXTMUSTERIGRUPKOD
     FROM dbo.TBLMUSTERI
     WHERE BYTDURUM = 0`,
  );
  // Ek grup TBLSBMUSTERIEKGRUPBAGLANTI ya da TBLMUSTERIEKGRUP üzerinden olabilir
  await section(
    "TBLSBMUSTERIEKGRUPBAGLANTI — müşteri × ek grup ilişkisi var mı?",
    `SELECT TOP 5 *
     FROM dbo.TBLSBMUSTERIEKGRUPBAGLANTI`,
  );

  // 7) TBLCIROSALSEGMENT — kaç segment var?
  await section(
    "Cirosal segment tanımları",
    `SELECT TOP 20 LNGKOD, TXTACIKLAMA, TRHBASLANGICTARIH, TRHBITISTARIH
     FROM dbo.TBLCIROSALSEGMENT
     WHERE BYTDURUM = 0
     ORDER BY TRHBASLANGICTARIH DESC`,
  );

  await section(
    "Cirosal segment müşteri sayısı dağılımı",
    `SELECT TXTSEGMENT, COUNT(DISTINCT LNGMUSTERIKOD) AS musteri_sayi
     FROM dbo.TBLCIROSALSEGMENTMUSTERI
     WHERE TXTSEGMENT IS NOT NULL AND TXTSEGMENT <> ''
     GROUP BY TXTSEGMENT
     ORDER BY musteri_sayi DESC`,
  );

  // 8) Top 10 müşteri (son 30g, net ciro)
  await section(
    "Top 10 müşteri — son 30g net ciro",
    `SELECT TOP 10
       f.LNGMUSTERIKOD,
       m.TXTUNVAN,
       m.TXTSEHIR,
       SUM(f.DBLNETTUTAR) AS ciro,
       COUNT(*) AS fatura
     FROM dbo.TBLMSDFATURA f
     INNER JOIN dbo.TBLMUSTERI m ON m.LNGKOD = f.LNGMUSTERIKOD
     WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
       AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
     GROUP BY f.LNGMUSTERIKOD, m.TXTUNVAN, m.TXTSEHIR
     ORDER BY SUM(f.DBLNETTUTAR) DESC`,
  );

  // 9) İskonto KPI sample (son 30g)
  await section(
    "İskonto / ciro oranı — son 30g",
    `SELECT
       SUM(DBLBRUTTUTAR) AS brut,
       SUM(DBLISKONTOTUTARI) AS iskonto,
       SUM(DBLNETTUTAR) AS net,
       CAST(SUM(DBLISKONTOTUTARI) / NULLIF(SUM(DBLBRUTTUTAR), 0) * 100 AS DECIMAL(10,2)) AS iskonto_orani_pct
     FROM dbo.TBLMSDFATURA
     WHERE BYTTUR = 0 AND BYTDURUM = 0
       AND TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})`,
  );

  // 10) Marka × ciro katkısı (son 30g)
  await section(
    "Marka × ciro katkısı — son 30g",
    `SELECT TOP 15
       h1.TXTISIM AS marka,
       SUM(d.DBLNETFIYAT) AS ciro,
       COUNT(DISTINCT f.LNGMUSTERIKOD) AS musteri_sayi
     FROM dbo.TBLMSDFATURA f
     INNER JOIN dbo.TBLMSDBELGEDETAY d
       ON d.LNGYIL = f.LNGYIL
      AND d.LNGFATURAKOD = f.LNGBELGEKOD
      AND d.LNGDISTKOD = f.LNGDISTKOD
     INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
     INNER JOIN dbo.TBLURUNHIYERARSI1 h1 ON h1.LNGKOD = u.LNGHIYERARSI1
     WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
       AND f.TRHISLEMTARIHI >= DATEADD(day, -30, ${sqlNow()})
       AND h1.BYTSEVIYESIRA = 1
     GROUP BY h1.TXTISIM
     ORDER BY SUM(d.DBLNETFIYAT) DESC`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
