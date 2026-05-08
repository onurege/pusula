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
    <div className={`rounded-xl border p-4 ${TONE_RING[tone]} flex flex-col justify-between min-h-[110px]`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted font-medium">
        <span className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} />
        {label}
      </div>
      <div className="text-[28px] xl:text-[32px] font-semibold tracking-tight tabular-nums leading-none mt-2">
        {formatted}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] tabular-nums">
        {delta !== undefined && (
          <span className={delta >= 0 ? "text-good" : "text-bad"}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString("tr-TR")}
          </span>
        )}
        {hint && <span className="text-muted">{hint}</span>}
      </div>
    </div>
  );
}
