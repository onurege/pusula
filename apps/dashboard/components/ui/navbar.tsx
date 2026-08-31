"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Compass,
  LayoutDashboard,
  LogOut,
  Map,
  Package,
  PieChart,
  Settings,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "./cn";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { GlobalRefreshButton } from "@/components/global-refresh-button";
import { useTenant } from "@/components/tenant-provider";
import { useAuth } from "@/components/auth/auth-context";
import { useContent } from "@/components/content-provider";
import { canSeeScreen, screenIdForHref } from "@/lib/screens";

// V3 nav href → içerik override anahtarı (admin panelinden düzenlenir).
const V3_NAV_CK: Record<string, string> = {
  "/v3": "nav.ozet",
  "/v3/cockpit": "nav.cockpit",
  "/v3/harita": "nav.harita",
  "/v3/yonetim-kurulu": "nav.yonetim",
  "/v3/satis-performans": "nav.satis",
  "/v3/musteri-segmentasyon": "nav.segment",
  "/v3/marka-sku": "nav.marka",
  "/v3/stok-tukenme": "nav.stok",
  "/v3/saha-operasyon": "nav.saha",
  "/v3/aktivasyon-risk": "nav.risk",
  "/v3/ticari-yatirim": "nav.iskonto",
};

// Ana IA — her dashboard kendi sayfası. (V1/V2 kaldırıldı; V3 artık main.)
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
  // Tenant config — logo/ürün adı + demo nav kısıtları tenant-özel.
  const tenant = useTenant();
  const { t } = useContent();
  const { user } = useAuth();
  // Admin paneli: merkez rolü (hem demo hem wietnauer merkez kullanıcıları).
  const canAdmin = user?.isAdmin === true;
  // Tenant'ın gizlediği nav href'lerini çıkar (ör. demo).
  const hiddenHrefs = tenant.ui?.hiddenNavHrefs ?? [];
  // Nav: tenant gizli href'leri + kullanıcının ekran yetkisi (allowedScreens).
  const items = itemsV3.filter(
    (i) =>
      !hiddenHrefs.includes(i.href) &&
      canSeeScreen(user?.allowedScreens, screenIdForHref(i.href)),
  );
  if (isLogin) return null;
  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto max-w-[1600px] px-5 h-14 flex items-center gap-3">
        <Link href={tenant.ui?.defaultLanding ?? "/"} className="flex items-center gap-2.5 group shrink-0">
          <div className="size-7 rounded-lg bg-accent text-accent-fg font-bold flex items-center justify-center text-sm shadow-sm group-hover:shadow-md transition-shadow overflow-hidden">
            {tenant.ui?.logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tenant.ui.logoSrc}
                alt={t("brand.productName", tenant.productName)}
                className="size-[18px]"
              />
            ) : (
              t("brand.logoMark", tenant.logoMark)
            )}
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-semibold tracking-tight text-[15px]">{t("brand.productName", tenant.productName)}</span>

          </div>
        </Link>
          <nav className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {items.map(({ href, label, icon: Icon }) => {
              // /v3 home için tam-eşleşme; geri kalan için prefix match.
              const isRoot = href === "/v3";
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
                  {t(V3_NAV_CK[href] ?? "", label)}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-1 shrink-0">
          <div className="ml-1 pl-1 border-l border-border h-7" />
          {canAdmin && (
            <Link
              href="/admin"
              title="Admin — arayüz + yetki yönetimi"
              aria-label="Admin"
              className={cn(
                "flex items-center justify-center size-9 rounded-md transition-colors",
                pathname === "/admin"
                  ? "bg-[var(--color-accent-soft)] text-accent"
                  : "text-muted hover:text-fg hover:bg-surface-2",
              )}
            >
              <Settings size={16} strokeWidth={2} />
            </Link>
          )}
          <GlobalRefreshButton />
          {!tenant.ui?.forceLightTheme && <ThemeToggle />}
          <UserChip />
        </div>
      </div>
    </header>
  );
}

