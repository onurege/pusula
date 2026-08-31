import { getWietnauerMarka } from "@/lib/api";
import { cs, panelHidden } from "@/lib/content";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { GlobalDonemFilter } from "@/components/v3/GlobalDonemFilter";
import { donemLabel } from "@/lib/donem";
import { formatCompact } from "@/components/komuta/format";
import { BrandPortfolioPanel } from "@/components/v3/marka/BrandPortfolioPanel";
import { TopSkusPanel } from "@/components/v3/marka/TopSkusPanel";
import { BrandPenetrationPanel } from "@/components/v3/marka/BrandPenetrationPanel";
import { StrategicBrandZoom } from "@/components/v3/marka/StrategicBrandZoom";
import { MarkaSkuExportButton } from "@/components/v3/marka/ExportButton";
import type { WietnauerMarkaSnapshot } from "@/components/v3/marka/types";

export const metadata = { title: "Marka & SKU · V3 · Insider" };

/**
 * V3 Dashboard #4 — Marka & SKU Performansı.
 *
 * Wietnauer talebi:
 *   - Marka bazında satış (top 20 marka × ciro × müşteri × pay)
 *   - Top 10 SKU performansı (TBLURUN seviyesi)
 *   - Marka penetrasyon — kaç müşteri X markayı alıyor
 *   - Stratejik marka zoom (Jagermeister, Macallan, Highland Park, …)
 *   - Son 30g vs 90g vs YTD karşılaştırma (ivme analizi)
 *
 * Veri kaynağı: TBLURUNGRUP (Wietnauer marka) × TBLURUN × TBLMSDBELGEDETAY.
 * Tenant config soyutlaması: Pernod'da `brandTable` TERS atanır → aynı sayfa
 * Pernod'da da çalışır.
 */
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  searchParams: Promise<{ donem?: string; from?: string; to?: string }>;
};

