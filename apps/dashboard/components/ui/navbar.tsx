"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Compass,
  Database,
  FilePlus2,
  FileText,
  Layers,
  Map,
  Package,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "./cn";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

// V1 — mevcut çalışan IA (üretim). Asla kırılmamalı.
const itemsV1 = [
  { href: "/", label: "Radar", icon: Activity },
  { href: "/map", label: "Harita", icon: Map },
  { href: "/risk", label: "Kayıp Riski", icon: AlertTriangle },
  { href: "/ziyaret", label: "Ziyaret Boşluğu", icon: CalendarClock },
  { href: "/komuta", label: "Komuta Köprüsü", icon: Compass },
  { href: "/reports", label: "Raporlar", icon: FileText },
  { href: "/reports/new", label: "Yeni rapor", icon: FilePlus2 },
  { href: "/schema", label: "Şema", icon: Database },
] as const;

// V2 — sadeleştirilmiş IA (beta). Üst-sekme = ana alan; alt-sekmeler
// (?tab=) sayfa içinde açılır.
const itemsV2 = [
  { href: "/v2", label: "Radar", icon: Activity },
  { href: "/v2/komuta", label: "Komuta", icon: Compass },
  { href: "/v2/musteri", label: "Müşteri", icon: Users },
  { href: "/v2/urun", label: "Ürün", icon: Package },
  { href: "/v2/saha", label: "Saha", icon: Layers },
  { href: "/v2/harita", label: "Harita", icon: Map },
  { href: "/v2/raporlar", label: "Raporlar", icon: FileText },
] as const;

export function Navbar() {
  const pathname = usePathname() ?? "/";
  // /v2 veya /v2/* yolundayız → V2 nav setini göster.
  const isV2 = pathname === "/v2" || pathname.startsWith("/v2/");
  const items = isV2 ? itemsV2 : itemsV1;
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
        <div className="flex items-center gap-1">
          <nav className="flex items-center gap-1">
            {items.map(({ href, label, icon: Icon }) => {
              // V2'de /v2 home için tam-eşleşme; V1'de "/" için tam-eşleşme.
              // Geri kalan için prefix match (örn. /reports/new aktifken
              // /reports'un da highlight olmaması için tam path kontrolü).
              const isRoot = href === "/" || href === "/v2";
              const active = isRoot
                ? pathname === href
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
          <div className="ml-1 pl-1 border-l border-border h-7" />
          <VersionToggle isV2={isV2} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * V1 ↔ V2 IA sürüm geçiş butonu. V1 = mevcut üretim layout'u (Radar,
 * Komuta, /risk, /ziyaret...); V2 = sadeleştirilmiş yeni IA (Müşteri,
 * Ürün, Saha sekme grupları). Her iki sürüm de aynı veriyi okur;
 * yalnızca panel yerleşimi farklı.
 */
function VersionToggle({ isV2 }: { isV2: boolean }) {
  const href = isV2 ? "/" : "/v2";
  const targetLabel = isV2 ? "V1" : "V2";
  const targetHint = isV2
    ? "Mevcut sürüme (V1) dön"
    : "Yeni IA sürümü (V2 · Beta) — sadeleştirilmiş Müşteri / Ürün / Saha yapısı";
  return (
    <Link
      href={href}
      title={targetHint}
      aria-label={targetHint}
      className={cn(
        "inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-semibold tracking-tight border transition-colors",
        isV2
          ? "border-accent/40 bg-accent-soft text-accent hover:bg-surface-2"
          : "border-border bg-surface-2 text-fg-2 hover:border-accent/40 hover:text-accent",
      )}
    >
      <Sparkles size={12} className="opacity-80" />
      {targetLabel}
      <span className="hidden sm:inline text-muted-2 font-normal">
        {isV2 ? "→ V1" : "→ V2 Beta"}
      </span>
    </Link>
  );
}
