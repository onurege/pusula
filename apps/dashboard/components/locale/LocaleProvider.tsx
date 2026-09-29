"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n";

/**
 * Locale context — server'da cookie'den okunan başlangıç değeri layout'ta
 * `initialLocale` olarak geçirilir; client tarafı `useLocale()` ile okur/
 * yazar. `tenant-provider.tsx` ile aynı desen: provider yoksa hook throw
 * eder (sessiz fallback yerine net hata).
 */
type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const router = useRouter();

  const setLocale = (next: Locale) => {
    if (next === locale) return;
    // Non-httpOnly tercih cookie'si — 1 yıl, tüm site. Sunucu render'ı
    // yeni locale ile üretsin diye `router.refresh()` ile server component'
    // leri yeniden çalıştırırız (bkz. Next.js cookies rehberi: cookie
    // set/delete yalnız Server Function/Route Handler'da desteklenir, ama
    // bu bir kimlik/güvenlik cookie'si değil — düz UI tercihi — client'tan
    // `document.cookie` ile yazmak güvenli ve basit).
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setLocaleState(next);
    router.refresh();
  };

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error(
      "useLocale() called outside <LocaleProvider>. Layout'ta provider'ın yerini kontrol et — RootLayout body'sini sarmalı.",
    );
  }
  return ctx;
}
