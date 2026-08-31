import "dotenv/config";
import { runReadOnly } from "@enroute/core";
(async () => {
  const s = await runReadOnly("SELECT @@SERVERNAME srv, DB_NAME() db, GETDATE() simdi", {limit:1});
  console.log("SUNUCU/DB:", JSON.stringify(s.rows[0]));
  const a = await runReadOnly("SELECT MAX(TRHISLEMTARIHI) son, COUNT(*) adet FROM dbo.TBLMSDFATURA WHERE BYTTUR=0 AND BYTDURUM=0", {limit:1});
  console.log("Son fatura (BYTTUR=0,BYTDURUM=0):", JSON.stringify(a.rows[0]));
  const g = await runReadOnly("SELECT TOP 8 CAST(TRHISLEMTARIHI AS DATE) g, COUNT(*) c FROM dbo.TBLMSDFATURA WHERE BYTTUR=0 AND BYTDURUM=0 GROUP BY CAST(TRHISLEMTARIHI AS DATE) ORDER BY g DESC", {limit:8});
  console.log("Son 8 gun:"); g.rows.forEach(x=>console.log("  ",x.g,"->",x.c));
  const m = await runReadOnly("SELECT FORMAT(TRHISLEMTARIHI,'yyyy-MM') ay, COUNT(*) c, SUM(DBLNETTUTAR) ciro FROM dbo.TBLMSDFATURA WHERE BYTTUR=0 AND BYTDURUM=0 AND TRHISLEMTARIHI>='2026-01-01' GROUP BY FORMAT(TRHISLEMTARIHI,'yyyy-MM') ORDER BY ay", {limit:12});
  console.log("2026 aylik:"); m.rows.forEach(x=>console.log("  ",x.ay,"=",x.c,"fatura",Math.round(Number(x.ciro)/1e6)+"M"));

  // Yönetim Kurulu KPI'sinin BİREBİR SQL'i — pencere DB GETDATE()'e göre (yani "anlık").
  const k = await runReadOnly(
    "SELECT ISNULL(SUM(DBLNETTUTAR),0) net, COUNT(*) fatura, COUNT(DISTINCT LNGMUSTERIKOD) aktif " +
    "FROM dbo.TBLMSDFATURA WHERE BYTTUR=0 AND BYTDURUM=0 " +
    "AND TRHISLEMTARIHI >= DATEADD(day,-30,GETDATE()) AND TRHISLEMTARIHI < DATEADD(day,1,GETDATE())",
    {limit:1});
  const r = k.rows[0];
  console.log("\n=== YÖNETİM KURULU KPI — son 30g (DB GETDATE penceresi) ===");
  console.log("  Toplam Net Ciro :", "TL " + Math.round(Number(r.net)/1e6) + "M   (ham: " + r.net + ")");
  console.log("  Fatura sayisi   :", Number(r.fatura).toLocaleString("tr-TR"));
  console.log("  Aktif musteri   :", Number(r.aktif).toLocaleString("tr-TR"));
  console.log("  >> Dashboard 'son gunceleme'=BUGUN olunca bu 3 sayi ile eslesmenli.");
})();
