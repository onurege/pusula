import path from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { getLocalDb } from "./local-db.js";

// Pasif kullanım analitiği — YALNIZ yerel SQLite (`usage_events`, local-db.ts).
// MSSQL'e ASLA yazılmaz. Repo kökü cache.ts ile aynı desenle bulunur.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../../..");

// -- Sabitler ------------------------------------------------------------
const RETENTION_DAYS = 120;
const RETENTION_EVERY_N_INSERTS = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DWELL_MS = DAY_MS;
const DEFAULT_RECENT_LIMIT = 200;
const MAX_RECENT_LIMIT = 1000;
const LIST_CAP = 200; // screens / users listeleri için üst sınır

// Girdi uzunluk sınırları (defansif clamp).
const MAX_SCREEN_LEN = 128;
const MAX_SESSION_LEN = 64;
const MAX_USERNAME_LEN = 128;
const MAX_DETAIL_LEN = 128;
const MAX_KIND_LEN = 32;

const ALLOWED_EVENT_TYPES = new Set([
  "login",
  "logout",
  "screen_view",
  "screen_leave",
  "interaction",
]);

// -- Tipler (brief SHARED CONTRACT ile birebir) ----------------------------
export type ServerStampedEvent = {
  ts: number;
  clientTs: number | null;
  userId: number | null;
  username: string | null;
  sessionId: string | null;
  eventType: string;
  screen: string | null;
  dwellMs: number | null;
  interactionKind: string | null;
  interactionDetail: string | null;
};

export type UsageOverview = {
  logins: number;
  uniqueUsers: number;
  sessions: number;
  avgSessionDwellMs: number;
  screens: { screen: string; views: number; avgDwellMs: number; totalDwellMs: number }[];
  users: {
    username: string;
    sessions: number;
    views: number;
    totalDwellMs: number;
    lastSeenTs: number;
  }[];
  interactions: { interactionKind: string; count: number }[];
  timeline: { dayTs: number; logins: number; views: number }[];
  recent: {
    ts: number;
    username: string | null;
    eventType: string;
    screen: string | null;
    interactionKind: string | null;
    interactionDetail: string | null;
    dwellMs: number | null;
  }[];
};

// -- Girdi temizleme (güvenli varsayma) --------------------------------------

/** String değilse null; aksi halde max uzunluğa kırpılmış değer (boş → null). */
function clampText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

