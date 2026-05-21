import { BarChart3, Boxes, Layers3, ScatterChart, TrendingUp } from "lucide-react";
import { notFound } from "next/navigation";
import { getKomutaSnapshot, type KomutaSnapshot, type ValueUnit } from "@/lib/api";
import { SubTabNav, type SubTab } from "@/components/v2/SubTabNav";
import { MatrixPanel } from "@/components/komuta/panels/MatrixPanel";
import { HeatmapPanel } from "@/components/komuta/panels/HeatmapPanel";
import { PortfolioPanel } from "@/components/komuta/panels/PortfolioPanel";
import { PagePlaceholder } from "@/components/v2/PagePlaceholder";
import { UnitToggle } from "@/components/komuta/UnitToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ürün · V2 · Enroute Pusula" };

const tabs: SubTab[] = [
  { id: "treemap", label: "Treemap", icon: <Boxes size={12} /> },
  { id: "yorunge", label: "Yörünge", icon: <TrendingUp size={12} /> },
  { id: "donem", label: "Dönem Karşılaştırma", icon: <BarChart3 size={12} /> },
  { id: "heatmap", label: "Bölge × Grup", icon: <Layers3 size={12} /> },
  { id: "execution-gap", label: "Execution Gap", icon: <ScatterChart size={12} /> },
];

type Props = {
  searchParams: Promise<{ tab?: string; unit?: string }>;
};

export default async function V2UrunPage({ searchParams }: Props) {
  const sp = await searchParams;
  const active = sp.tab ?? "treemap";
  const unit: ValueUnit = sp.unit === "9le" ? "9le" : "tl";

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
            Ürün
          </div>
          <h1 className="komuta-page-title">Ürün Analizi</h1>
          <p className="komuta-page-desc">
            Treemap, dönem karşılaştırma, bölge heatmap'i, 2-yıllık yörünge,
            execution gap. V1'deki ayrı paneller burada konsolide.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SubTabNav tabs={tabs} defaultId="treemap" />
          <UnitToggle />
        </div>
      </header>

      {active === "treemap" && (
        <PagePlaceholder
          eyebrow="Ürün · Treemap"
          title="Brand × SKU Hiyerarşik Satış"
          description="Recharts Treemap komponenti ile son 30g net ciro hiyerarşisi. Faz B2'de eklenecek."
          comingSoon={[
            "Recharts <Treemap> komponenti, last 30g net ciro",
            "Marka düzeyinde renkler (Chivas / Ballantines / Absolut / Havana / vs.)",
            "Hover → SKU detay tooltip (ciro / adet / 9L)",
            "Toggle: ciro vs 9L volume bazında treemap",
          ]}
        />
      )}

      {active === "yorunge" && (
        <PortfolioPanel portfolio={snap.portfolio} unit={snap.unit} />
      )}

      {active === "donem" && <MatrixPanel matrix={snap.matrix} unit={snap.unit} />}

      {active === "heatmap" && <HeatmapPanel heatmap={snap.heatmap} />}

      {active === "execution-gap" && (
        <PagePlaceholder
          eyebrow="Ürün · Execution Gap"
          title="Stockout × Margin × Lost Revenue"
          description="X: Stockout Frequency, Y: Profit Margin, Bubble: Lost Revenue. Üst-sağ köşe = acil aksiyon bölgesi. Faz B2'de gelir."
          comingSoon={[
            "Recharts <ScatterChart> + custom bubble",
            "X ekseni: TBLDEPO / TBLSTOK üzerinden out-of-stock yüzdesi",
            "Y ekseni: Profit margin (DBLBRUTTUTAR vs DBLNETTUTAR oranı)",
            "Bubble büyüklüğü: kaybedilen ciro tahmini",
            "Channel renkleri (GT / MT / HORECA / E-Com)",
            "Action Zone (top-right) kırmızı overlay",
          ]}
        />
      )}
    </div>
  );
}
