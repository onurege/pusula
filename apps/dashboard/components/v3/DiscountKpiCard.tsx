import type { WietnauerDiscountKpi } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";

/**
 * İskonto KPI kartı — Yönetim Kurulu dashboard'unun finansal sağlık metriği.
 * Brüt → İskonto → Net akışını ve net oranı tek bakışta gösterir. Faz D
 * (Ticari Yatırım Dashboard'u #7) ileride detay kırılım sunar; bu kart ön
 * tarafta CFO-vari özet.
 *
 * Renk kodları:
 *   <15%  → yeşil (sağlıklı)
 *   15-25% → nötr (sektör ortalama)
 *   >25%   → kırmızı (aşırı yatırım uyarısı)
 */
export function DiscountKpiCard({ kpi }: { kpi: WietnauerDiscountKpi }) {
  const o = kpi.iskontoOraniPct;
  const tone =
    o < 15 ? "good" : o < 25 ? "neutral" : "warn";
  const toneColor =
    tone === "good" ? "#16a34a" : tone === "warn" ? "#dc2626" : "#78716c";
  const toneText =
    tone === "good"
      ? "sağlıklı"
      : tone === "warn"
      ? "yüksek — incele"
      : "sektör ortalaması";

  return (
    <div className="v3-dcard">
      <div className="head">
        <div className="title">İskonto Yatırımı</div>
        <div className="sub">Son 30g · Fatura başlığı bazlı</div>
      </div>

      <div className="hero">
        <span className="hero-val" style={{ color: toneColor }}>
          %{o.toFixed(1)}
        </span>
        <span className="hero-label" style={{ color: toneColor }}>
          {toneText}
        </span>
      </div>

      <div className="flow">
        <div className="flow-row">
          <span className="flow-label">Brüt ciro</span>
          <span className="flow-val">₺{formatCompact(kpi.brut)}</span>
        </div>
        <div className="flow-row neg">
          <span className="flow-label">− İskonto</span>
          <span className="flow-val">₺{formatCompact(kpi.iskonto)}</span>
        </div>
        <div className="flow-row total">
          <span className="flow-label">Net ciro</span>
          <span className="flow-val">₺{formatCompact(kpi.net)}</span>
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-dcard { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; height: 100%; }
        .v3-dcard .head { display: flex; flex-direction: column; }
        .v3-dcard .title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-dcard .sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .v3-dcard .hero { display: flex; flex-direction: column; padding: 4px 0 8px; }
        .v3-dcard .hero-val { font-size: 42px; font-weight: 700; letter-spacing: -0.025em; line-height: 1; font-variant-numeric: tabular-nums; }
        .v3-dcard .hero-label { font-size: 12px; font-weight: 500; margin-top: 4px; letter-spacing: 0.02em; }
        .v3-dcard .flow { display: flex; flex-direction: column; gap: 4px; padding-top: 10px; border-top: 1px solid var(--color-border); }
        .v3-dcard .flow-row { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; padding: 3px 0; }
        .v3-dcard .flow-label { color: var(--color-muted); }
        .v3-dcard .flow-val { font-variant-numeric: tabular-nums; color: var(--color-fg); font-weight: 500; }
        .v3-dcard .flow-row.neg .flow-val { color: var(--color-fg-2); }
        .v3-dcard .flow-row.total { border-top: 1px dashed var(--color-border); margin-top: 4px; padding-top: 8px; }
        .v3-dcard .flow-row.total .flow-label, .v3-dcard .flow-row.total .flow-val { color: var(--color-fg); font-weight: 600; }
      `,
        }}
      />
    </div>
  );
}
