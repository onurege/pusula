import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

const base =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap " +
  "transition-all duration-150 select-none " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-xs hover:bg-[var(--color-accent-hover)] active:scale-[0.98]",
  secondary:
    "bg-surface-2 text-fg border border-border hover:bg-surface-3 active:scale-[0.98]",
  ghost:
    "text-fg-2 hover:text-fg hover:bg-surface-2 active:scale-[0.98]",
  outline:
    "bg-surface text-fg border border-border-strong hover:bg-surface-2 active:scale-[0.98]",
  destructive:
    "bg-bad text-white hover:opacity-90 active:scale-[0.98]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-md",
  md: "h-9 px-4 text-sm rounded-md",
  lg: "h-11 px-5 text-base rounded-lg",
  icon: "size-9 rounded-md",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading,
  iconLeft,
  iconRight,
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="inline-block size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        iconLeft
      )}
      {children}
      {!loading && iconRight}
    </button>
  );
}
