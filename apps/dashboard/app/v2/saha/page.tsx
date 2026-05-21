import { Award, Building2, CalendarClock, Layers3 } from "lucide-react";
import { notFound } from "next/navigation";
import { getKomutaSnapshot, type KomutaSnapshot, type ValueUnit } from "@/lib/api";
import { SubTabNav, type SubTab } from "@/components/v2/SubTabNav";
import { RepLeaderboard } from "@/components/komuta/panels/RepLeaderboard";
import { DistLeaderboard } from "@/components/komuta/panels/DistLeaderboard";
import { ChannelMixChart } from "@/components/komuta/ChannelMixChart";
import { PagePlaceholder } from "@/components/v2/PagePlaceholder";
import { UnitToggle } from "@/components/komuta/UnitToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saha · V2 · Enroute Pusula" };

const tabs: SubTab[] = [
  { id: "temsilciler", label: "Temsilciler", icon: <Award size={12} /> },
  { id: "distributorler", label: "Distribütörler", icon: <Building2 size={12} /> },
  { id: "ziyaret", label: "Ziyaret Performansı", icon: <CalendarClock size={12} /> },
  { id: "kanal-mix", label: "Kanal Mix", icon: <Layers3 size={12} /> },
];

type Props = {
  searchParams: Promise<{ tab?: string; unit?: string }>;
};

export default async function V2SahaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const active = sp.tab ?? "temsilciler";
  const unit: ValueUnit = sp.unit === "9le" ? "9le" : "tl";

  // Snapshot tüm Saha sekmeleri için gerekli (reps / dists / channelByType)
  let snap: KomutaSnapshot | null = null;
  try {
    snap = await getKomutaSnapshot({ unit });
  } catch {
    notFound();
  }
  if (!snap) notFound();

  return (
    <div className="komuta-root">
      <header className="komuta-page-header">
        <div className="komuta-page-header-main">
          <div className="komuta-eyebrow">
            <span className="komuta-eyebrow-dot" />
            Saha
          </div>
          <h1 className="komuta-page-title">Satış Operasyonu</h1>
          <p className="komuta-page-desc">
            Temsilci + Distribütör + Ziyaret + Kanal Mix. V1'deki ayrı
            paneller burada konsolide. Aşağıdaki sekmelerden geç.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SubTabNav tabs={tabs} defaultId="temsilciler" />
          <UnitToggle />
        </div>
      </header>

      {active === "temsilciler" && (
        <RepLeaderboard reps={snap.reps} unit={snap.unit} />
      )}

      {active === "distributorler" && (
        <DistLeaderboard dists={snap.topDists} unit={snap.unit} />
      )}

      {active === "ziyaret" && (
        <PagePlaceholder
          eyebrow="Saha · Ziyaret"
          title="Ziyaret Performansı"
          description="V1 /ziyaret sayfasının içeriği bu sekmeye konsolide edilecek (Faz B2)."
          comingSoon={[
            "Bölge başına ziyaret kapsama oranı",
            "Rut içi vs rut dışı dağılım (TBLPMPZIYARETBASLIK.BYTRUTKODU)",
            "Ziyaret → Sipariş dönüşüm oranı",
            "Sahada üretilen belge/tahsilat",
          ]}
        />
      )}

      {active === "kanal-mix" && (
        <ChannelMixChart
          rows={snap.channelByType}
          unit={snap.unit}
          title="Pernod Müşteri Tipi · Son 12 Ay"
          icon="🍸"
          category="müşteri tipi"
          sourceNote="Pernod kanal segmentasyonu: TBLMUSTERIEKSAHA saha 8 (Müşteri Tipi) × TBLEKSAHASECENEK lookup. Perakende / On Trade / Otel / Tali Bayi / OPA — Pernod'un resmi kanal tanımları."
        />
      )}
    </div>
  );
}
