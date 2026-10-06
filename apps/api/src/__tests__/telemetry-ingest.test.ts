import { describe, expect, it } from "vitest";
import { buildStampedEvents, parseEpochParam } from "../telemetry-ingest.js";

const actor = { userId: 7, username: "ayse" };

describe("buildStampedEvents", () => {
  it("rejects non-object / non-array bodies", () => {
    expect(buildStampedEvents(null, actor, 1)).toBeNull();
    expect(buildStampedEvents({ events: "x" }, actor, 1)).toBeNull();
  });

  it("drops server-only and unknown types, non-objects", () => {
    const body = { events: [{ type: "login" }, { type: "nope" }, 3, null] };
    expect(buildStampedEvents(body, actor, 1)).toEqual([]);
  });

  it("stamps identity + ts from server and clamps fields", () => {
    const evil = {
      type: "screen_leave",
      screen: "s".repeat(500),
      sessionId: "sid",
      ts: 5,
      dwellMs: 9e12,
      interactionKind: "bad",
      userId: 99,
      username: "evil",
    };
    const [e] = buildStampedEvents({ events: [evil] }, actor, 1000)!;
    expect(e).toMatchObject({
      ts: 1000,
      clientTs: 5,
      userId: 7,
      username: "ayse",
      dwellMs: 86_400_000,
      interactionKind: null,
    });
    expect(e!.screen).toHaveLength(128);
  });

  it("truncates to 50 events per request", () => {
    const events = Array.from({ length: 80 }, () => ({ type: "screen_view", screen: "/x" }));
    expect(buildStampedEvents({ events }, actor, 1)).toHaveLength(50);
  });
});

describe("parseEpochParam", () => {
  it("falls back on missing/invalid input", () => {
    expect(parseEpochParam(undefined, 9)).toBe(9);
    expect(parseEpochParam("abc", 9)).toBe(9);
    expect(parseEpochParam("-5", 9)).toBe(9);
    expect(parseEpochParam("123.9", 9)).toBe(123);
  });
});

describe("buildStampedEvents — hostile payload characterization", () => {
  it("never throws on wrong-typed fields; coerces to null", () => {
    const body = {
      events: [
        {
          type: "interaction",
          screen: { a: 1 },
          sessionId: 42,
          ts: "now",
          dwellMs: "9",
          interactionKind: 7,
          interactionDetail: ["x"],
        },
        { type: "screen_leave", dwellMs: NaN },
        { type: "screen_leave", dwellMs: -50 },
        { type: "screen_view", dwellMs: 999 },
      ],
    };
    const out = buildStampedEvents(body, actor, 1)!;
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ screen: null, sessionId: null, clientTs: null, dwellMs: null, interactionKind: null, interactionDetail: null });
    expect(out[1]!.dwellMs).toBeNull();
    expect(out[2]!.dwellMs).toBe(0);
    expect(out[3]!.dwellMs).toBeNull(); // dwell only honoured for screen_leave
  });

  it("rejects array / primitive bodies; prototype-pollution keys ignored", () => {
    expect(buildStampedEvents([], actor, 1)).toBeNull();
    expect(buildStampedEvents("x", actor, 1)).toBeNull();
    const body = JSON.parse('{"events":[{"type":"screen_view","__proto__":{"userId":1},"userId":1}]}');
    expect(buildStampedEvents(body, actor, 1)![0]).toMatchObject({ userId: 7, username: "ayse" });
  });

  it("long detail/session clamped", () => {
    const [e] = buildStampedEvents({ events: [{ type: "interaction", sessionId: "s".repeat(999), interactionDetail: "d".repeat(999) }] }, actor, 1)!;
    expect(e!.sessionId).toHaveLength(64);
    expect(e!.interactionDetail).toHaveLength(128);
  });
});

describe("parseEpochParam — edge", () => {
  it("empty/whitespace/Infinity fall back", () => {
    expect(parseEpochParam("", 9)).toBe(9);
    expect(parseEpochParam("  ", 9)).toBe(9);
    expect(parseEpochParam("Infinity", 9)).toBe(9);
  });
});
