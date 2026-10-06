import { SCREENS } from "@/lib/screens";

/** 1.234 ms → "1 sa 02 dk" / "4 dk 05 sn" / "12 sn". Sıfır/null → "—". */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h} sa ${String(m).padStart(2, "0")} dk`;
  if (m > 0) return `${m} dk ${String(s).padStart(2, "0")} sn`;
  return `${s} sn`;
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDay(ts: number): string {
  return new Date(ts).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
}

/** `<input type="date">` değeri (yyyy-mm-dd, yerel) → gün başı / gün sonu epoch ms. */
export function dayStartMs(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00`).getTime();
}
export function dayEndMs(isoDate: string): number {
  return new Date(`${isoDate}T23:59:59.999`).getTime();
}

export function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Rota → okunur ekran adı (bilinmiyorsa rotanın kendisi). */
export function screenLabel(route: string | null): string {
  if (!route) return "—";
  const exact = SCREENS.find((s) => s.href === route);
  if (exact) return exact.label;
  if (route === "/admin") return "Admin";
  if (route.startsWith("/admin/yetkiler")) return "Admin · Yetkiler";
  if (route.startsWith("/admin/konfigurator")) return "Admin · Konfigüratör";
  if (route.startsWith("/admin/kullanim")) return "Admin · Kullanım";
  return route;
}

export const EVENT_LABELS: Record<string, string> = {
  login: "Giriş",
  logout: "Çıkış",
  screen_view: "Ekran açıldı",
  screen_leave: "Ekrandan ayrıldı",
  interaction: "Etkileşim",
};

export const KIND_LABELS: Record<string, string> = {
  filter: "Filtre",
  period: "Periyot / dönem",
  unit: "Birim",
  drilldown: "Detaya iniş",
  other: "Diğer",
};
