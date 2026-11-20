/**
 * Pure client-side rules for the karaoke waiver cache (see waiverStatus.ts).
 * The server (karaoke_waiver_ok) is authoritative; these only decide when the
 * app should show the waiver again.
 */
/** Bump together with a karaoke_waiver_versions row whenever the wording changes. */
export const KARAOKE_WAIVER_VERSION = "2026-11-20-1";

export type WaiverStatus = "unknown" | "checking" | "accepted" | "needed";

export interface WaiverState {
  userId: string | null;
  status: WaiverStatus;
  /** Version the server currently requires (null until known). */
  serverVersion: string | null;
}

export type WaiverEvent =
  | { type: "user"; userId: string | null }
  | { type: "checking" }
  | { type: "status"; accepted: boolean; version: string | null }
  | { type: "status-error" }
  | { type: "accepted"; version: string }
  | { type: "required" }
  | { type: "signed-out" };

export const INITIAL_WAIVER_STATE: WaiverState = {
  userId: null,
  status: "unknown",
  serverVersion: null,
};

export function waiverReducer(s: WaiverState, e: WaiverEvent): WaiverState {
  switch (e.type) {
    case "user":
      // A different account (or none) never inherits the previous answer.
      return e.userId === s.userId ? s : { ...INITIAL_WAIVER_STATE, userId: e.userId };
    case "signed-out":
      return { ...INITIAL_WAIVER_STATE };
    case "checking":
      return s.status === "accepted" ? s : { ...s, status: "checking" };
    case "status":
      return {
        ...s,
        status: e.accepted ? "accepted" : "needed",
        serverVersion: e.version ?? s.serverVersion,
      };
    case "status-error":
      // Can't tell: ask (the server still refuses anyone without a valid waiver).
      return s.status === "accepted" ? s : { ...s, status: "needed" };
    case "accepted":
      return { ...s, status: "accepted", serverVersion: e.version };
    case "required":
      // The server refused an action for lack of a waiver (signed out on
      // another device, or a new waiver version went live mid-session).
      return { ...s, status: "needed" };
    default:
      return s;
  }
}

/** Should the waiver be shown before letting this member sing? */
export function waiverNeeded(s: WaiverState, clientVersion = KARAOKE_WAIVER_VERSION): boolean {
  if (s.status !== "accepted") return true;
  return s.serverVersion !== null && s.serverVersion !== clientVersion;
}

/** Server error text that means "accept the waiver first". */
export function isWaiverError(message: string | null | undefined): boolean {
  return !!message && /WAIVER_REQUIRED|performance waiver/i.test(message);
}
