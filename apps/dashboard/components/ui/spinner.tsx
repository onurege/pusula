import { cn } from "./cn";

export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border-2 border-current border-r-transparent animate-spin",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
