"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/components/ui/cn";

export type SubTab = {
  id: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
};

type Props = {
  tabs: SubTab[];
  /** URL query param adı — varsayılan `tab`. */
  paramName?: string;
  /** Hiç tab seçili değilse aktif kabul edilecek default id. */
  defaultId: string;
};

/**
 * V2 sayfaları için ortak sub-tab navigation. URL `?tab=<id>` ile state
 * tutar; Next.js client component'i Link ile tetikleyerek nav yapar.
 * Server component'lerin de okuyabilmesi için query param tabanlı tutuyoruz
 * (cookie/localStorage yerine).
 */
export function SubTabNav({ tabs, paramName = "tab", defaultId }: Props) {
  const pathname = usePathname() ?? "/";
  const sp = useSearchParams();
  const active = sp.get(paramName) ?? defaultId;

  return (
    <nav
      role="tablist"
      aria-label="Alt sekmeler"
      className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface-2 border border-border"
    >
      {tabs.map((t) => {
        const isActive = active === t.id;
        const params = new URLSearchParams(sp.toString());
        if (t.id === defaultId) params.delete(paramName);
        else params.set(paramName, t.id);
        const qs = params.toString();
        const href = qs ? `${pathname}?${qs}` : pathname;
        return (
          <Link
            key={t.id}
            href={href}
            role="tab"
            aria-selected={isActive}
            title={t.hint}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium transition-colors",
              isActive
                ? "bg-surface text-fg shadow-xs border border-border"
                : "text-muted hover:text-fg hover:bg-surface",
            )}
          >
            {t.icon}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
