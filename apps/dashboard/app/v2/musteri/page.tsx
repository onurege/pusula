import { Compass, Filter, ListChecks, Target, UserSearch } from "lucide-react";
import { PagePlaceholder } from "@/components/v2/PagePlaceholder";
import type { SubTab } from "@/components/v2/SubTabNav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Müşteri · V2 · Enroute Pusula" };

const tabs: SubTab[] = [
  { id: "genel", label: "Genel", icon: <Compass size={12} /> },
  { id: "funnel", label: "Funnel", icon: <Filter size={12} /> },
  { id: "risk", label: "Risk Analizi", icon: <Target size={12} /> },
  { id: "foresight", label: "Foresight", icon: <ListChecks size={12} /> },
  { id: "musteri-360", label: "360°", icon: <UserSearch size={12} /> },
];

type Props = {
  searchParams: Promise<{ tab?: string }>;
};

export default async function V2MusteriPage({ searchParams }: Props) {
  const sp = await searchParams;
  const active = sp.tab ?? "genel";

  const content: Record<string, { title: string; description: string; comingSoon: string[] }> = {
    genel: {
      title: "Müşteri Genel Görünümü",
      description: "Pernod Müşteri Tipi dağılımı + Müşteri Grubu kırılımı + Risk skoru histogramı. Yöneticinin 30 saniyede portföy resmini gördüğü ekran.",
      comingSoon: [
        "Pernod Müşteri Tipi Donut (TBLMUSTERIEKSAHA saha 8: Perakende / On Trade / Otel / Tali Bayi / OPA / CC&Toptan / Bölgesel On Trade)",
        "Müşteri Tipi × 12 ay stacked bar (V1 Komuta'dan taşınır)",
        "Risk Score 5-tier histogram (Healthy / Watch / Risk / Critical / Unknown)",
        "Top 20 müşteri ciro listesi (drill-down → 360°)",
        "Kayıp müşteri sayacı (vs 12 ay önce)",
      ],
    },
    funnel: {
      title: "Sales Funnel — Pipeline",
      description: "Potansiyel müşteri tabelası → ziyaret → sipariş → fatura → tahsilat dönüşüm hunisi. Pernod için dropoff noktalarını gösterir.",
      comingSoon: [
        "5 katmanlı funnel: Tabela / Ziyaret edildi / Sipariş alındı / Faturalandı / Tahsil edildi",
        "Conversion rate her aşamada (örn. ziyaret → sipariş %62)",
        "Dropoff alarm — geçen aya göre %15+ düşüş varsa kırmızı",
        "Funnel × bölge breakdown (hangi bölge en yüksek dönüşüm)",
        "Kaynak: TBLPMPZIYARETBASLIK + TBLMSDFATURA + TBLMSDTAHSILAT",
      ],
    },
    risk: {
      title: "Risk Analizi",
      description: "Composite Risk Score (0-100) dağılımı + Critical tier müşteri listesi + Foresight risk flag'leri. V1'deki /risk sayfası buraya taşınır.",
      comingSoon: [
        "Risk score histogram (5 tier kırılımı + ortalama skor)",
        "Critical müşteri tablosu (skor 75+, drill-down → 360°)",
        "Risk bileşen kırılımı (momentum / behavioral / payment / engagement)",
        "Bölge × risk tier matrix (hangi bölgede critical yığılması var)",
        "V1 /risk sayfasının tüm içeriği buraya konsolide",
      ],
    },
    foresight: {
      title: "Foresight Inbox",
      description: "14 günlük müşteri foresight'larının toplu özeti — hangi müşterilere ne zaman ulaşılmalı, hangi aksiyon öncelikli.",
      comingSoon: [
        "Yaklaşan etkinlik bazlı foresight (Ramazan / Yılbaşı / Bayram öncesi)",
        "Yüksek baseline'lı + son alış 7+ gün önce müşteri öneri listesi",
        "Müşteri × öneri Gemini açıklaması (mevcut modal'dan inbox formatına)",
        "Aksiyon → Bu Hafta Yapılacaklar drawer'a ekle (zaten var)",
      ],
    },
    "musteri-360": {
      title: "Müşteri 360° — Detay",
      description: "Tek müşteri için tam profil — modal'daki CustomerModal'ın tam sayfa versiyonu. Arama, geçmiş, foresight, ürün karması, ziyaret tarihçesi.",
      comingSoon: [
        "Global arama (unvan / kısa ad / vergi no / dist kodu)",
        "Müşteri başlığı + Composite Risk Score kartı",
        "Son 90g ciro trendi (mini chart)",
        "Ürün karması — favori SKU'lar + bırakılan kategoriler",
        "Ziyaret tarihçesi timeline",
        "Foresight inline (14g öneri)",
        "Açık irsaliye / fatura listesi (tabel)",
      ],
    },
  };

  const ctx = content[active] ?? content.genel;

  return (
    <PagePlaceholder
      eyebrow="Müşteri"
      title={ctx!.title}
      description={ctx!.description}
      tabs={tabs}
      defaultTabId="genel"
      comingSoon={ctx!.comingSoon}
    />
  );
}
