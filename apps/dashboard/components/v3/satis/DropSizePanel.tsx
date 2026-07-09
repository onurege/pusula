import type { DropSizeRow } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";

/**
 * Drop Size paneli — distribütör başına distinct müşteri × ortalama ciro
 * (nokta başına ciro). "Az müşteri ile çok ciro" hangi distribütör?
 *
 * Yatay bar chart: drop size DESC. Backend en az 5 distinct müşterisi
 * olan distribütörleri filtreliyor (tek müşterilik büyük cirolar listeyi
 * yanıltmasın diye).
 */
export function DropSizePanel({ rows }: { rows: DropSizeRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="v3-panel v3-panel-empty">
        <div className="v3-panel-title">Drop Size (Nokta Başına Ciro)</div>
        <p>Yeterli müşteri tabanlı distribütör bulunamadı (≥5 müşteri).</p>
      </div>
    );
  }

  const maxDrop = Math.max(1, ...rows.map((r) => r.dropSize));

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Drop Size (Nokta Başına Ciro)</div>
          <div className="v3-panel-sub">
            Son 30g · ciro / distinct müşteri · Top {rows.length} ·
            <span className="hint"> en az 5 müşterisi olan distribütörler</span>
          </div>
        </div>
      </div>

      <div className="v3-bars">
        {rows.map((r) => (
          <div key={r.id} className="bar-row">
            <div className="bar-label" title={r.ad}>
              <span className="bar-rank">#{r.rank}</span>
              <span className="bar-name">{r.ad}</span>
              {r.region && <span className="bar-region">{r.region}</span>}
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${(r.dropSize / maxDrop) * 100}%` }}
              />
            </div>
            <div className="bar-meta">
              <span className="bar-val">₺{formatCompact(r.dropSize)}</span>
              <span className="bar-cust">
                {r.musteriSayi.toLocaleString("tr-TR")} müşteri
              </span>
            </div>
          </div>
        ))}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-empty p { font-size: 12.5px; color: var(--color-muted); margin: 8px 0 0; }
        .v3-panel-head { margin-bottom: 14px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .v3-panel-sub .hint { color: var(--color-muted-2); }
        .v3-bars { display: flex; flex-direction: column; gap: 5px; }
        .bar-row { display: grid; grid-template-columns: 220px 1fr 200px; align-items: center; gap: 12px; padding: 6px 0; font-size: 12.5px; }
        .bar-row:hover { background: var(--color-surface-2); margin: 0 -8px; padding: 6px 8px; border-radius: 6px; }
        .bar-label { display: inline-flex; align-items: center; gap: 6px; overflow: hidden; }
        .bar-rank { font-size: 10.5px; color: var(--color-muted-2); font-variant-numeric: tabular-nums; font-weight: 500; min-width: 22px; }
        .bar-name { font-weight: 500; color: var(--color-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
        .bar-region { font-size: 10.5px; color: var(--color-muted-2); white-space: nowrap; }
        .bar-track { height: 18px; background: var(--color-surface-2); border-radius: 4px; overflow: hidden; position: relative; }
        .bar-fill { height: 100%; background: var(--color-accent); border-radius: 4px; opacity: 0.65; transition: width 0.3s ease-out; }
        .bar-meta { display: inline-flex; align-items: baseline; justify-content: flex-end; gap: 10px; font-variant-numeric: tabular-nums; }
        .bar-val { color: var(--color-fg); font-weight: 600; min-width: 80px; text-align: right; }
        .bar-cust { color: var(--color-muted); font-size: 11.5px; min-width: 80px; text-align: right; }
      `,
        }}
      />
    </div>
  );
}
