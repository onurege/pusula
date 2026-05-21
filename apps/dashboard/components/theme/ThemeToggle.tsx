"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  getCurrentTheme,
  toggleTheme,
  THEME_CHANGE_EVENT,
  type Theme,
  type ThemeChangedDetail,
} from "./theme-store";

/**
 * Navbar'a yerleştirilen tek tıklamayla light/dark toggle butonu. Mount
 * sonrası DOM'dan mevcut temayı okur (layout bootstrap script ilk paint
 * öncesi ayarladı), tema değiştirenleri dinler ki başka bir yerden
 * değiştirildiğinde de senkron kalsın.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTheme(getCurrentTheme());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ThemeChangedDetail>).detail;
      if (detail?.theme) setTheme(detail.theme);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  const isDark = theme === "dark";
  const label = isDark ? "Aydınlık temaya geç" : "Koyu temaya geç";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        const next = toggleTheme();
        setTheme(next);
      }}
      // SSR/CSR farkı olabileceği için mount edilene kadar aria-hidden
      aria-hidden={!mounted}
      className="inline-flex items-center justify-center size-8 rounded-md text-fg-2 hover:text-fg hover:bg-surface-2 border border-transparent hover:border-border transition-colors"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
