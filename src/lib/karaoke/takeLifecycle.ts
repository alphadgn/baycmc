/**
 * Pure rules for a karaoke take's life: when it records, when a new one may
 * start, how it ended, and whether the singer is asked to keep it.
 * (Unit-tested in tests/unit/take-lifecycle.test.ts and karaoke-save-waiver.test.ts.)
 */

/**
 * Whether the current performance's recording should still be running.
 *
 * Only the PERFORMANCE decides: the singer is on stage, recording is enabled
 * for the room, and a song is loaded. Mic mute, pause, and whether the mix is
 * currently on air are deliberately NOT inputs — none of them ends a take,
 * so none of them may trigger the "Save this performance?" prompt. The take
 * ends on Stop (song cleared), a new song, the turn ending or leaving.
 */
export function shouldKeepRecording(s: {
  active: boolean;
  recordingEnabled: boolean;
  songKey: string | null;
}): boolean {
  return s.active && s.recordingEnabled && !!s.songKey;
}

/**
 * Whether a NEW take may start now.
 *
 * After "End song" the singer keeps the stage (and the music keeps playing)
 * until they answer Save / Discard. Without this guard the next session
 * update would start a second recording of the same song, and a second
 * prompt would pop up once the stage was handed over.
 */
export function shouldStartTake(s: {
  wantRecord: boolean;
  recording: boolean;
  playing: boolean;
  /** A take from this room is waiting for the singer's Save / Discard. */
  promptPending: boolean;
  songKey: string | null;
  /** The song whose take was just closed (cleared when the song changes). */
  closedSongKey: string | null;
}): boolean {
  return (
    s.wantRecord &&
    !s.recording &&
    s.playing &&
    !s.promptPending &&
    !!s.songKey &&
    s.songKey !== s.closedSongKey
  );
}

/** Why a performance ended — drives the banner on the Save / Discard prompt. */
export type TakeEndReason =
  | "self" // Stop, End song, the track finished, or a new song
  | "admin" // an admin / super admin skipped or removed the singer
  | "host" // the room's booking host skipped or removed the singer
  | "connection" // connection dropped (missed heartbeats)
  | "timeout" // reserved slot ended or the room's song-length cap was hit
  | "left" // the singer left the room / closed the tab mid-song
  | "ended"; // the turn ended for a reason the device couldn't tell

const SERVER_REASONS: ReadonlySet<string> = new Set([
  "self",
  "admin",
  "host",
  "connection",
  "timeout",
]);

/** karaoke_sessions.last_end, written by karaoke_promote_next (migration 20261120000001). */
export interface ServerTurnEnd {
  performer?: string | null;
  generation?: number | null;
  reason?: string | null;
}

export function classifyTakeEnd(i: {
  /** The singer ended it on this device (Stop / End song / new song / track end). */
  localAction: boolean;
  /** The engine is unmounting (left the room, navigated away). */
  leaving: boolean;
  /** Singer's user id and the generation the take was recorded in. */
  userId: string;
  generation: number;
  serverEnd: ServerTurnEnd | null | undefined;
  /** LiveKit / network dropped within the last couple of minutes. */
  recentlyDisconnected: boolean;
}): TakeEndReason {
  if (i.localAction) return "self";
  const e = i.serverEnd;
  if (e && e.performer === i.userId && e.generation === i.generation && e.reason) {
    if (SERVER_REASONS.has(e.reason)) return e.reason as TakeEndReason;
  }
  if (i.recentlyDisconnected) return "connection";
  if (i.leaving) return "left";
  return "ended";
}

/** Banner shown above "Save this performance?" (null = no banner). */
export function takeEndBanner(
  reason: TakeEndReason,
): { tone: "warn" | "info"; text: string } | null {
  switch (reason) {
    case "admin":
      return { tone: "warn", text: "An admin ended your performance." };
    case "host":
      return { tone: "warn", text: "The host ended your performance." };
    case "connection":
      return { tone: "info", text: "Your connection dropped, so your performance ended." };
    case "timeout":
      return { tone: "info", text: "Your time on stage ran out, so your performance ended." };
    case "left":
      return { tone: "info", text: "You left the room during your performance." };
    case "ended":
      return { tone: "info", text: "Your performance was ended." };
    default:
      return null;
  }
}

/** Below these the take is flagged (never dropped). */
export const SHORT_TAKE_MS = 5_000;
/** ~24 kbit/s. Real singing at 128 kbit/s is far above; digital silence is far below. */
export const QUIET_TAKE_BYTES_PER_SEC = 3_000;

export type TakeNote = "short" | "silent" | null;

/**
 * Never drop a take silently. Anything with audio data is offered to the
 * singer; short or near-silent takes carry a "was your mic on?" note. Only a
 * take with no data at all is not offered, and then the singer is told why.
 */
export function assessTake(t: { sizeBytes: number; durationMs: number }): {
  offer: boolean;
  note: TakeNote;
} {
  if (t.sizeBytes <= 0) return { offer: false, note: "silent" };
  if (t.durationMs < SHORT_TAKE_MS) return { offer: true, note: "short" };
  const bytesPerSec = t.sizeBytes / Math.max(1, t.durationMs / 1000);
  if (bytesPerSec < QUIET_TAKE_BYTES_PER_SEC) return { offer: true, note: "silent" };
  return { offer: true, note: null };
}

export function takeNoteText(note: TakeNote): string | null {
  if (note === "short") return "This take is very short. Was your mic on?";
  if (note === "silent") return "This take sounds very quiet or silent. Was your mic on?";
  return null;
}
