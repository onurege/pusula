import { getWietnauerSaha } from "@/lib/api";
import type { WietnauerSahaSnapshot } from "@/lib/api";
import { getTenantConfig } from "@/lib/tenant";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { VisitDailyTrendPanel } from "@/components/v3/saha/VisitDailyTrendPanel";
import { CoveragePanel } from "@/components/v3/saha/CoveragePanel";
import { RepPerformancePanel } from "@/components/v3/saha/RepPerformancePanel";
import { VisitConversionPanel } from "@/components/v3/saha/VisitConversionPanel";
import { DistributorComparisonPanel } from "@/components/v3/saha/DistributorComparisonPanel";
import { formatCompact } from "@/components/komuta/format";

export const metadata = { title: "Saha Operasyon · V3 · Insider" };

/**
 * V3 Dashboard #5 — Distribütör & Saha Operasyon.
 *
 *   A) Günlük ziyaret trendi (rut içi vs rut dışı, son 30g) + 7g KPI
 *   B) Aktif müşteri kapsama oranı + segment kırılımı
 *   C) Temsilci performansı (Top 20)
 *   D) Rut içi/dışı ziyaret → sipariş dönüşümü
 *   E) Distribütör karşılaştırma (Top 10)
 */
export default async function V3SahaOperasyonPage() {
  const tenant = getTenantConfig();
  let snap: WietnauerSahaSnapshot | null = null;
  let err: string | null = null;
  try {
    snap = await getWietnauerSaha();
  } catch (e) {
    err = (e as Error).message;
  }

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 05"
        title="Distribütör & Saha Operasyon"
        description={`${tenant.displayName} sahasının günlük ziyaret temposu, müşteri kapsama oranı, temsilci performansı ve sipariş dönüşüm verimliliği — operasyonel ekiplerin tek görünümü.`}
        dataNote="TBLPMPZIYARETBASLIK + TBLPMPZIYARETOZET + TBLPMPZIYARETDETAY · TBLKULLANICI · 30g pencere"
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
          {/* Üst şerit: 7-günlük KPI özet */}
          <div className="v3-kpi-grid">
            <KpiTile
              label="Son 7g Ziyaret"
              value={formatCompact(snap.kpi.son7gZiyaret)}
              sub="toplam (rut içi + rut dışı)"
            />
            <KpiTile
              label="Unique Müşteri"
              value={snap.kpi.son7gUniqueMusteri.toLocaleString("tr-TR")}
              sub="son 7g'de en az 1 ziyaret"
            />
            <KpiTile
              label="Aktif Temsilci"
              value={snap.kpi.son7gAktifTemsilci.toLocaleString("tr-TR")}
              sub="son 7g'de en az 1 ziyaret yapan"
            />
            <KpiTile
              label="Dönüşüm Oranı"
              value={`%${snap.kpi.son7gDonusumPct.toFixed(1)}`}
              sub="son 7g · sipariş / ziyaret"
              tone={
                snap.kpi.son7gDonusumPct >= 70
                  ? "good"
                  : snap.kpi.son7gDonusumPct < 40
                    ? "warn"
                    : "neutral"
              }
            />
          </div>

          {/* Asıl içerik: 2 sütun */}
          <div className="v3-content-grid">
            <div className="col-main">
              <VisitDailyTrendPanel rows={snap.visitDaily} kpi={snap.kpi} />
              <RepPerformancePanel rows={snap.reps} />
              <DistributorComparisonPanel rows={snap.distributors} />
            </div>
            <div className="col-side">
              <CoveragePanel coverage={snap.coverage} />
              <VisitConversionPanel rows={snap.conversion} />
            </div>
          </div>
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .v3-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
        .v3-content-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
        @media (min-width: 1080px) { .v3-content-grid { grid-template-columns: 1.6fr 1fr; align-items: start; } }
        .col-main, .col-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .v3-error { background: var(--color-bad-bg, rgba(220,38,38,0.05)); border: 1px solid var(--color-bad, #dc2626); border-radius: 8px; padding: 14px 16px; margin-bottom: 20px; font-size: 13px; color: var(--color-fg); }
        .v3-error-hint { margin-top: 4px; font-size: 12px; color: var(--color-muted); }
        /* Ortak v3-panel/v3-table iskeleti — saha alt panelleri buradan miras alır */
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .v3-table-wrap { overflow-x: auto; margin: 0 -4px; }
        .v3-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .v3-table thead th { text-align: left; padding: 8px 10px; font-size: 10.5px; font-weight: 600; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid var(--color-border); white-space: nowrap; }
        .v3-table thead th.num { text-align: right; }
        .v3-table tbody tr { border-bottom: 1px solid var(--color-border); }
        .v3-table tbody tr:hover { background: var(--color-surface-2, rgba(0,0,0,0.02)); }
        .v3-table td { padding: 9px 10px; color: var(--color-fg); vertical-align: middle; }
        .v3-table td.rank { font-weight: 600; color: var(--color-muted); font-variant-numeric: tabular-nums; width: 30px; }
        .v3-table td.unvan { font-weight: 500; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .v3-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
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
  tone?: "neutral" | "warn" | "accent" | "good";
}) {
  const color =
    tone === "warn"
      ? "var(--color-bad, #dc2626)"
      : tone === "accent"
        ? "var(--color-accent)"
        : tone === "good"
          ? "var(--color-good, #16a34a)"
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
