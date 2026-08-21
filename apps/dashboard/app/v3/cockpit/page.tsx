// V3 — Cockpit. /komuta sayfasının tıpa tıp aynısı v3 IA içinde mount edilir.
// Tek dosya re-export: aynı KomutaPage default export'u alıp v3 metadata ile
// servis ederiz. Veri çağrısı, panel render'ı, finans-agent drill-down tek
// noktada tutulduğu için duplikasyon yok; /komuta'da yapılan her değişiklik
// burada da otomatik yansır.
import KomutaPage from "@/app/komuta/page";

export const metadata = { title: "Cockpit · V3 · Insider" };

export default KomutaPage;
