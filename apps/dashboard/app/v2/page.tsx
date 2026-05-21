import { PagePlaceholder } from "@/components/v2/PagePlaceholder";

export const metadata = { title: "Radar · V2 · Enroute Pusula" };

export default function V2RadarPage() {
  return (
    <PagePlaceholder
      eyebrow="Radar"
      title="Sistem durumu + hızlı erişim"
      description="V1'deki Radar sayfasıyla aynı bilgi; V2 yerleşim+navigasyon farkı dışında veri kaynağı değişmez."
      comingSoon={[
        "Genel sistem KPI kartları (sync durumu, son güncelleme, demo modu)",
        "Yaklaşan etkinlik banner'ı (CalendarBanner)",
        "Hızlı navigasyon kartları (Komuta · Müşteri · Ürün · Saha)",
        "Son finans agentı analizleri özet listesi",
      ]}
    />
  );
}
