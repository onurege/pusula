import "dotenv/config";
import { runReadOnly } from "@enroute/core";
(async () => {
  const s = await runReadOnly("SELECT @@SERVERNAME srv, DB_NAME() db, GETDATE() simdi", {limit:1});
  console.log("SUNUCU/DB:", JSON.stringify(s.rows[0]));
  // Tüm date kolonlarının max'ı (farklı kolonda güncel olabilir)
  const d = await runReadOnly("SELECT MAX(TRHISLEMTARIHI) islem, MAX(TRHKAYITTARIHI) kayit, MAX(TRHVADETARIHI) vade FROM dbo.TBLMSDFATURA WHERE BYTTUR=0", {limit:1});
  console.log("Max tarihler (islem/kayit/vade):", JSON.stringify(d.rows[0]));
  // Tüm statüler dahil son fatura
  const a = await runReadOnly("SELECT MAX(TRHISLEMTARIHI) son, COUNT(*) adet FROM dbo.TBLMSDFATURA", {limit:1});
  console.log("Tum statuler son islem:", JSON.stringify(a.rows[0]));
  // 2026 aylık yoğunluk
  const m = await runReadOnly("SELECT FORMAT(TRHISLEMTARIHI,'yyyy-MM') ay, COUNT(*) c FROM dbo.TBLMSDFATURA WHERE BYTTUR=0 AND BYTDURUM=0 AND TRHISLEMTARIHI>='2026-01-01' GROUP BY FORMAT(TRHISLEMTARIHI,'yyyy-MM') ORDER BY ay", {limit:12});
  console.log("2026 aylik (islem tarihi):"); m.rows.forEach(x=>console.log("  ",x.ay,"=",x.c));
})();
