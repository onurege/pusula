"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Database,
  FilePlus2,
  FileText,
  Map,
} from "lucide-react";
import { cn } from "./cn";

const items = [
  { href: "/", label: "Radar", icon: Activity },
  { href: "/map", label: "Harita", icon: Map },
  { href: "/risk", label: "Kayıp Riski", icon: AlertTriangle },
  { href: "/ziyaret", label: "Ziyaret Boşluğu", icon: CalendarClock },
  { href: "/reports", label: "Raporlar", icon: FileText },
  { href: "/reports/new", label: "Yeni rapor", icon: FilePlus2 },
  { href: "/schema", label: "Şema", icon: Database },
] as const;

export function Navbar() {
  const pathname = usePathname() ?? "/";
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto max-w-[1600px] px-5 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="size-7 rounded-lg bg-accent text-accent-fg font-bold flex items-center justify-center text-sm shadow-sm group-hover:shadow-md transition-shadow">
            EP
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-semibold tracking-tight text-[15px]">Enroute Pusula</span>
            
          </div>
        </Link>
        <nav className="flex items-center gap-1">
          {items.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 h-9 rounded-md text-sm transition-colors",
                  active
                    ? "bg-[var(--color-accent-soft)] text-accent font-medium"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
              >
                <Icon size={15} strokeWidth={2} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
