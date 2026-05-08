import { smartFormat } from "@/lib/format";

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
  const formatted = smartFormat(value, unit);
  return (
    <div className={`rounded-xl border p-6 ${TONE_RING[tone]}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted font-medium">
        <span className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} />
        {label}
      </div>
      <div className="text-4xl md:text-5xl font-semibold tracking-tight mt-3 tabular-nums leading-none">
        {formatted}
      </div>
      {delta !== undefined && (
        <div className={`text-xs mt-3 tabular-nums ${delta >= 0 ? "text-good" : "text-bad"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString("tr-TR")}
        </div>
      )}
      {hint && <div className="text-xs text-muted mt-2">{hint}</div>}
    </div>
  );
}
