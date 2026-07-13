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
  LayoutDashboard,
  Map,
  Package,
  PieChart,
  Sparkles,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { LogOut } from "lucide-react";
import { cn } from "./cn";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { GlobalRefreshButton } from "@/components/global-refresh-button";
import { useTenant } from "@/components/tenant-provider";
import { useAuth } from "@/components/auth/auth-context";

// V1 — mevcut çalışan IA (üretim). Asla kırılmamalı.
const itemsV1 = [
  { href: "/", label: "Radar", icon: Activity },
  { href: "/map", label: "Harita", icon: Map },
  { href: "/risk", label: "Kayıp Riski", icon: AlertTriangle },
  { href: "/ziyaret", label: "Ziyaret Boşluğu", icon: CalendarClock },
  { href: "/komuta", label: "Komuta", icon: Compass },
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

// V3 — Wietnauer talepleri doğrultusunda ayrı dashboard IA. Her dashboard
// kendi sayfası; karışık tab yapısı yok.
const itemsV3 = [
  { href: "/v3", label: "Özet", icon: LayoutDashboard },
  { href: "/v3/cockpit", label: "Cockpit", icon: Compass },
  { href: "/v3/harita", label: "Harita", icon: Map },
  { href: "/v3/yonetim-kurulu", label: "Yönetim", icon: PieChart },
  { href: "/v3/satis-performans", label: "Satış", icon: TrendingUp },
  { href: "/v3/musteri-segmentasyon", label: "Segment", icon: Users },
  { href: "/v3/marka-sku", label: "Marka", icon: Package },
  { href: "/v3/stok-tukenme", label: "Stok", icon: Package },
  { href: "/v3/saha-operasyon", label: "Saha", icon: Truck },
  { href: "/v3/aktivasyon-risk", label: "Risk", icon: Target },
  { href: "/v3/ticari-yatirim", label: "İskonto", icon: Wallet },
] as const;

/** Giriş yapan kullanıcı rozeti + rol etiketi + çıkış. */
function UserChip() {
  const { user, loading } = useAuth();
  const { logout } = useAuth();
  if (loading || !user) return null;
  const name = user.displayName?.trim() || user.username;
  const roleLabel = user.role === "merkez" ? "Merkez" : "Distribütör";
  return (
    <div className="ml-1 flex items-center gap-2">
      <div className="hidden sm:flex flex-col items-end leading-tight">
        <span className="text-[12px] font-medium text-fg max-w-[140px] truncate">{name}</span>
        <span className="text-[10px] text-muted">{roleLabel}</span>
      </div>
      <button
        type="button"
        onClick={() => void logout()}
        title="Çıkış yap"
        className="flex items-center justify-center size-9 rounded-md text-muted hover:text-fg hover:bg-surface-2 transition-colors"
      >
        <LogOut size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname() ?? "/";
  // Login sayfasında chrome gösterme.
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");
  // Hangi sürümdeyiz? V3 > V2 > V1 öncelik sırası.
  const isV3 = pathname === "/v3" || pathname.startsWith("/v3/");
  const isV2 = !isV3 && (pathname === "/v2" || pathname.startsWith("/v2/"));
  const version = isV3 ? "v3" : isV2 ? "v2" : "v1";
  // Tenant config — logo/ürün adı + demo nav kısıtları tenant-özel.
  const tenant = useTenant();
  // Tenant'ın gizlediği nav href'lerini çıkar (ör. demo: /reports, /schema).
  const hiddenHrefs = tenant.ui?.hiddenNavHrefs ?? [];
  const baseItems = isV3 ? itemsV3 : isV2 ? itemsV2 : itemsV1;
  const items = hiddenHrefs.length
    ? baseItems.filter((i) => !hiddenHrefs.includes(i.href))
    : baseItems;
  if (isLogin) return null;
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto max-w-[1600px] px-5 h-14 flex items-center justify-between">
        <Link href={tenant.ui?.defaultLanding ?? "/"} className="flex items-center gap-2.5 group">
          <div className="size-7 rounded-lg bg-accent text-accent-fg font-bold flex items-center justify-center text-sm shadow-sm group-hover:shadow-md transition-shadow">
            {tenant.logoMark}
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-semibold tracking-tight text-[15px]">{tenant.productName}</span>

          </div>
        </Link>
        <div className="flex items-center gap-1">
          <nav className="flex items-center gap-1">
            {items.map(({ href, label, icon: Icon }) => {
              // V2'de /v2 home, V3'te /v3 home, V1'de "/" için tam-eşleşme.
              // Geri kalan için prefix match.
              const isRoot = href === "/" || href === "/v2" || href === "/v3";
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
          <GlobalRefreshButton />
          {!tenant.ui?.hideVersionToggle && <VersionToggle current={version} />}
          {!tenant.ui?.forceLightTheme && <ThemeToggle />}
          <UserChip />
        </div>
      </div>
    </header>
  );
}

/**
 * V1 ↔ V2 ↔ V3 IA sürüm geçiş butonu — 3'lü cycle.
 *   V1 = mevcut üretim layout'u (Radar, Komuta, /risk, /ziyaret...)
 *   V2 = sadeleştirilmiş Müşteri / Ürün / Saha sekme grupları
 *   V3 = Wietnauer dashboard yapısı (her madde kendi sayfası)
 * Üç sürüm de aynı veriyi okur; yalnızca panel yerleşimi farklı.
 */
function VersionToggle({ current }: { current: "v1" | "v2" | "v3" }) {
  // V1 → V2 → V3 → V1 cycle
  const next = current === "v1" ? "v2" : current === "v2" ? "v3" : "v1";
  const nextHref = next === "v1" ? "/" : next === "v2" ? "/v2" : "/v3";
  const nextLabel = next.toUpperCase();
  const targetHint = {
    v1: "V1 — mevcut üretim layout'u",
    v2: "V2 — sadeleştirilmiş Müşteri/Ürün/Saha IA",
    v3: "V3 — Wietnauer dashboard yapısı (her madde ayrı sayfa)",
  }[next];
  // Renk: V3 başka, V2 başka, V1 başka — kullanıcı hangi sürümde olduğunu görsün
  const accentNext = next === "v3";
  return (
    <Link
      href={nextHref}
      title={targetHint}
      aria-label={targetHint}
      className={cn(
        "inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-semibold tracking-tight border transition-colors",
        accentNext
          ? "border-accent/40 bg-accent-soft text-accent hover:bg-surface-2"
          : "border-border bg-surface-2 text-fg-2 hover:border-accent/40 hover:text-accent",
      )}
    >
      <Sparkles size={12} className="opacity-80" />
      {nextLabel}
      <span className="hidden md:inline text-muted-2 font-normal">
        → {nextLabel}
      </span>
    </Link>
  );
}
