"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui/cn";

/**
 * Komuta birim toggle'ı: TL ↔ 9L (9-Litre-Equivalent).
 *
 * Snapshot tüm aggregation'larını (KPI, region, channel, matrix, heatmap,
 * portfolio, leaderboard) seçilen birim üzerinden hesaplar. Sayfa server
 * component'i `?unit=` URL param'ını okur ve `getKomutaSnapshot({ unit })`
 * çağırır → cache key'e dahil olduğu için iki birim için ayrı cache satırı
 * vardır, geçiş anında yeniden hesap-bekleme süresi yoktur.
 *
 * URL-state tercihi: localStorage yerine query param — server component
 * okur, bookmark/share korur, V1+V2'de aynı pattern.
 */
export function UnitToggle() {
  const pathname = usePathname() ?? "/";
  const sp = useSearchParams();
  const active = sp.get("unit") === "9le" ? "9le" : "tl";

  function buildHref(unit: "tl" | "9le"): string {
    const params = new URLSearchParams(sp.toString());
    if (unit === "tl") params.delete("unit");
    else params.set("unit", unit);
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const options: { id: "tl" | "9le"; label: string; hint: string }[] = [
    { id: "tl", label: "₺ TL", hint: "Tüm değerler Türk Lirası bazında" },
    {
      id: "9le",
      label: "9L",
      hint: "Tüm değerler 9-Litre-Equivalent hacim bazında (Pernod resmi katsayı: TBLURUNEKSAHA saha 26)",
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="Birim"
      className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface-2 border border-border"
      title="TL ↔ 9L birim toggle'ı. Tüm Komuta hesaplamaları seçilen birim üzerinden yeniden çalışır."
    >
      <span className="px-2 text-[10.5px] uppercase tracking-wider text-muted font-semibold">
        Birim
      </span>
      {options.map((opt) => {
        const isActive = active === opt.id;
        return (
          <Link
            key={opt.id}
            href={buildHref(opt.id)}
            role="tab"
            aria-selected={isActive}
            title={opt.hint}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-semibold transition-colors",
              isActive
                ? "bg-surface text-fg shadow-xs border border-border"
                : "text-muted hover:text-fg hover:bg-surface",
            )}
          >
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}
