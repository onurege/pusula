import { formatCompact } from "@/components/komuta/format";

/**
 * Panel B — Aylık İskonto Trendi.
 *
 * Son 12 ay × {iskonto toplamı (bar), iskonto oranı % (line overlay)}.
 * Tek SVG; iki eksen — sol: tutar (bar), sağ: % (line).
 */
export function IskontoMonthlyTrendPanel({
  points,
}: {
  points: ReadonlyArray<{
    yyyymm: string;
    ay: string;
    iskonto: number;
    iskontoOraniPct: number;
  }>;
}) {
  if (points.length === 0) {
    return (
      <div className="trend-panel">
        <div className="trend-head">
          <div className="trend-title">Aylık İskonto Trendi</div>
          <div className="trend-sub">Veri yok</div>
        </div>
      </div>
    );
  }

  const W = 720;
  const H = 240;
  const padL = 56;
  const padR = 50;
  const padT = 20;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxIsk = Math.max(1, ...points.map((p) => p.iskonto));
  const maxOran = Math.max(1, ...points.map((p) => p.iskontoOraniPct));
  const oranScale = Math.max(30, Math.ceil(maxOran / 5) * 5); // 30/35/40… üst sınır

  const slot = innerW / points.length;
  const barW = Math.max(8, slot * 0.55);

  // Line path
  const lineCoords = points.map((p, i) => {
    const cx = padL + i * slot + slot / 2;
    const cy = padT + innerH - (p.iskontoOraniPct / oranScale) * innerH;
    return [cx, cy] as const;
  });
  const linePath = lineCoords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  // Tier color for line points
  const tierColor = (oran: number) =>
    oran < 15 ? "#16a34a" : oran < 25 ? "#d97706" : "#dc2626";

  // Y-axis ticks (sol — iskonto): 4 tick
  const leftTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: padT + innerH - t * innerH,
    label: formatCompact(maxIsk * t),
  }));
  // Y-axis ticks (sağ — %): 4 tick
  const rightTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: padT + innerH - t * innerH,
    label: `%${(oranScale * t).toFixed(0)}`,
  }));

  return (
    <div className="trend-panel">
      <div className="trend-head">
        <div>
          <div className="trend-title">Aylık İskonto Trendi</div>
          <div className="trend-sub">
            Son 12 ay · İskonto tutarı (bar) ve iskonto/ciro oranı (çizgi)
          </div>
        </div>
        <div className="trend-legend">
          <span className="lg-bar" /> iskonto tutarı
          <span className="lg-line" /> oran %
        </div>
      </div>

      <div className="trend-svg-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
          {/* Grid */}
          {leftTicks.map((t, i) => (
            <line
              key={`grid-${i}`}
              x1={padL}
              x2={W - padR}
              y1={t.y}
              y2={t.y}
              stroke="var(--color-border)"
              strokeDasharray="2 3"
              opacity={i === 0 ? 0.8 : 0.4}
            />
          ))}

          {/* Sol eksen — tutar */}
          {leftTicks.map((t, i) => (
            <text
              key={`lt-${i}`}
              x={padL - 8}
              y={t.y + 4}
              textAnchor="end"
              fontSize="10"
              fill="var(--color-muted-2)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              ₺{t.label}
            </text>
          ))}

          {/* Sağ eksen — % */}
          {rightTicks.map((t, i) => (
            <text
              key={`rt-${i}`}
              x={W - padR + 8}
              y={t.y + 4}
              textAnchor="start"
              fontSize="10"
              fill="var(--color-muted-2)"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t.label}
            </text>
          ))}

          {/* Bars */}
          {points.map((p, i) => {
            const cx = padL + i * slot + slot / 2;
            const h = (p.iskonto / maxIsk) * innerH;
            const y = padT + innerH - h;
            return (
              <g key={p.yyyymm}>
                <rect
                  x={cx - barW / 2}
                  y={y}
                  width={barW}
                  height={Math.max(1, h)}
                  fill="var(--color-muted-2)"
                  opacity="0.55"
                  rx="2"
                />
                <text
                  x={cx}
                  y={H - padB + 16}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--color-muted-2)"
                >
                  {p.ay}
                </text>
              </g>
            );
          })}

          {/* Line overlay */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {lineCoords.map(([x, y], i) => (
            <circle
              key={`pt-${i}`}
              cx={x}
              cy={y}
              r="3.5"
              fill={tierColor(points[i]?.iskontoOraniPct ?? 0)}
              stroke="var(--color-surface)"
              strokeWidth="1.5"
            />
          ))}
        </svg>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .trend-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .trend-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
        .trend-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .trend-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .trend-legend { font-size: 11px; color: var(--color-muted); display: inline-flex; align-items: center; gap: 8px; }
        .trend-legend .lg-bar { display: inline-block; width: 12px; height: 8px; background: var(--color-muted-2); opacity: 0.55; border-radius: 2px; margin-left: 4px; }
        .trend-legend .lg-line { display: inline-block; width: 14px; height: 2px; background: var(--color-accent); margin-left: 8px; vertical-align: middle; }
        .trend-svg-wrap { width: 100%; overflow-x: auto; }
        .trend-svg-wrap svg { width: 100%; min-width: 480px; height: auto; }
      `,
        }}
      />
    </div>
  );
}
