import { getWietnauerYonetim, getWietnauerIskonto } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { TopDistributorsPanel } from "@/components/v3/TopDistributorsPanel";
import { BrandContributionPanel } from "@/components/v3/BrandContributionPanel";
import { IskontoSegmentPanel } from "@/components/v3/iskonto/IskontoSegmentPanel";
import { formatCompact } from "@/components/komuta/format";

// Sadece segment dilimine ihtiyacımız var — ticari-yatirim sayfasındaki tam
// IskontoSnapshot tipinin alt kümesi. Endpoint aynı, ödediğin bedel cache hit.
type IskontoSegmentsSlice = {
  segments: Array<{
    segment: string;
    brut: number;
    iskonto: number;
    net: number;
    iskontoOraniPct: number;
    musteriSayi: number;
    faturaSayisi: number;
  }>;
};

export const metadata = { title: "Yönetim Kurulu · V3 · Insider" };

/**
 * V3 Dashboard #1 — Yönetim Kurulu.
 *
 * Wietnauer talebi:
 *   - Türkiye geneli toplam satış performansı
 *   - Ciro, hacim, büyüme trendleri
 *   - Distribütör bazlı karşılaştırma
 *   - Bölge ve kanal dağılımı
 *   - Top 10/20/50 müşteri analizleri
 *   - Marka ve ürün grubu satış katkıları
 *   - Kârlılık ve iskonto analizleri
 *
 * Faz A kapsamı (bu sayfa): Top müşteri + Marka katkı + İskonto KPI.
 * Toplam ciro KPI hero + 3 panel single-page yönetici görünümü.
 */
export default async function V3YonetimKuruluPage() {
  const tenant = getTenantConfig();
  let snap: Awaited<ReturnType<typeof getWietnauerYonetim>> | null = null;
  let iskonto: IskontoSegmentsSlice | null = null;
  let err: string | null = null;
  try {
    // İki endpoint paralel — toplam latency = en yavaş tek snapshot.
    [snap, iskonto] = await Promise.all([
      getWietnauerYonetim(),
      getWietnauerIskonto<IskontoSegmentsSlice>(),
    ]);
  } catch (e) {
    err = (e as Error).message;
  }

  // Türev metrikler — gerçek portföy toplamı (top-N değil)
  const toplamCiro = snap?.discount.net ?? 0;
  const toplamFatura = snap?.discount.faturaCount ?? 0;
  const aktifMusteri = snap?.discount.aktifMusteriCount ?? 0;
  // md22: Top 10 distribütör konsantrasyonu (payPct kapsam toplamına göre)
  const top10Pay = snap
    ? snap.topDistributors.slice(0, 10).reduce((a, d) => a + d.payPct, 0)
    : 0;
  const stratPay = snap
    ? snap.brands.filter((b) => b.isStratejik).reduce((a, b) => a + b.payPct, 0)
    : 0;
  const stratCount = snap?.brands.filter((b) => b.isStratejik).length ?? 0;

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 01"
        title="Yönetim Kurulu"
        description={`${tenant.displayName} portföy sağlığı tek ekranda — Top müşteri konsantrasyonu, marka katkıları ve iskonto yatırım oranı son 30 günlük net ciro üzerinden.`}
        dataNote="TBLMSDFATURA + TBLMSDBELGEDETAY · DBLNETTUTAR/DBLNETFIYAT · BYTTUR=0 · BYTDURUM=0"
        generatedAt={snap?.generatedAt}
      />

      {err && (
        <div className="v3-error">
          <strong>Veri alınamadı:</strong> {err}
          <div className="v3-error-hint">
            VPN kontrol et veya MSSQL bağlantı durumunu doğrula.
          </div>
        </div>
      )}

      {snap && (
        <>
          {/* Üst şerit: 4 KPI özet kartı — gerçek portföy toplamları */}
          <div className="v3-kpi-grid">
            <KpiTile
              label="Toplam Net Ciro"
              value={`₺${formatCompact(toplamCiro)}`}
              sub="son 30 gün"
            />
            <KpiTile
              label="Aktif Müşteri"
              value={aktifMusteri.toLocaleString("tr-TR")}
              sub={`${toplamFatura.toLocaleString("tr-TR")} fatura`}
            />
            <KpiTile
              label="Top 10 Konsantrasyon"
              value={`%${top10Pay.toFixed(1)}`}
              sub="portföyün payı"
              tone={top10Pay > 50 ? "warn" : "neutral"}
            />
            <KpiTile
              label="Stratejik Marka Payı"
              value={`%${stratPay.toFixed(1)}`}
              sub={`${stratCount} marka takipte`}
              tone="accent"
            />
          </div>

          {/* Üst içerik: 2 sütun (Marka katkıları + Top Distribütör) */}
          <div className="v3-content-grid">
            <BrandContributionPanel brands={snap.brands} />
            <TopDistributorsPanel distributors={snap.topDistributors} />
          </div>

          {/* Alt içerik: full-width Segment Kırılımı — eski "iskonto yatırımı"
              kartının yerine ticari-yatirim sayfasındaki panelin aynısı. */}
          {iskonto && iskonto.segments.length > 0 && (
            <div className="v3-segment-wrap">
              <IskontoSegmentPanel segments={iskonto.segments} />
            </div>
          )}
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
        .v3-content-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        @media (min-width: 1080px) {
          .v3-content-grid {
            grid-template-columns: 1.4fr 1fr;
            align-items: start;
          }
        }
        .v3-segment-wrap {
          display: block;
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
