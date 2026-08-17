import { getWietnauerStok } from "@/lib/api";
import type {
  StockRiskTier,
  WietnauerStockBrandSummary,
  WietnauerStockSkuRow,
  WietnauerStockSnapshot,
} from "@/lib/api";
import { V3PageHeader } from "@/components/v3/V3PageHeader";
import { getTenantConfig } from "@/lib/tenant";
import { formatCompact } from "@/components/komuta/format";
import { StokDistSelect } from "@/components/v3/stok/StokDistSelect";

export const metadata = { title: "Stok Tükenme · V3 · Enroute Pusula" };

type Props = {
  searchParams: Promise<{ distId?: string }>;
};

export default async function V3StokTukenmePage({ searchParams }: Props) {
  const tenant = getTenantConfig();
  const sp = await searchParams;
  const distIdParsed = sp.distId != null ? Number(sp.distId) : null;
  const distId = distIdParsed != null && Number.isFinite(distIdParsed) ? distIdParsed : null;

  let snap: WietnauerStockSnapshot | null = null;
  let err: string | null = null;

  try {
    snap = await getWietnauerStok<WietnauerStockSnapshot>({ distId });
  } catch (e) {
    err = (e as Error).message;
  }

  const criticalPlusRisk = snap
    ? snap.totals.criticalSkuCount + snap.totals.riskSkuCount
    : 0;
  const criticalShare = snap && snap.totals.activeSkuCount > 0
    ? (criticalPlusRisk / snap.totals.activeSkuCount) * 100
    : 0;
  const topRows = snap?.critical.length ? snap.critical : snap?.items.slice(0, 20) ?? [];
  const nextStockout = topRows.find((row) => row.estimatedStockoutDate)?.estimatedStockoutDate ?? null;

  return (
    <div className="v3-page">
      <V3PageHeader
        eyebrow="Dashboard 08"
        title="Stok Tükenme"
        description={
          snap?.distFilter
            ? `${snap.distFilter.distName}${snap.distFilter.region ? ` (${snap.distFilter.region})` : ""} — SKU stoklarının kaç gün yeteceğini, tahmini tükenme tarihini ve miktar bazlı 90 günlük devir hızını gösterir.`
            : `${tenant.displayName} tüm distribütörler — SKU stoklarının kaç gün yeteceğini, tahmini tükenme tarihini ve miktar bazlı 90 günlük devir hızını gösterir. Belirli bir distribütöre odaklanmak için dropdown'dan seç.`
        }
        dataNote="TBLMSDBELGEDETAY · TBLMSDFATURA · TBLMSDDEPOHAREKET · TBLURUN · TBLDIST × TBLDISTEKGRUP · LNGSTOKTIP · DBLMIKTAR"
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
          <StokDistSelect
            distributors={snap.distributors}
            selectedDistId={snap.distFilter?.distId ?? null}
          />
          <div className="stok-kpi-grid">
            <KpiTile
              label="Kritik + Risk"
              value={criticalPlusRisk.toLocaleString("tr-TR")}
              sub={
                snap.totals.lowConfidenceSkuCount > 0
                  ? `%${criticalShare.toFixed(1)} · ${snap.totals.lowConfidenceSkuCount} düşük güven`
                  : `%${criticalShare.toFixed(1)} · 0-14 gün`
              }
              tone={criticalPlusRisk > 0 ? "bad" : "good"}
            />
            <KpiTile
              label="İlk Tükenme"
              value={nextStockout ? formatDate(nextStockout) : "-"}
              sub="tahmini tarih"
              tone={nextStockout ? "bad" : "neutral"}
            />
            <KpiTile
              label="Pozitif Stok SKU"
              value={snap.totals.positiveStockSkuCount.toLocaleString("tr-TR")}
              sub={
                snap.distFilter
                  ? `${snap.totals.activeSkuCount.toLocaleString("tr-TR")} SKU içinde`
                  : `${snap.totals.activeSkuCount.toLocaleString("tr-TR")} SKU×dist içinde`
              }
            />
            {/* md39: "Yoldaki Miktar" KPI kaldırıldı. */}
            <KpiTile
              label="Devir Hesaplanan"
              value={snap.totals.turnoverComputableSkuCount.toLocaleString("tr-TR")}
              sub={`${snap.windowDays}g devir · ${snap.totals.lowConfidenceRatePct.toFixed(1)}% düşük güven`}
              tone="accent"
            />
          </div>

          <div className="stok-split">
            <StockoutTable rows={topRows} />
            <QualityPanel snap={snap} />
          </div>

          <BrandRiskTable rows={snap.brandSummary} />
        </>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-page { padding: 4px 0 24px; }
        .stok-kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        .stok-split {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          align-items: start;
          margin-bottom: 16px;
        }
        @media (min-width: 1200px) {
          .stok-split { grid-template-columns: minmax(0, 1.7fr) minmax(300px, 0.8fr); }
        }
        .stok-panel {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          overflow: hidden;
        }
        .stok-panel-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px 10px;
          border-bottom: 1px solid var(--color-border);
        }
        .stok-panel-title {
          font-size: 14px;
          font-weight: 650;
          color: var(--color-fg);
          line-height: 1.25;
        }
        .stok-panel-meta {
          font-size: 11px;
          color: var(--color-muted);
          margin-top: 3px;
          line-height: 1.45;
        }
        .stok-table-wrap { overflow-x: auto; }
        .stok-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1260px;
          font-size: 12px;
        }
        .stok-table th {
          text-align: left;
          color: var(--color-muted);
          font-size: 10.5px;
          font-weight: 650;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 9px 12px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface-2);
          white-space: nowrap;
        }
        .stok-table td {
          padding: 10px 12px;
          border-bottom: 1px solid var(--color-border);
          vertical-align: middle;
          color: var(--color-fg);
        }
        .stok-table tr:last-child td { border-bottom: 0; }
        .stok-sku {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 240px;
        }
        .stok-sku-name {
          font-weight: 600;
          line-height: 1.25;
          color: var(--color-fg);
        }
        .stok-risk-cell {
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: flex-start;
        }
        .stok-lowconf {
          display: inline-flex;
          align-items: center;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #92400e;
          background: rgba(245, 158, 11, 0.14);
          border: 1px solid rgba(245, 158, 11, 0.4);
          border-radius: 4px;
          padding: 1px 5px;
          white-space: nowrap;
          cursor: help;
        }
        .confidence {
          display: inline-flex;
          align-items: center;
          height: 18px;
          padding: 0 5px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 650;
          white-space: nowrap;
          border: 1px solid var(--color-border);
          background: var(--color-surface-2);
          color: var(--color-muted);
        }
        .confidence-high {
          color: #15803d;
          background: rgba(22, 163, 74, 0.09);
          border-color: rgba(22, 163, 74, 0.22);
        }
        .confidence-medium {
          color: #0e7490;
          background: rgba(14, 116, 144, 0.10);
          border-color: rgba(14, 116, 144, 0.24);
        }
        .confidence-low {
          color: #b45309;
          background: rgba(217, 119, 6, 0.11);
          border-color: rgba(217, 119, 6, 0.28);
        }
        :root[data-theme="dark"] .stok-lowconf {
          color: #fcd34d;
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.35);
        }
        .stok-sku-code {
          color: var(--color-muted);
          font-size: 11px;
          line-height: 1.25;
        }
        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .risk-badge {
          display: inline-flex;
          align-items: center;
          height: 22px;
          padding: 0 7px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 650;
          white-space: nowrap;
        }
        .risk-critical { background: rgba(220, 38, 38, 0.10); color: #dc2626; }
        .risk-risk { background: rgba(217, 119, 6, 0.12); color: #b45309; }
        .risk-watch { background: rgba(14, 116, 144, 0.12); color: #0e7490; }
        .risk-healthy { background: rgba(22, 163, 74, 0.11); color: #15803d; }
        .risk-unknown { background: var(--color-surface-2); color: var(--color-muted); border: 1px solid var(--color-border); }
        .quality-grid {
          display: grid;
          gap: 10px;
          padding: 14px 16px 16px;
        }
        .quality-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          padding-bottom: 9px;
          border-bottom: 1px solid var(--color-border);
        }
        .quality-row:last-child { border-bottom: 0; padding-bottom: 0; }
        .quality-label {
          font-size: 11.5px;
          color: var(--color-muted);
          line-height: 1.35;
        }
        .quality-value {
          font-size: 15px;
          font-weight: 700;
          color: var(--color-fg);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .quality-note {
          margin: 0 16px 16px;
          border: 1px solid rgba(217, 119, 6, 0.32);
          background: rgba(217, 119, 6, 0.08);
          border-radius: 8px;
          padding: 10px 11px;
          font-size: 12px;
          line-height: 1.45;
          color: var(--color-fg);
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
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "bad" | "good" | "accent";
}) {
  const color = {
    neutral: "var(--color-fg)",
    bad: "#dc2626",
    good: "#15803d",
    accent: "var(--color-accent)",
  }[tone];
  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: "var(--color-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 650,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 750,
          color,
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--color-muted-2)", lineHeight: 1.35 }}>
        {sub}
      </div>
    </div>
  );
}

function StockoutTable({ rows }: { rows: WietnauerStockSkuRow[] }) {
  return (
    <section className="stok-panel">
      <div className="stok-panel-head">
        <div>
          <div className="stok-panel-title">İlk Bitecek SKU'lar</div>
          <div className="stok-panel-meta">Risk sırası · kalan gün · tahmini tükenme</div>
        </div>
      </div>
      <div className="stok-table-wrap">
        <table className="stok-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Distribütör</th>
              <th>Marka</th>
              <th>Risk</th>
              <th className="num">Kalan</th>
              <th>Tükenme</th>
              <th className="num">Stok</th>
              {/* md39: "Yolda" kolonu kaldırıldı */}
              <th className="num">90g Satış</th>
              <th className="num">Tahmin/gün</th>
              <th className="num">Devir</th>
              <th className="num">ROP</th>
              <th className="num">Eksik</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.distId}-${row.skuId}`}>
                <td>
                  <div className="stok-sku">
                    <span className="stok-sku-name">{row.skuName}</span>
                    <span className="stok-sku-code">{row.skuCode || `#${row.skuId}`}</span>
                  </div>
                </td>
                <td>{row.distName}</td>
                <td>{row.brand ?? "-"}</td>
                <td>
                  <div className="stok-risk-cell">
                    <RiskBadge tier={row.riskTier} />
                    {row.lowConfidence && (
                      <span
                        className="stok-lowconf"
                        title={`Düşük güven: eldeki stok toplam hareketin yalnızca %${row.netSignalPct ?? "?"}'i — büyük giriş/çıkış akışının küçük farkı. Tek kaydedilmemiş giriş bu sonucu tersine çevirebilir. Fiziksel stok sayımıyla doğrulanmalı.`}
                      >
                        düşük güven
                      </span>
                    )}
                    <span className={`confidence confidence-${row.stockConfidence}`}>
                      {confidenceLabel(row.stockConfidence)} · {row.stockConfidenceScore}
                    </span>
                  </div>
                </td>
                <td className="num">{formatDays(row.daysLeft)}</td>
                <td>{row.estimatedStockoutDate ? formatDate(row.estimatedStockoutDate) : "-"}</td>
                <td className="num">{formatQty(row.onHandQty)}</td>
                {/* md39: "Yolda" kolonu kaldırıldı */}
                <td className="num">{formatQty(row.soldQty90d)}</td>
                <td className="num">
                  <span title={`Croston 180g: ${formatQty(row.crostonDailyQty)} · trend x${row.trendFactor.toFixed(2)} · mevsim x${row.seasonalityFactor.toFixed(2)}${row.seasonalityReason ? ` (${row.seasonalityReason})` : ""}`}>
                    {formatQty(row.forecastDailyQty)}
                  </span>
                </td>
                <td className="num">{row.turnover90d == null ? "-" : row.turnover90d.toFixed(2)}</td>
                <td className="num">
                  <span title={`Lead time: ${row.leadTimeDays} gün (${leadTimeSourceLabel(row.leadTimeSource)}) · emniyet stok: ${formatQty(row.safetyStockQty)}`}>
                    {formatQty(row.reorderPointQty)}
                  </span>
                </td>
                <td className="num">
                  <span title={`ROP - envanter pozisyonu. Pozisyon: stok ${formatQty(row.onHandQty)} + yolda ${formatQty(row.openOrderQty)} = ${formatQty(row.inventoryPositionQty)}`}>
                    {row.reorderGapQty > 0 ? formatQty(row.reorderGapQty) : "-"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BrandRiskTable({ rows }: { rows: WietnauerStockBrandSummary[] }) {
  return (
    <section className="stok-panel">
      <div className="stok-panel-head">
        <div>
          <div className="stok-panel-title">Marka Bazında Stok Riski</div>
          <div className="stok-panel-meta">Kritik + risk SKU yoğunluğu ve miktar özeti</div>
        </div>
      </div>
      <div className="stok-table-wrap">
        <table className="stok-table">
          <thead>
            <tr>
              <th>Marka</th>
              <th className="num">SKU</th>
              <th className="num">Kritik</th>
              <th className="num">Risk</th>
              <th className="num">İzle</th>
              <th className="num">Sağlıklı</th>
              <th className="num">Stok</th>
              <th className="num">90g Satış</th>
              <th className="num">Ort. Kalan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.brand}>
                <td>
                  <strong>{row.brand}</strong>
                </td>
                <td className="num">{row.skuCount.toLocaleString("tr-TR")}</td>
                <td className="num">{row.criticalCount.toLocaleString("tr-TR")}</td>
                <td className="num">{row.riskCount.toLocaleString("tr-TR")}</td>
                <td className="num">{row.watchCount.toLocaleString("tr-TR")}</td>
                <td className="num">{row.healthyCount.toLocaleString("tr-TR")}</td>
                <td className="num">{formatQty(row.totalOnHandQty)}</td>
                <td className="num">{formatQty(row.totalSoldQty90d)}</td>
                <td className="num">{formatDays(row.avgDaysLeft)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QualityPanel({ snap }: { snap: WietnauerStockSnapshot }) {
  return (
    <aside className="stok-panel">
      <div className="stok-panel-head">
        <div>
          <div className="stok-panel-title">Veri Güveni</div>
          <div className="stok-panel-meta">Stok türetimi ve devir hesap kalitesi</div>
        </div>
      </div>
      <div className="quality-grid">
        <QualityRow label="Stok hareket sinyali olan SKU" value={snap.quality.stockSignalSkuCount} />
        <QualityRow label="Sıfır stok görünen SKU" value={snap.quality.zeroStockSkuCount} />
        <QualityRow label="Negatif stok görünen SKU" value={snap.quality.negativeStockSkuCount} />
        <QualityRow label="Devir için güvenilmez SKU" value={snap.quality.turnoverUnreliableSkuCount} />
        <QualityRow label="Açık sipariş sinyali olan SKU" value={snap.quality.incomingOrderSkuCount} />
        <QualityRow label="Lead time tanımlı SKU" value={snap.quality.leadTimeConfiguredSkuCount} />
        <QualityRow label="90g satış görmeyen SKU" value={snap.totals.noDemandSkuCount} />
      </div>
      {snap.quality.snapshotTablesEmpty && (
        <div className="quality-note">
          Anlık stok snapshot tabloları boş olduğu için stok bakiyesi belge detay hareketlerinden türetilmiştir.
        </div>
      )}
    </aside>
  );
}

function QualityRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="quality-row">
      <span className="quality-label">{label}</span>
      <span className="quality-value">{value.toLocaleString("tr-TR")}</span>
    </div>
  );
}

function RiskBadge({ tier }: { tier: StockRiskTier }) {
  const labels: Record<StockRiskTier, string> = {
    critical: "Kritik",
    risk: "Risk",
    watch: "İzle",
    healthy: "Sağlıklı",
    unknown: "Belirsiz",
  };
  return <span className={`risk-badge risk-${tier}`}>{labels[tier]}</span>;
}

function confidenceLabel(value: WietnauerStockSkuRow["stockConfidence"]): string {
  return {
    high: "yüksek",
    medium: "orta",
    low: "düşük",
  }[value];
}

function leadTimeSourceLabel(value: WietnauerStockSkuRow["leadTimeSource"]): string {
  return value === "dist-table" ? "distribütör tanımı" : "varsayılan";
}

function formatDays(days: number | null): string {
  if (days == null || !Number.isFinite(days)) return "-";
  if (days < 1) return "<1 gün";
  return `${days < 10 ? days.toFixed(1) : Math.round(days).toLocaleString("tr-TR")} gün`;
}

function formatQty(value: number): string {
  if (Math.abs(value) >= 10000) return formatCompact(value);
  return value.toLocaleString("tr-TR", {
    maximumFractionDigits: value === Math.trunc(value) ? 0 : 1,
  });
}

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
  });
}
