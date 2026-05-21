/**
 * Haftalık aksiyon store'u — saha satış yöneticisinin demo journey sonunda
 * topladığı "bu hafta yapılacaklar" listesini tarayıcıda tutar. Tamamen
 * client-side; backend, MSSQL ya da SQLite'a hiç dokunmaz.
 *
 * Kalıcılık: localStorage (key `enroute:weekly-actions`).
 * Değişiklik yayını: window custom event `enroute:weekly-actions:changed`,
 * detail = güncel liste. Drawer ve floating badge bu event'i dinler.
 *
 * SSR güvenli: window/localStorage yoksa fonksiyonlar boş davranır.
 */

export type WeeklyActionSource = "foresight" | "finance" | "manual";

export type WeeklyAction = {
  id: string;
  text: string;
  reason?: string;
  customerId?: number;
  customerName?: string;
  region?: string;
  productGroup?: string;
  source: WeeklyActionSource;
  addedAt: string;
};

/** localStorage key — versiyonu ileride değiştirmek istersek bu sabit migre olur */
export const STORAGE_KEY = "enroute:weekly-actions";

/** Drawer ve badge'in dinlediği yayın kanalı */
export const CHANGE_EVENT = "enroute:weekly-actions:changed";

/** Listeyi client'a gönderirken kullanılan event detail tipi */
export type WeeklyActionsChangedDetail = {
  actions: WeeklyAction[];
};

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isWeeklyAction(value: unknown): value is WeeklyAction {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return false;
  if (typeof v.text !== "string") return false;
  if (typeof v.addedAt !== "string") return false;
  if (v.source !== "foresight" && v.source !== "finance" && v.source !== "manual") {
    return false;
  }
  // Geri kalan alanlar opsiyonel — tip kontrolünü gevşek tutuyoruz ki
  // ileride yeni alan eklersek eski kayıtlar düşmesin.
  return true;
}

function readRaw(): WeeklyAction[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWeeklyAction);
  } catch {
    // Bozuk JSON / quota — sessizce sıfırla, demo akışını kırma
    return [];
  }
}

function writeRaw(actions: WeeklyAction[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // Quota/ private mode — yut. Demo'da bir tab yeterli; kaybolan veri
    // kullanıcıyı bloklamasın.
  }
  const detail: WeeklyActionsChangedDetail = { actions };
  window.dispatchEvent(new CustomEvent<WeeklyActionsChangedDetail>(CHANGE_EVENT, { detail }));
}

function makeId(): string {
  // crypto.randomUUID() Node 19+ ve modern tarayıcılarda var. Yoksa basit
  // fallback — demo için collision riski göz ardı edilebilir seviyede.
  if (
    typeof crypto !== "undefined" &&
    typeof (crypto as Crypto).randomUUID === "function"
  ) {
    return (crypto as Crypto).randomUUID();
  }
  return `wa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Mevcut aksiyonları getir. SSR'de boş dizi döner. */
export function listActions(): WeeklyAction[] {
  return readRaw();
}

/**
 * Yeni bir aksiyon ekler. `id` ve `addedAt` otomatik üretilir; çağrı tarafı
 * bunları geçmesin diye Omit ediyoruz. Eklenen aksiyonu döner.
 */
export function addAction(input: Omit<WeeklyAction, "id" | "addedAt">): WeeklyAction {
  const action: WeeklyAction = {
    ...input,
    id: makeId(),
    addedAt: new Date().toISOString(),
  };
  const next = [action, ...readRaw()];
  writeRaw(next);
  return action;
}

/** Tek bir aksiyonu id ile siler. Yoksa no-op. */
export function removeAction(id: string): void {
  const current = readRaw();
  const next = current.filter((a) => a.id !== id);
  if (next.length === current.length) return;
  writeRaw(next);
}

/** Tüm aksiyonları siler. */
export function clearActions(): void {
  if (readRaw().length === 0) return;
  writeRaw([]);
}
