/**
 * Yüzde değişim rozeti — pozitif yeşil, negatif kırmızı, nötr gri.
 *
 * Renkler tasarım sistemine paralel tutuluyor: brief'te belirtilen
 * pozitif #16a34a, negatif #dc2626. `hasPrev=false` → "yeni" etiketi
 * gösterir; önceki dönemde veri yoksa delta hesaplanamaz.
 */
export function DeltaBadge({
  pct,
  hasPrev,
}: {
  pct: number;
  hasPrev: boolean;
}) {
  if (!hasPrev) {
    return <span className="delta-badge new">yeni</span>;
  }
  const isPos = pct > 0;
  const isNeg = pct < 0;
  const color = isPos ? "#16a34a" : isNeg ? "#dc2626" : "var(--color-muted-2)";
  const arrow = isPos ? "▲" : isNeg ? "▼" : "▬";
  // Tek decimal, mutlak değer için Math.abs.
  const text = `${arrow} %${Math.abs(pct).toFixed(1)}`;
  return (
    <span
      className="delta-badge"
      style={{ color }}
      title={`Önceki 30 güne göre %${pct.toFixed(2)} değişim`}
    >
      {text}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .delta-badge { display: inline-flex; align-items: center; gap: 2px; font-variant-numeric: tabular-nums; font-weight: 500; font-size: 11.5px; white-space: nowrap; }
        .delta-badge.new { color: var(--color-accent); font-style: italic; font-weight: 600; }
      `,
        }}
      />
    </span>
  );
}
