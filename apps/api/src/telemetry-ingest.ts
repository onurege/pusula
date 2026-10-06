// POST /api/telemetry gövde doğrulama + sunucu damgalama.
//
// Saf fonksiyonlar (I/O yok) → birim-testlenebilir, ingest ucu ucuz kalır.
// Güven sınırı: client yalnızca davranış alanlarını (type/screen/…/clientTs)
// belirler; kimlik (userId/username) ve authoritative zaman (ts) DAİMA
// sunucudan gelir — body'deki hiçbir kimlik alanı okunmaz.
import type { ServerStampedEvent } from "@enroute/core";

/** İstek başına en çok kabul edilen olay sayısı (fazlası kırpılır). */
export const MAX_EVENTS_PER_REQUEST = 50;
/** Ham gövde üst sınırı (bayt/karakter) — 50 olay için bol, kötüye kullanıma kapalı. */
export const MAX_BODY_CHARS = 64 * 1024;

const MAX_SCREEN_LEN = 128;
const MAX_SESSION_ID_LEN = 64;
const MAX_DETAIL_LEN = 128;
const MAX_DWELL_MS = 24 * 3600 * 1000;

const CLIENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  "screen_view",
  "screen_leave",
  "interaction",
]);
const INTERACTION_KINDS: ReadonlySet<string> = new Set([
  "filter",
  "period",
  "unit",
  "drilldown",
  "other",
]);

export type TelemetryActor = { userId: number; username: string };

/** `value` string ise `max` karaktere kırpar; aksi halde null. */
function clampString(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampDwell(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null) return null;
  return Math.min(Math.max(Math.round(n), 0), MAX_DWELL_MS);
}

/** Tek ham olayı damgalar; geçersiz tip/şekil → null (olay atılır). */
function stampEvent(raw: unknown, actor: TelemetryActor, now: number): ServerStampedEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || !CLIENT_EVENT_TYPES.has(e.type)) return null;

  const kind = typeof e.interactionKind === "string" ? e.interactionKind : null;
  return {
    ts: now,
    clientTs: finiteNumber(e.ts),
    userId: actor.userId,
    username: actor.username,
    sessionId: clampString(e.sessionId, MAX_SESSION_ID_LEN),
    eventType: e.type,
    screen: clampString(e.screen, MAX_SCREEN_LEN),
    dwellMs: e.type === "screen_leave" ? clampDwell(e.dwellMs) : null,
    interactionKind: kind !== null && INTERACTION_KINDS.has(kind) ? kind : null,
    interactionDetail: clampString(e.interactionDetail, MAX_DETAIL_LEN),
  };
}

/**
 * Ham JSON gövdesinden sunucu-damgalı olay listesi üretir.
 * Gövde `{ events: [...] }` değilse `null` (çağıran 400 döner); geçerli ama
 * hiç kabul edilebilir olay yoksa boş dizi.
 */
export function buildStampedEvents(
  body: unknown,
  actor: TelemetryActor,
  now: number,
): ServerStampedEvent[] | null {
  if (typeof body !== "object" || body === null) return null;
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;

  const stamped: ServerStampedEvent[] = [];
  for (const raw of events.slice(0, MAX_EVENTS_PER_REQUEST)) {
    const event = stampEvent(raw, actor, now);
    if (event) stamped.push(event);
  }
  return stamped;
}

/** `from`/`to` epoch-ms query parametresi; geçersiz/yoksa `fallback`. */
export function parseEpochParam(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