/** Sonlu sayı değilse null; aksi halde tamsayıya yuvarlanmış değer. */
function finiteIntOrNull(value: unknown): number | null {
  // Number(null) === 0 tuzağı: null/undefined/boş string açıkça null kalır.
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** dwell: sonlu, [0, 24 saat] aralığına kırpılır; geçersizse null. */
function clampDwell(value: unknown): number | null {
  const n = finiteIntOrNull(value);
  if (n === null) return null;
  return Math.min(Math.max(n, 0), MAX_DWELL_MS);
}

/** Satıra yazılacak temiz değerler; geçersiz olay (bilinmeyen tip) → null. */
function sanitizeEvent(e: ServerStampedEvent): unknown[] | null {
  if (!e || !ALLOWED_EVENT_TYPES.has(e.eventType)) return null;
  return [
    finiteIntOrNull(e.ts) ?? Date.now(),
    finiteIntOrNull(e.clientTs),
    finiteIntOrNull(e.userId),
    clampText(e.username, MAX_USERNAME_LEN),
    clampText(e.sessionId, MAX_SESSION_LEN),
    e.eventType,
    clampText(e.screen, MAX_SCREEN_LEN),
    clampDwell(e.dwellMs),
    clampText(e.interactionKind, MAX_KIND_LEN),
    clampText(e.interactionDetail, MAX_DETAIL_LEN),
  ];
}

// -- Yazım -------------------------------------------------------------

let insertCounter = 0;
let retentionRanOnce = false;

/** 120 günden eski satırları siler (sınırsız büyümeyi önler). */
function purgeExpired(db: Database.Database): void {
  const cutoff = Date.now() - RETENTION_DAYS * DAY_MS;
  db.prepare(`DELETE FROM usage_events WHERE ts < ?`).run(cutoff);
}

/**
 * Retention tetikleyicisi: süreç başına ilk yazımda ve sonrasında her ~500
 * insert'te bir çalışır — her insert'te DELETE çalıştırılmaz.
 */
function maybePurge(db: Database.Database, inserted: number): void {
  const before = insertCounter;
  insertCounter += inserted;
  const crossed =
    Math.floor(insertCounter / RETENTION_EVERY_N_INSERTS) >
    Math.floor(before / RETENTION_EVERY_N_INSERTS);
  if (crossed || !retentionRanOnce) {
    retentionRanOnce = true;
    purgeExpired(db);
  }
}

const INSERT_SQL = `
  INSERT INTO usage_events
    (ts, client_ts, user_id, username, session_id, event_type,
     screen, dwell_ms, interaction_kind, interaction_detail)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Olayları tek transaction'da toplu yazar. Dönen değer = kabul edilen satır
 * sayısı. Fail-silent: hata olursa 0 döner, asla fırlatmaz.
 */
export function recordUsageEvents(events: ServerStampedEvent[]): number {
  if (!Array.isArray(events) || events.length === 0) return 0;
  try {
    const rows = events
      .map(sanitizeEvent)
      .filter((row): row is unknown[] => row !== null);
    if (rows.length === 0) return 0;

    const db = getLocalDb(DEFAULT_REPO_ROOT);
    const stmt = db.prepare(INSERT_SQL);
    db.transaction((batch: unknown[][]) => {
      for (const row of batch) stmt.run(...row);
    })(rows);
    maybePurge(db, rows.length);
    return rows.length;
  } catch {
    return 0;
  }
}

/** Login/logout: sunucu tarafında tek satır. Fail-silent. */
export function recordServerEvent(e: {
  eventType: "login" | "logout";
  userId: number | null;
  username: string | null;
  sessionId?: string | null;
}): void {
  recordUsageEvents([
    {
      ts: Date.now(),
      clientTs: null,
      userId: e.userId,
      username: e.username,
      sessionId: e.sessionId ?? null,
      eventType: e.eventType,
      screen: null,
      dwellMs: null,
      interactionKind: null,
      interactionDetail: null,
    },
  ]);
}

// -- Okuma (tüm agregasyon SQL'de) ---------------------------------------------

type Filter = { where: string; params: unknown[] };

/** `ts BETWEEN` (idx_usage_ts) + opsiyonel kullanıcı filtresi. */
function buildFilter(fromTs: number, toTs: number, username?: string): Filter {
  const params: unknown[] = [Number(fromTs), Number(toTs)];
  let where = `ts BETWEEN ? AND ?`;
  if (username) {
    where += ` AND username = ?`;
    params.push(username);
  }
  return { where, params };
}

function clampLimit(limit: number | undefined): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RECENT_LIMIT;
  return Math.min(Math.floor(n), MAX_RECENT_LIMIT);
}

function readHeadline(db: Database.Database, f: Filter) {
  const head = db
    .prepare(
      `SELECT COALESCE(SUM(event_type = 'login'), 0)  AS logins,
              COUNT(DISTINCT username)                AS uniqueUsers,
              COUNT(DISTINCT session_id)              AS sessions
         FROM usage_events WHERE ${f.where}`,
    )
    .get(...f.params) as { logins: number; uniqueUsers: number; sessions: number };

  // Oturum süresi = o session'daki screen_leave dwell toplamı; ortalama alınır.
  const avg = db
    .prepare(
      `SELECT AVG(sessionDwell) AS avgDwell FROM (
         SELECT SUM(dwell_ms) AS sessionDwell
           FROM usage_events
          WHERE ${f.where} AND event_type = 'screen_leave' AND session_id IS NOT NULL
          GROUP BY session_id)`,
    )
    .get(...f.params) as { avgDwell: number | null };

  return { ...head, avgSessionDwellMs: Math.round(avg.avgDwell ?? 0) };
}

function readScreens(db: Database.Database, f: Filter): UsageOverview["screens"] {
  return db
    .prepare(
      `SELECT screen,
              COALESCE(SUM(event_type = 'screen_view'), 0) AS views,
              COALESCE(CAST(ROUND(AVG(CASE WHEN event_type = 'screen_leave'
                                           THEN dwell_ms END)) AS INTEGER), 0) AS avgDwellMs,
              COALESCE(SUM(CASE WHEN event_type = 'screen_leave'
                                THEN dwell_ms END), 0) AS totalDwellMs
         FROM usage_events
        WHERE ${f.where} AND screen IS NOT NULL
          AND event_type IN ('screen_view', 'screen_leave')
        GROUP BY screen
        ORDER BY views DESC, totalDwellMs DESC
        LIMIT ${LIST_CAP}`,
    )
    .all(...f.params) as UsageOverview["screens"];
}

function readUsers(db: Database.Database, f: Filter): UsageOverview["users"] {
  return db
    .prepare(
      `SELECT username,
              COUNT(DISTINCT session_id)                    AS sessions,
              COALESCE(SUM(event_type = 'screen_view'), 0)  AS views,
              COALESCE(SUM(CASE WHEN event_type = 'screen_leave'
                                THEN dwell_ms END), 0)      AS totalDwellMs,
              MAX(ts)                                       AS lastSeenTs
         FROM usage_events
        WHERE ${f.where} AND username IS NOT NULL
        GROUP BY username
        ORDER BY lastSeenTs DESC
        LIMIT ${LIST_CAP}`,
    )
    .all(...f.params) as UsageOverview["users"];
}

function readInteractions(db: Database.Database, f: Filter): UsageOverview["interactions"] {
  return db
    .prepare(
      `SELECT COALESCE(interaction_kind, 'other') AS interactionKind,
              COUNT(*)                            AS count
         FROM usage_events
        WHERE ${f.where} AND event_type = 'interaction'
        GROUP BY interactionKind
        ORDER BY count DESC`,
    )
    .all(...f.params) as UsageOverview["interactions"];
}

/** Gün = yerel gün başı (epoch ms); SQLite 'localtime' → 'utc' ile hesaplanır. */
function readTimeline(db: Database.Database, f: Filter): UsageOverview["timeline"] {
  return db
    .prepare(
      `SELECT CAST(strftime('%s', ts / 1000, 'unixepoch', 'localtime',
                            'start of day', 'utc') AS INTEGER) * 1000 AS dayTs,
              COALESCE(SUM(event_type = 'login'), 0)       AS logins,
              COALESCE(SUM(event_type = 'screen_view'), 0) AS views
         FROM usage_events
        WHERE ${f.where} AND event_type IN ('login', 'screen_view')
        GROUP BY dayTs
        ORDER BY dayTs ASC`,
    )
    .all(...f.params) as UsageOverview["timeline"];
}

function readRecent(
  db: Database.Database,
  f: Filter,
  limit: number,
): UsageOverview["recent"] {
  return db
    .prepare(
      `SELECT ts, username, event_type AS eventType, screen,
              interaction_kind AS interactionKind,
              interaction_detail AS interactionDetail,
              dwell_ms AS dwellMs
         FROM usage_events
        WHERE ${f.where}
        ORDER BY ts DESC, id DESC
        LIMIT ?`,
    )
    .all(...f.params, limit) as UsageOverview["recent"];
}

/** Admin kullanım ekranı için özet + detaylı son-olaylar logu. */
export function getUsageOverview(opts: {
  fromTs: number;
  toTs: number;
  username?: string;
  limit?: number;
}): UsageOverview {
  const db = getLocalDb(DEFAULT_REPO_ROOT);
  const f = buildFilter(opts.fromTs, opts.toTs, opts.username);
  return {
    ...readHeadline(db, f),
    screens: readScreens(db, f),
    users: readUsers(db, f),
    interactions: readInteractions(db, f),
    timeline: readTimeline(db, f),
    recent: readRecent(db, f, clampLimit(opts.limit)),
  };
}
