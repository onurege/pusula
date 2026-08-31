import { getWietnauerYonetim, getWietnauerIskonto } from "@/lib/api";
import { cs, panelHidden } from "@/lib/content";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { GlobalDonemFilter } from "@/components/v3/GlobalDonemFilter";
import { donemLabel } from "@/lib/donem";
import { TopDistributorsPanel } from "@/components/v3/TopDistributorsPanel";
import { BrandContributionPanel } from "@/components/v3/BrandContributionPanel";
import { IskontoSegmentPanel } from "@/components/v3/iskonto/IskontoSegmentPanel";
import { formatCompact } from "@/components/komuta/format";

// Sadece segment dilimine ihtiyacımız var — ticari-yatirim sayfasındaki tam
// IskontoSnapshot tipinin alt kümesi. Endpoint aynı, ödediğin bedel cache hit.
type IskontoSegmentRowSlice = {
  segment: string;
  brut: number;
  iskonto: number;
  net: number;
  iskontoOraniPct: number;
  musteriSayi: number;
  faturaSayisi: number;
};
type IskontoSegmentsSlice = {
  /** Müşteri Grup Kırılımı (Prestige/Premium/Standart…) */
  segments: IskontoSegmentRowSlice[];
  /** Müşteri Ek Grup (TEKEL/BÜFE/MARKET/BAR…) — ilk 5 + Diğer */
  ekGrupSegments: IskontoSegmentRowSlice[];
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
const ISO_DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  searchParams: Promise<{ donem?: string; from?: string; to?: string }>;
};

export default async function V3YonetimKuruluPage({ searchParams }: Props) {
  const tenant = getTenantConfig();
  const sp = await searchParams;
  const dateFrom = sp.from && ISO_DATE_RX.test(sp.from) ? sp.from : null;
  const dateTo = sp.to && ISO_DATE_RX.test(sp.to) ? sp.to : null;
  const donem = dateFrom && dateTo ? null : (sp.donem ?? "").toLowerCase() || null;
  let snap: Awaited<ReturnType<typeof getWietnauerYonetim>> | null = null;
  let iskonto: IskontoSegmentsSlice | null = null;
  let err: string | null = null;
  try {
    // İki endpoint paralel — toplam latency = en yavaş tek snapshot.
    [snap, iskonto] = await Promise.all([
      getWietnauerYonetim({ dateFrom, dateTo, donem }),
      getWietnauerIskonto<IskontoSegmentsSlice>({ dateFrom, dateTo, donem }),
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
  const top10Count = snap ? Math.min(10, snap.topDistributors.length) : 0;

  // Seçili dönemin insan-okur etiketi — panel alt-başlıklarına da geçiriyoruz
  // (bkz. TopDistributorsPanel/BrandContributionPanel "Son 30 gün" yerine).
  const periodLabel = donemLabel(donem, dateFrom, dateTo);
  // Sayfa açıklaması: snapshot varsa gerçek toplamlarla, yoksa generic fallback.
  const pageDescription = snap
    ? `${tenant.displayName} portföy sağlığı ${periodLabel} verisiyle: ₺${formatCompact(toplamCiro)} net ciro, ${aktifMusteri.toLocaleString("tr-TR")} aktif müşteri; top ${top10Count} distribütör toplam cironun %${top10Pay.toFixed(1)}'ini, ${stratCount} stratejik marka ise %${stratPay.toFixed(1)}'ini taşıyor.`
    : `${tenant.displayName} portföy sağlığı tek ekranda — Top müşteri konsantrasyonu, marka katkıları ve iskonto yatırım oranı ${periodLabel} net ciro üzerinden.`;

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 01"
        title="Yönetim Kurulu"
        contentKey="page.yonetim.title"
        descKey="page.yonetim.desc"
        description={pageDescription}
        dataNote="TBLMSDFATURA + TBLMSDBELGEDETAY · DBLNETTUTAR/DBLNETFIYAT · BYTTUR=0 · BYTDURUM=0"
        generatedAt={snap?.generatedAt}
      />

      <GlobalDonemFilter />

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
            {!panelHidden("kpi.yonetim.ciro") && (
            <KpiTile
              label={cs("kpi.yonetim.ciro", "Toplam Net Ciro")}
              value={`₺${formatCompact(toplamCiro)}`}
              sub={donemLabel(donem, dateFrom, dateTo)}
            />
          )}
            {!panelHidden("kpi.yonetim.aktif") && (
            <KpiTile
              label={cs("kpi.yonetim.aktif", "Aktif Müşteri")}
              value={aktifMusteri.toLocaleString("tr-TR")}
              sub={`${toplamFatura.toLocaleString("tr-TR")} fatura`}
            />
          )}
            {!panelHidden("kpi.yonetim.konsantrasyon") && (
            <KpiTile
              label={cs("kpi.yonetim.konsantrasyon", "Top 10 Konsantrasyon")}
              value={`%${top10Pay.toFixed(1)}`}
              sub={`ilk ${top10Count} distribütörün payı`}
              tone={top10Pay > 50 ? "warn" : "neutral"}
            />
          )}
            {!panelHidden("kpi.yonetim.stratejik") && (
            <KpiTile
              label={cs("kpi.yonetim.stratejik", "Stratejik Marka Payı")}
              value={`%${stratPay.toFixed(1)}`}
              sub={`${stratCount} marka takipte`}
              tone="accent"
            />
          )}
          </div>

          {/* Üst içerik: 2 sütun (Marka katkıları + Top Distribütör) */}
          <div className="v3-content-grid">
            <BrandContributionPanel brands={snap.brands} periodLabel={periodLabel} />
            <TopDistributorsPanel distributors={snap.topDistributors} periodLabel={periodLabel} />
          </div>

          {/* Alt içerik: Segment Kırılımı — İKİ boyut ayrı ayrı:
              (1) Müşteri Grup Kırılımı (Prestige/Premium/Standart…),
              (2) Müşteri Ek Grup (TEKEL/BÜFE/MARKET/BAR… ilk 5 + Diğer). */}
          {iskonto &&
            (iskonto.segments.length > 0 || iskonto.ekGrupSegments.length > 0) && (
              <div className="v3-segment-grid">
                {iskonto.segments.length > 0 && (
                  <IskontoSegmentPanel
                    segments={iskonto.segments}
                    title="Müşteri Grup Kırılımı"
                    dimensionLabel="Müşteri grup kırılımı"
                  />
                )}
                {iskonto.ekGrupSegments.length > 0 && (
                  <IskontoSegmentPanel
                    segments={iskonto.ekGrupSegments}
                    title="Müşteri Ek Grup"
                    dimensionLabel="Müşteri ek grup (ilk 5 + Diğer)"
                  />
                )}
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
        .v3-segment-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1080px) {
          .v3-segment-grid {
            grid-template-columns: 1fr 1fr;
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