export default async function V3MarkaSkuPage({ searchParams }: Props) {
  const tenant = getTenantConfig();
  const sp = await searchParams;
  const dateFrom = sp.from && ISO_DATE_RX.test(sp.from) ? sp.from : null;
  const dateTo = sp.to && ISO_DATE_RX.test(sp.to) ? sp.to : null;
  const donem = dateFrom && dateTo ? null : (sp.donem ?? "").toLowerCase() || null;
  let snap: WietnauerMarkaSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerMarka<WietnauerMarkaSnapshot>({ dateFrom, dateTo, donem });
  } catch (e) {
    err = (e as Error).message;
  }

  // Türev üst-bant KPI'lar
  const toplamCiro = snap?.toplamCiro30 ?? 0;
  const aktifMusteri = snap?.aktifMusteriToplam ?? 0;
  const top5Pay = snap
    ? snap.portfolio.slice(0, 5).reduce((a, b) => a + b.payPct, 0)
    : 0;
  const stratActive = snap
    ? snap.strategic.filter((s) => s.hasData).length
    : 0;
  const stratTotal = snap?.strategic.length ?? 0;
  const stratCiro = snap
    ? snap.strategic.reduce((a, s) => a + s.ciro, 0)
    : 0;
  const stratSharePct = toplamCiro > 0 ? (stratCiro / toplamCiro) * 100 : 0;
  // md-task7: KPI alt-metinlerini snapshot'tan türetilen gerçek değerlerle
  // dinamikleştir (uydurma yok — snap null ise generic fallback'e düşer).
  const markaSayisi = snap
    ? snap.portfolio.filter((b) => !b.isOther && !b.isTotal).length
    : 0;
  const skuSayisi = snap
    ? snap.topSkus.filter((s) => !s.isOther && !s.isTotal).length
    : 0;
  const topBrand = snap
    ? (snap.portfolio.find((b) => !b.isOther && !b.isTotal) ?? null)
    : null;

  // md-task7: statik "son 30 gün" metinleri yerine gerçek seçili dönem etiketi.
  const periodLabel = donemLabel(donem, dateFrom, dateTo);
  const periodLabelCap =
    periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1);

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 04"
        title="Marka & SKU Performansı"
        contentKey="page.marka.title"
        descKey="page.marka.desc"
        description={`${tenant.displayName} marka portföyü, SKU şampiyonları, penetrasyon ve stratejik marka zoom — ${periodLabel} net ciro odağında, YTD ivme metrikleriyle.`}
        dataNote="TBLURUNGRUP / TBLURUNEKGRUP · TBLURUN · TBLMSDBELGEDETAY · DBLNETFIYAT · BYTTUR=0 · BYTDURUM=0"
        generatedAt={snap?.generatedAt}
      />

      <GlobalDonemFilter />

      {err && (
        <div className="v3-error">
          <strong>Veri alınamadı:</strong> {err}
          <div className="v3-error-hint">
            VPN kontrol et veya MSSQL bağlantı durumunu doğrula. API restart
            gerekebilir.
          </div>
        </div>
      )}

      {snap && (
        <>
          <div className="v3-toolbar">
            <MarkaSkuExportButton
              portfolio={snap.portfolio}
              topSkus={snap.topSkus}
            />
          </div>

          {/* Üst şerit: 4 KPI özet kartı */}
          <div className="v3-kpi-grid">
            {!panelHidden("kpi.marka.ciro") && (
            <KpiTile
              label={cs("kpi.marka.ciro", "Toplam Net Ciro")}
              value={`₺${formatCompact(toplamCiro)}`}
              sub={`${periodLabel} · ${markaSayisi} marka × ${skuSayisi} SKU bazlı`}
            />
          )}
            {!panelHidden("kpi.marka.aktif") && (
            <KpiTile
              label={cs("kpi.marka.aktif", "Aktif Müşteri")}
              value={aktifMusteri.toLocaleString("tr-TR")}
              sub={`${periodLabel} fatura kesilen distinct`}
            />
          )}
            {!panelHidden("kpi.marka.top5") && (
            <KpiTile
              label={cs("kpi.marka.top5", "Top 5 Marka Payı")}
              value={`%${top5Pay.toFixed(1)}`}
              sub={
                topBrand
                  ? `lider: ${topBrand.marka} · %${topBrand.payPct.toFixed(1)}`
                  : "portföyün konsantrasyonu"
              }
              tone={top5Pay > 70 ? "warn" : "neutral"}
            />
          )}
            {!panelHidden("kpi.marka.stratejik") && (
            <KpiTile
              label={cs("kpi.marka.stratejik", "Stratejik Marka Payı")}
              value={`%${stratSharePct.toFixed(1)}`}
              sub={`${stratActive}/${stratTotal} marka aktif`}
              tone="accent"
            />
          )}
          </div>

          {/* İçerik: full-width A, sonra 2 sütun B+C, full-width D, full-width E */}
          <div className="v3-content">
            <BrandPortfolioPanel rows={snap.portfolio} periodLabel={periodLabelCap} />

            <div className="row-2col">
              <TopSkusPanel rows={snap.topSkus} periodLabel={periodLabelCap} />
              <BrandPenetrationPanel
                rows={snap.penetration}
                aktifMusteriToplam={snap.aktifMusteriToplam}
                periodLabel={periodLabelCap}
              />
            </div>

            <StrategicBrandZoom brands={snap.strategic} periodLabel={periodLabelCap} />
            {/* md31: 30g/90g/YTD karşılaştırma paneli kaldırıldı. */}
          </div>
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .v3-toolbar {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 12px;
        }
        .v3-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 20px;
        }
        .v3-content {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .row-2col {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1080px) {
          .row-2col {
            grid-template-columns: 1.4fr 1fr;
            align-items: start;
          }
        }
        .v3-error {
          background: var(--color-bad-bg, rgba(220, 38, 38, 0.05));
          border: 1px solid var(--color-bad, #dc2626);
          border-radius: 8px;
          padding: 14px 16px;
          margin-bottom: 20px;
          font-size: 13px;
          color: var(--color-fg);
        }
        .v3-error-hint {
          margin-top: 4px;
          font-size: 12px;
          color: var(--color-muted);
        }
      `,
        }}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warn" | "accent";
}) {
  const color =
    tone === "warn"
      ? "var(--color-bad)"
      : tone === "accent"
        ? "var(--color-accent)"
        : "var(--color-fg)";
  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--color-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--color-muted-2)",
        }}
      >
        {sub}
      </div>
    </div>
  );
}
