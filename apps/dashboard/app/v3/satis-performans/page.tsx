import { getWietnauerSatis } from "@/lib/api";
import type { WietnauerSatisSnapshot } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { DistLeaderboardPanel } from "@/components/v3/satis/DistLeaderboardPanel";
import { RepLeaderboardPanel } from "@/components/v3/satis/RepLeaderboardPanel";
import { DropSizePanel } from "@/components/v3/satis/DropSizePanel";
import { NewCustomersPanel } from "@/components/v3/satis/NewCustomersPanel";
import { AvgOrderTrendPanel } from "@/components/v3/satis/AvgOrderTrendPanel";
import { formatCompact } from "@/components/komuta/format";

export const metadata = { title: "Satış Performansı · V3 · Enroute Pusula" };

/**
 * V3 Dashboard #2 — Satış Performansı.
 *
 * Wietnauer talebi (HEDEF GERÇEKLEŞMESİ HARİÇ — kullanıcı kararı):
 *   A) Distribütör leaderboard (ciro + delta)
 *   B) Satış temsilcisi leaderboard (ciro + delta)
 *   C) Drop Size — nokta başına ortalama ciro
 *   D) Yeni müşteri kazanımı (son 90g ilk fatura)
 *   E) Ortalama sipariş büyüklüğü trendi (son 12 ay)
 *
 * Server component: snapshot SSR'da çekiliyor, panel'ler salt-okunur — sadece
 * Top Müşteri ve toggle gibi etkileşimler için "use client" gerekir; bu sayfada
 * öyle bir gereksinim yok.
 */
export default async function V3SatisPerformansPage() {
  const tenant = getTenantConfig();
  let snap: WietnauerSatisSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerSatis<WietnauerSatisSnapshot>();
  } catch (e) {
    err = (e as Error).message;
  }

  // Üst şerit KPI türevleri — leaderboard'tan kestirme toplamlar.
  const topDistCiro =
    snap?.distLeaderboard.reduce((a, d) => a + d.ciro, 0) ?? 0;
  const topDistCount = snap?.distLeaderboard.length ?? 0;
  const topRepCount = snap?.repLeaderboard.length ?? 0;
  const avgOrderLatest =
    snap && snap.avgOrderTrend.length > 0
      ? snap.avgOrderTrend[snap.avgOrderTrend.length - 1]?.ortSepet ?? 0
      : 0;

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 02"
        title="Satış Performansı"
        description={`${tenant.displayName} distribütör ve saha satış temsilcisi performansı tek ekranda — leaderboard, drop size, yeni müşteri kazanımı ve ortalama sepet trendi.`}
        dataNote="TBLMSDFATURA + TBLDISTPERSONEL + TBLDIST + TBLDISTEKGRUP · BYTTUR=0 · BYTDURUM=0"
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
          {/* Üst şerit: 4 KPI özet kartı */}
          <div className="v3-kpi-grid">
            <KpiTile
              label="Top Distribütör Cirosu"
              value={`₺${formatCompact(topDistCiro)}`}
              sub={`son 30g · ilk ${topDistCount} distribütör`}
            />
            <KpiTile
              label="Top Temsilci Sayısı"
              value={topRepCount.toLocaleString("tr-TR")}
              sub="son 30g performans listesinde"
            />
            <KpiTile
              label="Yeni Müşteri (90g)"
              value={snap.newCustomers.totalYeniMusteri.toLocaleString("tr-TR")}
              sub={`₺${formatCompact(snap.newCustomers.totalYeniCiro)} ciro`}
              tone="accent"
            />
            <KpiTile
              label="Güncel Ort. Sepet"
              value={`₺${formatCompact(avgOrderLatest)}`}
              sub="son ay · AVG net/fatura"
            />
          </div>

          {/* Asıl içerik: leaderboard'lar üstte (full width), altta drop+yeni,
              en altta trend grafiği. */}
          <div className="v3-content-stack">
            <DistLeaderboardPanel rows={snap.distLeaderboard} />
            <RepLeaderboardPanel rows={snap.repLeaderboard} />

            <div className="v3-row-2col">
              <DropSizePanel rows={snap.dropSize} />
              <NewCustomersPanel
                items={snap.newCustomers.items}
                totalYeniMusteri={snap.newCustomers.totalYeniMusteri}
                totalYeniCiro={snap.newCustomers.totalYeniCiro}
              />
            </div>

            <AvgOrderTrendPanel points={snap.avgOrderTrend} />
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
        .v3-content-stack {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .v3-row-2col {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 1080px) {
          .v3-row-2col {
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
      <div style={{ fontSize: 11, color: "var(--color-muted-2)" }}>{sub}</div>
    </div>
  );
}
