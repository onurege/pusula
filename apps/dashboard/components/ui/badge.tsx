import type { ReactNode } from "react";
import { cn } from "./cn";

type Tone = "default" | "accent" | "warn" | "bad" | "good" | "muted";
type Size = "sm" | "md";

const tones: Record<Tone, string> = {
  default: "bg-surface-2 text-fg-2 border-border",
  accent: "bg-[var(--color-accent-soft)] text-accent border-accent/30",
  warn: "bg-[var(--color-warn-soft)] text-warn border-warn/30",
  bad: "bg-[var(--color-bad-soft)] text-bad border-bad/30",
  good: "bg-[var(--color-good-soft)] text-good border-good/30",
  muted: "bg-surface-2 text-muted border-border",
};

const sizes: Record<Size, string> = {
  sm: "text-[10px] px-1.5 h-5",
  md: "text-xs px-2 h-6",
};

export function Badge({
  children,
  tone = "default",
  size = "sm",
  className,
  dot,
}: {
  children: ReactNode;
  tone?: Tone;
  size?: Size;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-medium uppercase tracking-wider whitespace-nowrap",
        tones[tone],
        sizes[size],
        className,
      )}
    >
      {dot && <span className="inline-block size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
