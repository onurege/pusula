"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { leaveTrackedScreen, trackScreen } from "@/lib/telemetry";

/** Oturum öncesi / kurulum yolları — telemetri SESSİZ. */
function isSilentPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/setup" || pathname.startsWith("/auth");
}

/**
 * Kök layout'a tek seferlik mount edilen görünmez client bileşen. Rota
 * değiştikçe `screen_view` / `screen_leave(dwellMs)` üretir (bkz.
 * `lib/telemetry.ts`). Hiçbir şey render etmez; hata durumunda UI'ı etkilemez.
 */
export function TelemetryProvider() {
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (!pathname) return;
    if (isSilentPath(pathname)) leaveTrackedScreen();
    else trackScreen(pathname);
  }, [pathname]);

  return null;
}
