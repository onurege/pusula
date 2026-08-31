import { formatCompact } from "@/components/komuta/format";
import type { ActiveCustomers90d } from "./types";

/**
 * Panel A — 90g Aktif Müşteri sayısı + segment kırılımı.
 *
 * KPI hero (toplam aktif + önceki döneme göre değişim) + altta segment
 * dağılımı yatay bar. Segment etiketleri TBLEKSAHASECENEK üzerinden
 * (Perakende / On Trade / Otel / Tali Bayi / Tanımsız) gelir.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function ActiveCustomersPanel({ data }: { data: ActiveCustomers90d }) {
  if (panelHidden("panel.risk.active")) return null;
  const change = data.degisimPct;
  const changeTone =
    change > 2 ? "good" : change < -2 ? "bad" : "neutral";
  const changeColor =
    changeTone === "good"
      ? "#16a34a"
      : changeTone === "bad"
        ? "#dc2626"
        : "var(--color-muted)";
  const changeSign = change > 0 ? "+" : "";
  const segments = data.segments.slice(0, 8); // ilk 8 segment yeter
  const maxSayi = Math.max(1, ...segments.map((s) => s.musteriSayi));

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.risk.active", "90 Gün Aktif Müşteri")}</div>
          <div className="v3-panel-sub">
            Son 90 gün içinde en az 1 fatura kesilmiş distinct müşteri ·
            önceki 90 güne göre {""}
            <strong style={{ color: changeColor }}>
              {changeSign}
              {change.toFixed(1)}%
            </strong>
          </div>
        </div>
      </div>

      <div className="act-hero">
        <div className="act-hero-val">
          {data.toplam.toLocaleString("tr-TR")}
        </div>
        <div className="act-hero-sub">
          aktif müşteri (önceki dönem:{" "}
          {data.oncekiToplam.toLocaleString("tr-TR")})
        </div>
      </div>

      <div className="seg-list">
        <div className="seg-title">Segment Kırılımı</div>
        {segments.length === 0 && (
          <div className="seg-empty">Segment verisi bulunamadı.</div>
        )}
        {segments.map((s) => (
          <div key={s.segment} className="seg-row">
            <div className="seg-label" title={s.segment}>
              {s.segment}
            </div>
            <div className="seg-track">
              <div
                className="seg-fill"
                style={{ width: `${(s.musteriSayi / maxSayi) * 100}%` }}
              />
            </div>
            <div className="seg-meta">
              <span className="seg-val">
                {formatCompact(s.musteriSayi)}
              </span>
              <span className="seg-pct">%{s.payPct.toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .act-hero {
          background: var(--color-surface-2, rgba(0,0,0,0.02));
          border-radius: 10px;
          padding: 16px 18px;
          margin-bottom: 14px;
        }
        .act-hero-val {
          font-size: 36px;
          font-weight: 700;
          color: var(--color-fg);
          letter-spacing: -0.025em;
          font-variant-numeric: tabular-nums;
          line-height: 1.05;
        }
        .act-hero-sub {
          font-size: 12px;
          color: var(--color-muted);
          margin-top: 4px;
        }
        .seg-list { display: flex; flex-direction: column; gap: 6px; }
        .seg-title {
          font-size: 10.5px; font-weight: 600; color: var(--color-muted);
          letter-spacing: 0.05em; text-transform: uppercase;
          margin-bottom: 4px;
        }
        .seg-empty {
          font-size: 12px; color: var(--color-muted-2); padding: 8px 0;
        }
        .seg-row {
          display: grid;
          grid-template-columns: minmax(120px, 1fr) 2fr auto;
          align-items: center;
          gap: 12px;
          font-size: 12.5px;
        }
        .seg-label {
          color: var(--color-fg);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .seg-track {
          height: 8px;
          background: var(--color-border);
          border-radius: 4px;
          overflow: hidden;
        }
        .seg-fill {
          height: 100%;
          background: var(--color-accent);
          border-radius: 4px;
        }
        .seg-meta {
          display: flex;
          gap: 8px;
          font-variant-numeric: tabular-nums;
          color: var(--color-muted);
        }
        .seg-val { color: var(--color-fg); font-weight: 600; }
      `,
        }}
      />
    </div>
  );
}
