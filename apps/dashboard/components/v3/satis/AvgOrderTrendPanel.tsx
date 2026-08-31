import type { AvgOrderTrendPoint } from "@/lib/api";
import { formatCompact } from "@/components/komuta/format";

/**
 * Ortalama Sipariş Büyüklüğü Trendi — son 12 ay × AVG(DBLNETTUTAR).
 *
 * Server-side SVG line chart — Recharts/external bağımlılığa gerek yok.
 * Trend okuma: son 3 ay'ın ortalaması ile önceki 3 ay arası fark hero
 * etiketinde gösterilir.
 */
import { panelTitle, panelHidden } from "@/lib/content";

export function AvgOrderTrendPanel({ points }: { points: AvgOrderTrendPoint[] }) {
  if (panelHidden("panel.satis.avg")) return null;
  if (points.length === 0) {
    return (
      <div className="v3-panel v3-panel-empty">
        <div className="v3-panel-title">{panelTitle("panel.satis.avg", "Ortalama Sipariş Büyüklüğü Trendi")}</div>
        <p>Son 12 ayda fatura kaydı bulunamadı.</p>
      </div>
    );
  }

  const W = 720;
  const H = 220;
  const padL = 56;
  const padR = 18;
  const padT = 18;
  const padB = 30;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const values = points.map((p) => p.ortSepet);
  const maxV = Math.max(...values, 1);
  const minV = Math.min(...values, 0);
  const range = maxV - minV || 1;

  const xAt = (i: number) =>
    points.length === 1
      ? padL + innerW / 2
      : padL + (i / (points.length - 1)) * innerW;
  const yAt = (v: number) =>
    padT + innerH - ((v - minV) / range) * innerH;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.ortSepet).toFixed(1)}`)
    .join(" ");
  const areaD =
    pathD +
    ` L ${xAt(points.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)}` +
    ` L ${xAt(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  // Trend okuma: son 3 ay vs önceki 3 ay
  const recent =
    points.length >= 6
      ? points.slice(-3).reduce((a, p) => a + p.ortSepet, 0) / 3
      : null;
  const prev =
    points.length >= 6
      ? points.slice(-6, -3).reduce((a, p) => a + p.ortSepet, 0) / 3
      : null;
  const trendPct =
    recent !== null && prev !== null && prev > 0
      ? ((recent - prev) / prev) * 100
      : null;
  const trendColor =
    trendPct === null
      ? "var(--color-muted-2)"
      : trendPct > 0
        ? "#16a34a"
        : trendPct < 0
          ? "#dc2626"
          : "var(--color-muted)";

  // Y ekseni için 4 referans noktası (eşit aralık)
  const yTicks = [0, 0.33, 0.66, 1].map((t) => ({
    v: minV + t * range,
    y: padT + innerH - t * innerH,
  }));

  // Ay etiketi okunabilirliği için ay sayısı 6'dan fazlaysa her ikincisini gizle.
  const showLabel = (i: number) =>
    points.length <= 6 || i % 2 === 0 || i === points.length - 1;

  return (
    <div className="v3-panel">
      <div className="v3-panel-head">
        <div>
          <div className="v3-panel-title">{panelTitle("panel.satis.avg", "Ortalama Sipariş Büyüklüğü Trendi")}</div>
          <div className="v3-panel-sub">
            Son {points.length} ay · AVG(net ciro) / fatura
            {trendPct !== null && (
              <>
                {" "}
                · son 3 ay vs önceki 3 ay{" "}
                <strong style={{ color: trendColor }}>
                  {trendPct > 0 ? "▲" : trendPct < 0 ? "▼" : "▬"}{" "}
                  %{Math.abs(trendPct).toFixed(1)}
                </strong>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Aylık ortalama sipariş büyüklüğü trend grafiği"
        >
          {/* Y ekseni grid */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={padL}
                x2={W - padR}
                y1={t.y}
                y2={t.y}
                stroke="var(--color-border)"
                strokeDasharray="2 3"
                strokeWidth={1}
              />
              <text
                x={padL - 8}
                y={t.y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-muted-2)"
                fontFamily="inherit"
              >
                ₺{formatCompact(t.v)}
              </text>
            </g>
          ))}

          {/* Alan dolgu */}
          <path d={areaD} fill="var(--color-accent)" opacity={0.12} />

          {/* Çizgi */}
          <path
            d={pathD}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Noktalar + ay etiketleri */}
          {points.map((p, i) => (
            <g key={p.ay}>
              {/* SVG <title> kaldırıldı — Bitdefender gibi browser
                  extension'lar SVG title node'u striprayıp hydration
                  mismatch yaratıyordu. Tooltip ihtiyacı varsa parent
                  <g> üzerine native <span> tooltip layer ile sonradan
                  eklenir. */}
              <circle
                cx={xAt(i)}
                cy={yAt(p.ortSepet)}
                r={3}
                fill="var(--color-surface)"
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                aria-label={`${p.ay}: ort sepet ${formatCompact(p.ortSepet)} TL, ${p.faturaSayi} fatura`}
              />
              {showLabel(i) && (
                <text
                  x={xAt(i)}
                  y={H - padB + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-muted)"
                  fontFamily="inherit"
                >
                  {formatAyLabel(p.ay)}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .v3-panel { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; padding: 18px 20px; }
        .v3-panel-empty p { font-size: 12.5px; color: var(--color-muted); margin: 8px 0 0; }
        .v3-panel-head { margin-bottom: 12px; }
        .v3-panel-title { font-size: 15px; font-weight: 600; color: var(--color-fg); letter-spacing: -0.01em; }
        .v3-panel-sub { font-size: 12px; color: var(--color-muted); margin-top: 2px; }
        .chart-wrap { width: 100%; overflow-x: auto; }
        .chart-wrap svg { width: 100%; height: auto; min-width: 480px; display: block; }
      `,
        }}
      />
    </div>
  );
}

/** "2026-04" → "Nis '26". TR ay kısaltmaları. */
export function formatAyLabel(ay: string): string {
  const [yyyy, mm] = ay.split("-");
  const months = [
    "Oca",
    "Şub",
    "Mar",
    "Nis",
    "May",
    "Haz",
    "Tem",
    "Ağu",
    "Eyl",
    "Eki",
    "Kas",
    "Ara",
  ];
  const idx = Math.max(0, Math.min(11, Number(mm) - 1));
  const yy = yyyy?.slice(2) ?? "";
  return `${months[idx]} '${yy}`;
}
