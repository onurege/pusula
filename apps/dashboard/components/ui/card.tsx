import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "default" | "accent" | "warn" | "bad" | "good" | "muted";
  padding?: "sm" | "md" | "lg" | "none";
};

const tones = {
  default: "border-border bg-surface",
  accent: "border-accent/30 bg-[var(--color-accent-soft)]",
  warn: "border-warn/30 bg-[var(--color-warn-soft)]",
  bad: "border-bad/30 bg-[var(--color-bad-soft)]",
  good: "border-good/30 bg-[var(--color-good-soft)]",
  muted: "border-border bg-surface-2",
} as const;

const paddings = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
} as const;

export function Card({
  className,
  tone = "default",
  padding = "md",
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border shadow-xs transition-shadow",
        tones[tone],
        paddings[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "text-[10px] uppercase tracking-wider font-semibold text-muted mb-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-base font-semibold tracking-tight", className)}>
      {children}
    </div>
  );
}
