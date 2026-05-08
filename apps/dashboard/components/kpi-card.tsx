type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_RING: Record<Tone, string> = {
  good: "border-good/40 bg-good/5",
  warn: "border-accent/40 bg-accent/5",
  bad: "border-bad/40 bg-bad/5",
  neutral: "border-border bg-surface",
};

const TONE_DOT: Record<Tone, string> = {
  good: "bg-good",
  warn: "bg-accent",
  bad: "bg-bad",
  neutral: "bg-muted",
};

function formatNumber(v: number | string, unit?: string): string {
  if (typeof v === "number") {
    const formatted = Math.abs(v) >= 1000 ? v.toLocaleString("tr-TR") : String(v);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return unit ? `${v} ${unit}` : String(v);
}

export function KpiCard({
  label,
  value,
  unit,
  delta,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number | string;
  unit?: string;
  delta?: number;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className={`rounded-lg border p-5 ${TONE_RING[tone]}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
        <span className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} />
        {label}
      </div>
      <div className="text-3xl font-semibold tracking-tight mt-2 tabular-nums">
        {formatNumber(value, unit)}
      </div>
      {delta !== undefined && (
        <div className={`text-xs mt-1 ${delta >= 0 ? "text-good" : "text-bad"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString("tr-TR")}
        </div>
      )}
      {hint && <div className="text-xs text-muted mt-2">{hint}</div>}
    </div>
  );
}
