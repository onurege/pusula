"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";
import { SCREENS, screenIdForPath } from "@/lib/screens";

/**
 * Kullanıcı yetkisi olmayan bir ekrana giderse izinli ilk ekrana yönlendirir.
 * Client-side UX koruması; asıl veri koruması API'de şehir-scope ile.
 * allowedScreens null → kısıt yok (hiçbir şey yapmaz).
 */
export function ScreenGuard() {
  const { user, loading } = useAuth();
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  useEffect(() => {
    if (loading || !user || !user.allowedScreens) return;
    const id = screenIdForPath(pathname);
    if (id && !user.allowedScreens.includes(id)) {
      const first = SCREENS.find((s) => user.allowedScreens!.includes(s.id));
      router.replace(first?.href ?? "/v3");
    }
  }, [user, loading, pathname, router]);

  return null;
}
