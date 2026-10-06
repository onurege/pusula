/**
 * Kullanım telemetrisi — client collector (pasif analitik).
 *
 * Sözleşme: `/Users/egeusluer/Documents/atlas/briefs/usage-analytics.md`.
 *
 * Tasarım:
 *   - Olaylar bellekte kuyruklanır; periyodik / eşik / sayfa-gizlenme anında
 *     `navigator.sendBeacon('/api/telemetry')` ile toplu (max 50) gönderilir.
 *     sendBeacon yoksa ya da false dönerse `fetch(..., { keepalive: true })`.
 *   - Dwell: aktif ekranın giriş zamanı tutulur. Rota değişince
 *     `screen_leave(prev, dwellMs)` + `screen_view(next)`. Sekme gizlenince /
 *     `pagehide`'da aktif ekran için `screen_leave` yazılıp flush edilir;
 *     sekme tekrar görününce sayaç sıfırdan başlar (gizli süre dwell'e girmez).
 *   - HİÇBİR fonksiyon throw etmez; telemetri hatası dashboard'u kırmaz.
 *   - Modül import'u yan etkisizdir (SSR güvenli): window'a dokunan her şey
 *     `typeof window` korumalıdır ve ilk çağrıda (lazy) kurulur.
 *
 * RSC notu: bu modül yalnızca client bileşenlerden (event handler / useEffect)
 * çağrılır. Server component'ten ASLA çağırma.
 */

export type InteractionKind = "filter" | "period" | "unit" | "drilldown" | "other";

type TelemetryEventType = "screen_view" | "screen_leave" | "interaction";

type TelemetryEvent = {
  type: TelemetryEventType;
  screen: string;
  sessionId: string;
  ts: number;
  dwellMs?: number;
  interactionKind?: InteractionKind;
  interactionDetail?: string;
};

const ENDPOINT = "/api/telemetry";
const SESSION_KEY = "enroute:telemetry-sid";
const MAX_BATCH = 50; // sözleşme: istek başına max 50 olay
const FLUSH_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 15_000;
const MAX_QUEUE = 200; // sınırsız büyümeyi önle (en eskiler düşer)
const MAX_DWELL_MS = 24 * 3600 * 1000;
const KINDS: readonly InteractionKind[] = ["filter", "period", "unit", "drilldown", "other"];

let queue: TelemetryEvent[] = [];
let activeScreen: string | null = null;
let enteredAt: number | null = null;
let initialized = false;
let memorySessionId: string | null = null;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* düş */
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId(): string {
  try {
    if (typeof window === "undefined") return "";
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing.slice(0, 64);
    const id = newId();
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id.slice(0, 64);
  } catch {
    // sessionStorage kapalı (gizli mod / politika) → bellek içi oturum.
    if (!memorySessionId) memorySessionId = newId();
    return memorySessionId.slice(0, 64);
  }
}

function enqueue(event: Omit<TelemetryEvent, "sessionId" | "ts">): void {
  queue.push({ ...event, sessionId: getSessionId(), ts: Date.now() });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  if (queue.length >= FLUSH_THRESHOLD) flush();
}

/** Aktif ekran için dwell'i `screen_leave` olarak kuyruğa yazar ve sayacı durdurur. */
function closeActiveDwell(): void {
  if (activeScreen === null || enteredAt === null) return;
  const dwellMs = Math.min(Math.max(Date.now() - enteredAt, 0), MAX_DWELL_MS);
  enqueue({ type: "screen_leave", screen: activeScreen, dwellMs });
  enteredAt = null;
}

function send(batch: TelemetryEvent[]): void {
  const payload = JSON.stringify({ events: batch });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
      if (ok) return;
    }
  } catch {
    /* fetch fallback'e düş */
  }
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    /* sessiz */
  }
}

/** Kuyruğu boşaltır (50'lik parçalar). Asla throw etmez. */
export function flush(): void {
  try {
    if (typeof window === "undefined" || queue.length === 0) return;
    const pending = queue;
    queue = [];
    for (let i = 0; i < pending.length; i += MAX_BATCH) {
      send(pending.slice(i, i + MAX_BATCH));
    }
  } catch {
    /* sessiz */
  }
}

function onHidden(): void {
  try {
    closeActiveDwell();
    flush();
  } catch {
    /* sessiz */
  }
}

function ensureInit(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        onHidden();
      } else if (activeScreen !== null && enteredAt === null) {
        enteredAt = Date.now(); // geri dönüş: gizli süre dwell'e girmesin
      }
    });
    window.addEventListener("pagehide", onHidden);
    window.setInterval(flush, FLUSH_INTERVAL_MS);
  } catch {
    /* sessiz */
  }
}

/** Rota değişiminde çağrılır: önceki ekranı kapatır, yenisini açar. */
export function trackScreen(route: string): void {
  try {
    if (typeof window === "undefined" || !route) return;
    ensureInit();
    const screen = route.slice(0, 128);
    if (screen === activeScreen) return; // aynı ekran, tekrar yok
    closeActiveDwell();
    activeScreen = screen;
    enteredAt = document.visibilityState === "hidden" ? null : Date.now();
    enqueue({ type: "screen_view", screen });
  } catch {
    /* sessiz */
  }
}

/** Takip edilmeyen bir rotaya (login/setup/auth) geçişte: aktif ekranı kapat, yenisini açma. */
export function leaveTrackedScreen(): void {
  try {
    if (typeof window === "undefined") return;
    closeActiveDwell();
    activeScreen = null;
    flush();
  } catch {
    /* sessiz */
  }
}

/**
 * Logout'ta çağrılır: aktif ekranın dwell'ini flush eder (son ekran kaybolmasın)
 * ve oturum kimliğini sıfırlar — böylece aynı sekmede sonra giren farklı kullanıcı
 * aynı session_id'yi paylaşmaz. Cookie silinmeden ÖNCE çağrılmalı (beacon yetkili gitsin).
 */
export function endSession(): void {
  try {
    if (typeof window === "undefined") return;
    closeActiveDwell();
    activeScreen = null;
    flush();
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* sessionStorage kapalı — bellek içi id'yi sıfırlamak yeterli */
    }
    memorySessionId = null;
  } catch {
    /* sessiz */
  }
}

export function trackInteraction(kind: InteractionKind, detail: string): void {
  try {
    if (typeof window === "undefined" || activeScreen === null) return;
    ensureInit();
    enqueue({
      type: "interaction",
      screen: activeScreen,
      interactionKind: KINDS.includes(kind) ? kind : "other",
      interactionDetail: String(detail ?? "").slice(0, 128),
    });
  } catch {
    /* sessiz */
  }
}
