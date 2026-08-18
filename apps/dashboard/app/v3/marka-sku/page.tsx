import { getWietnauerMarka } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { formatCompact } from "@/components/komuta/format";
import { BrandPortfolioPanel } from "@/components/v3/marka/BrandPortfolioPanel";
import { TopSkusPanel } from "@/components/v3/marka/TopSkusPanel";
import { BrandPenetrationPanel } from "@/components/v3/marka/BrandPenetrationPanel";
import { StrategicBrandZoom } from "@/components/v3/marka/StrategicBrandZoom";
import type { WietnauerMarkaSnapshot } from "@/components/v3/marka/types";

export const metadata = { title: "Marka & SKU · V3 · NORA 4Sight" };

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
export default async function V3MarkaSkuPage() {
  const tenant = getTenantConfig();
  let snap: WietnauerMarkaSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerMarka<WietnauerMarkaSnapshot>();
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

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 04"
        title="Marka & SKU Performansı"
        description={`${tenant.displayName} marka portföyü, SKU şampiyonları, penetrasyon ve stratejik marka zoom — son 30 gün net ciro odağında, YTD ivme metrikleriyle.`}
        dataNote="TBLURUNGRUP / TBLURUNEKGRUP · TBLURUN · TBLMSDBELGEDETAY · DBLNETFIYAT · BYTTUR=0 · BYTDURUM=0"
        generatedAt={snap?.generatedAt}
      />

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
          {/* Üst şerit: 4 KPI özet kartı */}
          <div className="v3-kpi-grid">
            <KpiTile
              label="Toplam Net Ciro"
              value={`₺${formatCompact(toplamCiro)}`}
              sub="son 30 gün · marka × SKU bazlı"
            />
            <KpiTile
              label="Aktif Müşteri"
              value={aktifMusteri.toLocaleString("tr-TR")}
              sub="son 30g fatura kesilen distinct"
            />
            <KpiTile
              label="Top 5 Marka Payı"
              value={`%${top5Pay.toFixed(1)}`}
              sub="portföyün konsantrasyonu"
              tone={top5Pay > 70 ? "warn" : "neutral"}
            />
            <KpiTile
              label="Stratejik Marka Payı"
              value={`%${stratSharePct.toFixed(1)}`}
              sub={`${stratActive}/${stratTotal} marka aktif`}
              tone="accent"
            />
          </div>

          {/* İçerik: full-width A, sonra 2 sütun B+C, full-width D, full-width E */}
          <div className="v3-content">
            <BrandPortfolioPanel rows={snap.portfolio} />

            <div className="row-2col">
              <TopSkusPanel rows={snap.topSkus} />
              <BrandPenetrationPanel
                rows={snap.penetration}
                aktifMusteriToplam={snap.aktifMusteriToplam}
              />
            </div>

            <StrategicBrandZoom brands={snap.strategic} />
            {/* md31: 30g/90g/YTD karşılaştırma paneli kaldırıldı. */}
          </div>
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
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
