import { describe, expect, it } from "vitest";
import {
  assessTake,
  classifyTakeEnd,
  QUIET_TAKE_BYTES_PER_SEC,
  SHORT_TAKE_MS,
  shouldStartTake,
  takeEndBanner,
  takeNoteText,
} from "@/lib/karaoke/takeLifecycle";
import {
  INITIAL_WAIVER_STATE,
  isWaiverError,
  KARAOKE_WAIVER_VERSION,
  waiverNeeded,
  waiverReducer,
  type WaiverEvent,
  type WaiverState,
} from "@/lib/karaoke/waiverRules";

describe("end-reason banners on the Save / Discard prompt", () => {
  it("uses the agreed copy for each way a performance can end", () => {
    expect(takeEndBanner("self")).toBeNull();
    expect(takeEndBanner("admin")?.text).toBe("An admin ended your performance.");
    expect(takeEndBanner("host")?.text).toBe("The host ended your performance.");
    expect(takeEndBanner("connection")?.text).toMatch(/connection dropped/i);
    expect(takeEndBanner("timeout")?.text).toMatch(/time on stage ran out/i);
    expect(takeEndBanner("ended")?.text).toBe("Your performance was ended.");
    expect(takeEndBanner("admin")?.tone).toBe("warn");
    expect(takeEndBanner("connection")?.tone).toBe("info");
  });

  const base = {
    localAction: false,
    leaving: false,
    userId: "u1",
    generation: 7,
    serverEnd: null,
    recentlyDisconnected: false,
  };
  it("a local Stop / End song is always the singer's own", () => {
    expect(
      classifyTakeEnd({
        ...base,
        localAction: true,
        serverEnd: { performer: "u1", generation: 7, reason: "admin" },
      }),
    ).toBe("self");
  });
  it("takes the server's reason for THIS singer and THIS turn", () => {
    for (const reason of ["admin", "host", "connection", "timeout", "self"] as const) {
      expect(
        classifyTakeEnd({ ...base, serverEnd: { performer: "u1", generation: 7, reason } }),
      ).toBe(reason);
    }
  });
  it("ignores a server reason about someone else or an older turn", () => {
    expect(
      classifyTakeEnd({ ...base, serverEnd: { performer: "u2", generation: 7, reason: "admin" } }),
    ).toBe("ended");
    expect(
      classifyTakeEnd({ ...base, serverEnd: { performer: "u1", generation: 6, reason: "admin" } }),
    ).toBe("ended");
    expect(
      classifyTakeEnd({ ...base, serverEnd: { performer: "u1", generation: 7, reason: "weird" } }),
    ).toBe("ended");
  });
  it("falls back to connection, then leaving, then generic", () => {
    expect(classifyTakeEnd({ ...base, recentlyDisconnected: true, leaving: true })).toBe(
      "connection",
    );
    expect(classifyTakeEnd({ ...base, leaving: true })).toBe("left");
    expect(classifyTakeEnd(base)).toBe("ended");
  });
});

describe("no silent drops", () => {
  it("offers short takes with a 'was your mic on?' note", () => {
    const r = assessTake({ sizeBytes: 4_000, durationMs: SHORT_TAKE_MS - 1 });
    expect(r).toEqual({ offer: true, note: "short" });
    expect(takeNoteText(r.note)).toMatch(/Was your mic on\?/);
  });
  it("offers near-silent takes with a note (old build dropped anything under 8 KB)", () => {
    const r = assessTake({ sizeBytes: 7_000, durationMs: 60_000 });
    expect(r).toEqual({ offer: true, note: "silent" });
    expect(takeNoteText(r.note)).toMatch(/Was your mic on\?/);
  });
  it("offers normal takes without a note", () => {
    const r = assessTake({
      sizeBytes: QUIET_TAKE_BYTES_PER_SEC * 10 * 60,
      durationMs: 60_000,
    });
    expect(r).toEqual({ offer: true, note: null });
    expect(takeNoteText(null)).toBeNull();
  });
  it("only a take with no data at all is not offered (and the singer is told)", () => {
    expect(assessTake({ sizeBytes: 0, durationMs: 30_000 })).toEqual({
      offer: false,
      note: "silent",
    });
  });
});

