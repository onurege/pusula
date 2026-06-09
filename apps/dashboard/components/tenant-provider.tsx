"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { TenantConfig } from "@enroute/core/tenant";

/**
 * Tenant context — client component'lerin aktif tenant config'ine erişmesi
 * için. Server tarafı `getTenantConfig()` ile okur, layout'ta provider'a
 * geçirir; client component'ler `useTenant()` ile çeker.
 *
 * Provider, plain JSON-serializable object alır — RSC sınırından geçmek
 * için kritik (function/Date içermez, sadece string/number/boolean).
 *
 * Provider yoksa hook throw eder; bu kasıtlı — eksik provider sessiz
 * fallback yerine net hata vermeli.
 */
const TenantCtx = createContext<TenantConfig | null>(null);

export function TenantProvider({
  value,
  children,
}: {
  value: TenantConfig;
  children: ReactNode;
}) {
  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}

export function useTenant(): TenantConfig {
  const ctx = useContext(TenantCtx);
  if (!ctx) {
    throw new Error(
      "useTenant() called outside <TenantProvider>. " +
        "Layout'ta provider'ın yerini kontrol et — RootLayout body'sini sarmalı.",
    );
  }
  return ctx;
}
