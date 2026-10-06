import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// İzole yerel SQLite: gerçek data/ dizinine DOKUNMA (cache DB kirlenmesin).
const tmp = mkdtempSync(path.join(os.tmpdir(), "usage-tel-"));
vi.mock("../local-db.js", async (orig) => {
  const m = await orig<typeof import("../local-db.js")>();
  return { ...m, getLocalDb: () => m.getLocalDb(tmp) };
});

import {
  getUsageOverview,
  recordServerEvent,
  recordUsageEvents,
  type ServerStampedEvent,
} from "../usage-telemetry.js";

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const base = (o: Partial<ServerStampedEvent>): ServerStampedEvent => ({
  ts: Date.now(),
  clientTs: null,
  userId: 1,
  username: "ayse",
  sessionId: "s1",
  eventType: "screen_view",
  screen: "/a",
  dwellMs: null,
  interactionKind: null,
  interactionDetail: null,
  ...o,
});

describe("usage-telemetry (characterization)", () => {
  it("empty store → zeros/empty arrays, no throw", () => {
    const o = getUsageOverview({ fromTs: 0, toTs: Date.now() + 1000 });
    expect(o).toMatchObject({ logins: 0, uniqueUsers: 0, sessions: 0, avgSessionDwellMs: 0 });
    expect(o.screens).toEqual([]);
    expect(o.recent).toEqual([]);
  });

  it("rejects unknown event types; accepts valid; never throws on junk", () => {
    expect(recordUsageEvents([base({ eventType: "hack" })])).toBe(0);
    expect(recordUsageEvents(null as never)).toBe(0);
    expect(recordUsageEvents([null as never, base({})])).toBe(1);
    // SQL binding poison: object/NaN/Infinity fields
    expect(
      recordUsageEvents([
        base({ ts: NaN, clientTs: Infinity, dwellMs: -5, screen: { x: 1 } as never, sessionId: 5 as never }),
      ]),
    ).toBe(1);
  });

  it("aggregates dwell/views/logins/interactions per contract", () => {
    const t = Date.now();
    recordServerEvent({ eventType: "login", userId: 2, username: "veli" });
    recordUsageEvents([
      base({ ts: t, username: "veli", sessionId: "v1", screen: "/x" }),
      base({ ts: t, username: "veli", sessionId: "v1", screen: "/x", eventType: "screen_leave", dwellMs: 4000 }),
      base({ ts: t, username: "veli", sessionId: "v1", screen: "/x", eventType: "screen_leave", dwellMs: 2000 }),
      base({ ts: t, username: "veli", sessionId: "v1", screen: "/x", eventType: "interaction", interactionKind: "period", interactionDetail: "p12" }),
    ]);
    const o = getUsageOverview({ fromTs: t - 1000, toTs: t + 1000, username: "veli", limit: 2 });
    expect(o.logins).toBe(1);
    expect(o.uniqueUsers).toBe(1);
    expect(o.sessions).toBe(1);
    expect(o.avgSessionDwellMs).toBe(6000);
    expect(o.screens[0]).toMatchObject({ screen: "/x", views: 1, avgDwellMs: 3000, totalDwellMs: 6000 });
    expect(o.interactions).toEqual([{ interactionKind: "period", count: 1 }]);
    expect(o.recent).toHaveLength(2); // limit honoured
    expect(o.timeline).toHaveLength(1);
    expect(o.timeline[0]).toMatchObject({ logins: 1, views: 1 });
    // dayTs must be local midnight of t
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    expect(o.timeline[0]!.dayTs).toBe(d.getTime());
  });

  it("username filter is parameterized (injection string matches nothing, no throw)", () => {
    const o = getUsageOverview({ fromTs: 0, toTs: Date.now() + 1e6, username: "x' OR '1'='1" });
    expect(o.recent).toEqual([]);
  });

  it("from>to returns empty, hostile limit clamps", () => {
    expect(getUsageOverview({ fromTs: 10, toTs: 1, limit: 1e9 }).recent).toEqual([]);
    expect(getUsageOverview({ fromTs: 0, toTs: Date.now() + 1e6, limit: -3 }).recent.length).toBeGreaterThan(0);
  });
});
