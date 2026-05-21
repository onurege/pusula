import { PagePlaceholder } from "@/components/v2/PagePlaceholder";
import Link from "next/link";

export const metadata = { title: "Harita · V2 · Enroute Pusula" };

/**
 * V2'de harita mevcut /map sayfasının aynısı — Faz A'da tam taşıma yapmak
 * yerine direkt /map'e shortcut bırakıyoruz. Faz B'de yeni density heatmap
 * layer + bölge polygon view birleşik tasarımıyla buraya taşınır.
 */
export default function V2HaritaPage() {
  return (
    <div className="space-y-4">
      <PagePlaceholder
        eyebrow="Harita"
        title="Satış Haritası"
        description="V2'de harita ayrı bir tema yerleşimine kavuşacak (density heatmap toggle, drill-down konsolide). Şimdilik mevcut harita sayfasına bağ var."
        comingSoon={[
          "Mevcut /map sayfasındaki müşteri marker + cluster view",
          "Bölge polygon view (klasik 7 bölge)",
          "YENİ: Density heatmap toggle (MapLibre native heatmap layer)",
          "Drill-down breadcrumb (Türkiye → bölge → şehir → dist → müşteri)",
          "Tek bir harita component'i, sağ panel'de seçili öğenin KPI'ları",
        ]}
      />
      <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
        Mevcut canlı harita →{" "}
        <Link href="/map" className="text-accent font-semibold hover:underline">
          /map sayfasına git
        </Link>
      </div>
    </div>
  );
}
