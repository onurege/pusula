/**
 * Ekran listesi — yetkilendirme (kullanıcı hangi ekranı görebilir) için tek
 * kaynak. id = perms store'daki ekran anahtarı; href = nav rotası.
 */
export const SCREENS: { id: string; label: string; href: string }[] = [
  { id: "ozet", label: "Özet", href: "/v3" },
  { id: "cockpit", label: "Cockpit", href: "/v3/cockpit" },
  { id: "harita", label: "Harita", href: "/v3/harita" },
  { id: "yonetim", label: "Yönetim", href: "/v3/yonetim-kurulu" },
  { id: "satis", label: "Satış", href: "/v3/satis-performans" },
  { id: "segment", label: "Segment", href: "/v3/musteri-segmentasyon" },
  { id: "marka", label: "Marka", href: "/v3/marka-sku" },
  { id: "stok", label: "Stok", href: "/v3/stok-tukenme" },
  { id: "saha", label: "Saha", href: "/v3/saha-operasyon" },
  { id: "risk", label: "Risk", href: "/v3/aktivasyon-risk" },
  { id: "iskonto", label: "İskonto", href: "/v3/ticari-yatirim" },
];

export function screenIdForHref(href: string): string | null {
  return SCREENS.find((s) => s.href === href)?.id ?? null;
}

export function screenIdForPath(pathname: string): string | null {
  // En uzun eşleşen href (prefix) → ekran id. /v3 en sona ki alt yolları çalmasın.
  const sorted = [...SCREENS].sort((a, b) => b.href.length - a.href.length);
  const s = sorted.find((x) => pathname === x.href || pathname.startsWith(x.href + "/"));
  return s?.id ?? null;
}

/** allowedScreens null/undefined → hepsi serbest. */
export function canSeeScreen(allowed: string[] | null | undefined, id: string | null): boolean {
  if (!allowed) return true;
  if (!id) return true; // ekran-dışı yollar (admin, login) serbest
  return allowed.includes(id);
}
