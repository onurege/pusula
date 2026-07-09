import { RISK_TIER_COLORS, RISK_TIER_LABELS } from "./types";
import type { RiskTierBucket } from "./types";

/**
 * Panel D — Risk Tier Dağılımı.
 *
 * SQLite map_customers.risk_tier_v2 üzerinden GROUP BY. Donut görselleştirme
 * + her tier için müşteri sayısı + %. SVG donut tek-pass arc'larla çizilir
 * (recharts dependency'siz, server-renderable).
 */
export function RiskTierPanel({ buckets }: { buckets: RiskTierBucket[] }) {
  // Tier display sırası — kötüden iyiye
  const order = ["critical", "risk", "watch", "healthy", "unknown"];
  const sorted = [...buckets].sort(
    (a, b) => order.indexOf(a.tier) - order.indexOf(b.tier),
  );
  const toplam = sorted.reduce((a, b) => a + b.musteriSayi, 0);

  // SVG donut geometri — viewBox 0 0 120 120, cx=60 cy=60 r=44, stroke 16
  const r = 44;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const arcs = sorted.map((bucket) => {
    const len = toplam > 0 ? (bucket.musteriSayi / toplam) * c : 0;
    const offset = c - acc;
    acc += len;
    return {
      ...bucket,
      dasharray: `${len} ${c - len}`,
      dashoffset: offset,
    };
  });

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">Risk Tier Dağılımı</div>
          <div className="v3-panel-sub">
            map_customers.risk_tier_v2 · {toplam.toLocaleString("tr-TR")} müşteri
          </div>
        </div>
      </div>

      {toplam === 0 ? (
        <div className="rt-empty">
          Risk skorları henüz hesaplanmamış. SQLite mirror'ın senkronize
          edilmesi gerekiyor.
        </div>
      ) : (
        <div className="rt-wrap">
          <div className="rt-donut">
            <svg viewBox="0 0 120 120" width="160" height="160">
              <circle
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="16"
              />
              {arcs.map((a) => (
                <circle
                  key={a.tier}
                  cx="60"
                  cy="60"
                  r={r}
                  fill="none"
                  stroke={RISK_TIER_COLORS[a.tier] ?? "#ccc"}
                  strokeWidth="16"
                  strokeDasharray={a.dasharray}
                  strokeDashoffset={a.dashoffset}
                  transform="rotate(-90 60 60)"
                />
              ))}
              <text
                x="60"
                y="58"
                textAnchor="middle"
                fontSize="18"
                fontWeight="700"
                fill="var(--color-fg)"
              >
                {toplam.toLocaleString("tr-TR")}
              </text>
              <text
                x="60"
                y="74"
                textAnchor="middle"
                fontSize="9"
                fill="var(--color-muted)"
              >
                müşteri
              </text>
            </svg>
          </div>
          <div className="rt-legend">
            {sorted.map((b) => (
              <div key={b.tier} className="rt-row">
                <span
                  className="rt-dot"
                  style={{ background: RISK_TIER_COLORS[b.tier] ?? "#ccc" }}
                />
                <span className="rt-label">
                  {RISK_TIER_LABELS[b.tier] ?? b.tier}
                </span>
                <span className="rt-sayi">
                  {b.musteriSayi.toLocaleString("tr-TR")}
                </span>
                <span className="rt-pct">%{b.payPct.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .rt-empty {
          font-size: 12.5px; color: var(--color-muted); padding: 16px 0;
        }
        .rt-wrap {
          display: flex; gap: 20px; align-items: center; flex-wrap: wrap;
        }
        .rt-donut { flex-shrink: 0; }
        .rt-legend {
          display: flex; flex-direction: column; gap: 8px;
          flex: 1; min-width: 180px;
        }
        .rt-row {
          display: grid;
          grid-template-columns: 12px 1fr auto auto;
          align-items: center;
          gap: 10px;
          font-size: 12.5px;
          padding: 4px 0;
          border-bottom: 1px dashed var(--color-border);
        }
        .rt-row:last-child { border-bottom: none; }
        .rt-dot { width: 10px; height: 10px; border-radius: 50%; }
        .rt-label { color: var(--color-fg); }
        .rt-sayi {
          color: var(--color-fg); font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .rt-pct {
          color: var(--color-muted); font-size: 11px;
          font-variant-numeric: tabular-nums;
          min-width: 42px; text-align: right;
        }
      `,
        }}
      />
    </div>
  );
}
