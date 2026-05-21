import { runReadOnly } from "../packages/core/src/index.js";

/**
 * TBLURUN'un grup eşlemesinin gerçekte ne durumda olduğunu anlamak için:
 * 1. TBLURUNGRUP'ta kaç kayıt var? Örneğin?
 * 2. TBLURUN.TXTURUNGRUPKOD doluluk oranı?
 * 3. TBLURUNGRUP join eşleşme oranı (hangi LNGDISTKOD eşleşiyor)?
 * 4. Top 20 ürünün grup adı / TXTURUNGRUPKOD durumu nedir?
 * 5. TXTURUNEKGRUPKOD da bir alternatif mi?
 */
async function main() {
  console.log("\n=== 1. TBLURUNGRUP içeriği (ilk 30 satır) ===");
  const g = await runReadOnly(
    `SELECT TOP 30 TXTKOD, TXTAD, LNGDISTKOD FROM dbo.TBLURUNGRUP ORDER BY TXTKOD`,
    { limit: 30, timeoutMs: 30_000 },
  );
  console.log(`Toplam ${g.rowCount} kayıt döndü (${g.truncated ? "kesildi" : "tam"})`);
  for (const r of g.rows) console.log(`  TXTKOD=${r.TXTKOD}  TXTAD="${r.TXTAD}"  LNGDISTKOD=${r.LNGDISTKOD}`);

  console.log("\n=== 2. TBLURUN.TXTURUNGRUPKOD doluluk ===");
  const doluluk = await runReadOnly(
    `SELECT
       COUNT(*) AS toplam,
       SUM(CASE WHEN TXTURUNGRUPKOD IS NULL OR LTRIM(RTRIM(TXTURUNGRUPKOD))='' THEN 1 ELSE 0 END) AS bos,
       SUM(CASE WHEN TXTURUNGRUPKOD IS NOT NULL AND LTRIM(RTRIM(TXTURUNGRUPKOD))<>'' THEN 1 ELSE 0 END) AS dolu
     FROM dbo.TBLURUN`,
    { limit: 1, timeoutMs: 30_000 },
  );
  console.log(doluluk.rows[0]);

  console.log("\n=== 3. Join eşleşme oranı (son 30g'de satılan ürünler için) ===");
  const join = await runReadOnly(
    `SELECT
       COUNT(*) AS toplam_satir,
       SUM(CASE WHEN g.TXTAD IS NOT NULL THEN 1 ELSE 0 END) AS join_basarili,
       SUM(CASE WHEN g.TXTAD IS NULL THEN 1 ELSE 0 END)     AS join_bos
     FROM dbo.TBLMSDFATURA f
     INNER JOIN dbo.TBLMSDBELGEDETAY d
       ON d.LNGYIL = f.LNGYIL AND d.LNGFATURAKOD = f.LNGBELGEKOD AND d.LNGDISTKOD = f.LNGDISTKOD
     INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
     LEFT JOIN dbo.TBLURUNGRUP g
       ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
     WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
       AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())`,
    { limit: 1, timeoutMs: 60_000 },
  );
  console.log(join.rows[0]);

  console.log("\n=== 4. LNGDISTKOD ŞART'ı atılsa join düzelir mi? ===");
  const join2 = await runReadOnly(
    `SELECT
       COUNT(*) AS toplam_satir,
       SUM(CASE WHEN g.TXTAD IS NOT NULL THEN 1 ELSE 0 END) AS join_basarili,
       SUM(CASE WHEN g.TXTAD IS NULL THEN 1 ELSE 0 END)     AS join_bos
     FROM dbo.TBLMSDFATURA f
     INNER JOIN dbo.TBLMSDBELGEDETAY d
       ON d.LNGYIL = f.LNGYIL AND d.LNGFATURAKOD = f.LNGBELGEKOD AND d.LNGDISTKOD = f.LNGDISTKOD
     INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
     LEFT JOIN dbo.TBLURUNGRUP g
       ON g.TXTKOD = u.TXTURUNGRUPKOD
     WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
       AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())`,
    { limit: 1, timeoutMs: 60_000 },
  );
  console.log(join2.rows[0]);

  console.log("\n=== 5. Top 20 ürün için (TXTAD, TXTURUNGRUPKOD, eşleşen grup adı) ===");
  const products = await runReadOnly(
    `SELECT TOP 20
       u.TXTAD AS urun_adi,
       u.TXTURUNGRUPKOD,
       u.TXTURUNEKGRUPKOD,
       u.LNGDISTKOD,
       g.TXTAD AS grup_adi,
       gek.TXTAD AS ek_grup_adi,
       SUM(d.DBLNETFIYAT * d.DBLMIKTAR) AS ciro
     FROM dbo.TBLMSDFATURA f
     INNER JOIN dbo.TBLMSDBELGEDETAY d
       ON d.LNGYIL = f.LNGYIL AND d.LNGFATURAKOD = f.LNGBELGEKOD AND d.LNGDISTKOD = f.LNGDISTKOD
     INNER JOIN dbo.TBLURUN u ON u.LNGKOD = d.LNGURUNKOD
     LEFT JOIN dbo.TBLURUNGRUP g
       ON g.TXTKOD = u.TXTURUNGRUPKOD AND g.LNGDISTKOD = u.LNGDISTKOD
     LEFT JOIN dbo.TBLURUNEKGRUP gek
       ON gek.TXTKOD = u.TXTURUNEKGRUPKOD AND gek.LNGDISTKOD = u.LNGDISTKOD
     WHERE f.BYTTUR = 0 AND f.BYTDURUM = 0
       AND f.TRHISLEMTARIHI >= DATEADD(day, -30, GETDATE())
     GROUP BY u.TXTAD, u.TXTURUNGRUPKOD, u.TXTURUNEKGRUPKOD, u.LNGDISTKOD, g.TXTAD, gek.TXTAD
     ORDER BY ciro DESC`,
    { limit: 20, timeoutMs: 60_000 },
  );
  for (const r of products.rows) {
    console.log(
      `  "${r.urun_adi}"\n    TXTURUNGRUPKOD=${r.TXTURUNGRUPKOD ?? "(null)"}  LNGDISTKOD=${r.LNGDISTKOD}` +
      `\n    grup_adi=${r.grup_adi ?? "(null)"}  ek_grup_adi=${r.ek_grup_adi ?? "(null)"}` +
      `  ciro=${Number(r.ciro).toLocaleString("tr-TR")}`
    );
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
