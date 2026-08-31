"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui/cn";

const OPTIONS = [30, 60, 90] as const;
type ActivityDays = (typeof OPTIONS)[number];

type Props = {
  current: ActivityDays;
};

/**
 * md11 — üstteki dönem filtresi. Haritada gösterilen birincil ciro/aktivite
 * penceresini (30/60/90 gün) kontrol eder; `?activityDays=N` ile
 * `/api/map/customers`'a geçer (`packages/core/src/map.ts` `listMapCustomers`
 * bunu `ciro30` / `ciro30+ciroPrev30` / `ciroT90` seçimine çevirir).
 *
 * BİLEREK etkilemediği: Kayıp riski (composite Risk Score) rengi/skoru —
 * o sabit pencerelerle sync anında hesaplanır, bu filtre onu değiştirmez.
 */
export function MapPeriodFilter({ current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const setDays = (days: ActivityDays) => {
    if (days === current) return;
    const params = new URLSearchParams(sp.toString());
    if (days === 30) {
      // 30 gün = varsayılan davranış — URL'i temiz tut.
      params.delete("activityDays");
    } else {
      params.set("activityDays", String(days));
    }
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div
      className="inline-flex items-center rounded-md border border-border bg-surface-2 p-0.5 text-xs"
      role="group"
      aria-label="Dönem filtresi"
    >
      {OPTIONS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          aria-pressed={current === d}
          className={cn(
            "inline-flex items-center px-2.5 py-1 rounded transition-colors tabular-nums",
            current === d
              ? "bg-surface text-fg shadow-xs"
              : "text-muted hover:text-fg",
          )}
          title={`Son ${d} gün — ciro ve aktivite metrikleri bu pencereye göre hesaplanır`}
        >
          {d}g
        </button>
      ))}
    </div>
  );
}
