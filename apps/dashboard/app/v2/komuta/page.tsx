import { notFound } from "next/navigation";
import { getKomutaSnapshot, type KomutaSnapshot, type ValueUnit } from "@/lib/api";
import { AiInsightBar } from "@/components/komuta/panels/AiInsightBar";
import { KpiStrip } from "@/components/komuta/panels/KpiStrip";
import { CalendarBanner } from "@/components/komuta/panels/CalendarBanner";
import { TurkeyMapPolygon } from "@/components/komuta/TurkeyMapPolygon";
import { CalendarChart } from "@/components/komuta/CalendarChart";
import { UnitToggle } from "@/components/komuta/UnitToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Komuta · V2 · Enroute Pusula" };

type Props = {
  searchParams: Promise<{
    refresh?: string;
    reel?: string;
    otv?: string;
    unit?: string;
  }>;
};

/**
 * V2 Komuta — executive özet. V1'in 9-panelli "her şey burada" sayfasından
 * sadece "bu sabahın hikayesi" çıkarılır. Detay analizler Müşteri / Ürün /
 * Saha sekmelerine taşınır.
 */
export default async function V2KomutaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const forceRefresh = sp.refresh === "1";
  const reelTL = sp.reel === "1";
  const otvNet = sp.otv === "1";
  const unit: ValueUnit = sp.unit === "9le" ? "9le" : "tl";

  let snap: KomutaSnapshot;
  try {
    snap = await getKomutaSnapshot({
      refresh: forceRefresh,
      reelTL,
      otvNet,
      unit,
    });
  } catch {
    notFound();
  }

  return (
    <div className="komuta-root">
      <header className="komuta-page-header">
        <div className="komuta-page-header-main">
          <div className="komuta-eyebrow">
            <span className="komuta-eyebrow-dot" />
            Komuta · executive özet
          </div>
          <h1 className="komuta-page-title">Bu Sabah Neye Bakmalıyım</h1>
          <p className="komuta-page-desc">
            <strong>Üst-düzey görünüm:</strong> bölge sağlığı, dönem
            karşılaştırması, takvim. Detay paneller{" "}
            <strong>Müşteri / Ürün / Saha</strong> sekmelerinde.
          </p>
        </div>
        <UnitToggle />
      </header>

      {snap.brief && <AiInsightBar brief={snap.brief} />}
      <KpiStrip kpis={snap.kpis} />
      {snap.upcomingEvent && <CalendarBanner event={snap.upcomingEvent} />}

      <div className="main-grid">
        <TurkeyMapPolygon regions={snap.regions} />
        {/* CalendarChart Fragment olarak 2 element döner (eyebrow + card);
            grid item olarak tek hücreye sıkıştırmak için div'le sarıyoruz. */}
        <div>
          <CalendarChart monthly={snap.monthlyTrend} unit={snap.unit} />
        </div>
      </div>
    </div>
  );
}
