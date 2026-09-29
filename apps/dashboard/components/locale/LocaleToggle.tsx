"use client";

import { useLocale } from "./LocaleProvider";
import type { Locale } from "@/lib/i18n";

/**
 * Navbar'a yerleştirilen TR/EN dil seçici — `ThemeToggle` ile aynı boyut/
 * stil dilinde iki segment. Tıklama `useLocale().setLocale` üzerinden
 * cookie'yi günceller ve `router.refresh()` tetikler (server component'ler
 * yeni locale ile yeniden render olur).
 */
export function LocaleToggle() {
  const { locale, setLocale } = useLocale();

  const option = (value: Locale, label: string) => {
    const active = locale === value;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={active}
        aria-label={value === "tr" ? "Türkçe" : "English"}
        title={value === "tr" ? "Türkçe" : "English"}
        onClick={() => setLocale(value)}
        className={
          "px-1.5 h-6 rounded text-[11px] font-semibold tracking-wide transition-colors " +
          (active ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg")
        }
      >
        {label}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Dil seçimi"
      className="inline-flex items-center gap-0.5 h-8 px-0.5 rounded-md border border-transparent hover:border-border bg-surface-2/60 transition-colors"
    >
      {option("tr", "TR")}
      {option("en", "EN")}
    </div>
  );
}
