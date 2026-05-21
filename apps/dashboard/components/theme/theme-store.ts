/**
 * Tema durumu — minimal store. ThemeToggle button buradan okur/yazar,
 * tema-aware komponentler (Recharts, MapLibre style) bu store'a abone olur.
 *
 * SSR güvenli: `typeof document` guard + ilk render'da default "light"
 * verilir (layout'taki bootstrap script gerçek değeri uygular).
 */

export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "enroute:theme";
export const THEME_CHANGE_EVENT = "enroute:theme:changed";

export type ThemeChangedDetail = { theme: Theme };

/** Şu anki temayı oku — DOM'dan (data-theme) veya fallback olarak light. */
export function getCurrentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "dark" ? "dark" : "light";
}

/** Temayı uygula + persist + event yay. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // private mode / quota — sessizce geç
  }
  window.dispatchEvent(
    new CustomEvent<ThemeChangedDetail>(THEME_CHANGE_EVENT, { detail: { theme } }),
  );
}

export function toggleTheme(): Theme {
  const next: Theme = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}