describe("pending-prompt guard", () => {
  const ready = {
    wantRecord: true,
    recording: false,
    playing: true,
    promptPending: false,
    songKey: "7:abc",
    closedSongKey: null,
  };
  it("starts a take when the song plays", () => {
    expect(shouldStartTake(ready)).toBe(true);
  });
  it("never starts a second take while Save / Discard is pending", () => {
    expect(shouldStartTake({ ...ready, promptPending: true })).toBe(false);
  });
  it("never re-records the song whose take was just closed (End song keeps playing)", () => {
    expect(shouldStartTake({ ...ready, closedSongKey: "7:abc" })).toBe(false);
    expect(shouldStartTake({ ...ready, closedSongKey: "7:other" })).toBe(true);
  });
  it("needs a playing song, recording wanted, and no take already running", () => {
    expect(shouldStartTake({ ...ready, playing: false })).toBe(false);
    expect(shouldStartTake({ ...ready, wantRecord: false })).toBe(false);
    expect(shouldStartTake({ ...ready, recording: true })).toBe(false);
    expect(shouldStartTake({ ...ready, songKey: null })).toBe(false);
  });
});

describe("waiver: once per account sign-in (client cache)", () => {
  const run = (events: WaiverEvent[], s: WaiverState = INITIAL_WAIVER_STATE) =>
    events.reduce(waiverReducer, s);
  const current = KARAOKE_WAIVER_VERSION;

  it("asks until the server says this sign-in has accepted", () => {
    expect(waiverNeeded(run([{ type: "user", userId: "u1" }]))).toBe(true);
    const s = run([
      { type: "user", userId: "u1" },
      { type: "checking" },
      { type: "status", accepted: false, version: current },
    ]);
    expect(waiverNeeded(s)).toBe(true);
    expect(waiverNeeded(waiverReducer(s, { type: "accepted", version: current }))).toBe(false);
  });
  it("leaving and re-entering a room keeps the answer (same user, re-check)", () => {
    const s = run([
      { type: "user", userId: "u1" },
      { type: "status", accepted: true, version: current },
      { type: "user", userId: "u1" },
      { type: "checking" },
    ]);
    expect(waiverNeeded(s)).toBe(false);
  });
  it("signing out, or another account signing in, asks again", () => {
    const accepted = run([
      { type: "user", userId: "u1" },
      { type: "status", accepted: true, version: current },
    ]);
    expect(waiverNeeded(waiverReducer(accepted, { type: "signed-out" }))).toBe(true);
    expect(waiverNeeded(waiverReducer(accepted, { type: "user", userId: "u2" }))).toBe(true);
  });
  it("a server refusal (sign-out elsewhere / new version) asks again", () => {
    const accepted = run([
      { type: "user", userId: "u1" },
      { type: "status", accepted: true, version: current },
    ]);
    expect(waiverNeeded(waiverReducer(accepted, { type: "required" }))).toBe(true);
  });
  it("a different server version than this build's wording asks again", () => {
    const s = run([
      { type: "user", userId: "u1" },
      { type: "status", accepted: true, version: "2099-new" },
    ]);
    expect(waiverNeeded(s)).toBe(true);
    expect(waiverNeeded(s, "2099-new")).toBe(false);
  });
  it("an unreadable status asks (server still enforces), but never revokes an acceptance", () => {
    expect(waiverNeeded(run([{ type: "user", userId: "u1" }, { type: "status-error" }]))).toBe(
      true,
    );
    const accepted = run([
      { type: "user", userId: "u1" },
      { type: "accepted", version: current },
      { type: "status-error" },
    ]);
    expect(waiverNeeded(accepted)).toBe(false);
  });
  it("recognises the server's waiver refusals", () => {
    expect(
      isWaiverError("Accept the performance waiver in the Karaoke Machine to get in line."),
    ).toBe(true);
    expect(
      isWaiverError("WAIVER_REQUIRED: Accept the performance waiver before saving a take."),
    ).toBe(true);
    expect(isWaiverError("Someone else is on stage")).toBe(false);
    expect(isWaiverError(undefined)).toBe(false);
  });
});
