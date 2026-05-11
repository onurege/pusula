// Tiny class-merge helper — shadcn typically uses clsx+tailwind-merge but
// we don't need conflict resolution for our handful of variants. Plain
// string-join with falsy filtering is enough and keeps the bundle lean.
export function cn(...args: (string | false | null | undefined)[]): string {
  return args.filter(Boolean).join(" ");
}
