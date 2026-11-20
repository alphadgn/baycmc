/**
 * Karaoke performance waiver: accepted once per ACCOUNT sign-in.
 *
 * The server is authoritative (karaoke_waiver_ok, migration
 * 20261120000001): an acceptance counts while it is for the current waiver
 * version, it was made after the account's most recent sign-out, and at
 * least one of the account's sessions that existed when it was accepted is
 * still alive. Accepting on one device therefore covers the account's other
 * signed-in devices; any sign-out (which revokes every session) requires a
 * new acceptance, and so does a new waiver version.
 *
 * This module only caches the server's answer so the waiver isn't shown again
 * when the member leaves and re-enters a karaoke room.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

import {
  INITIAL_WAIVER_STATE,
  KARAOKE_WAIVER_VERSION,
  waiverNeeded,
  waiverReducer,
  type WaiverEvent,
  type WaiverState,
} from "@/lib/karaoke/waiverRules";

export {
  INITIAL_WAIVER_STATE,
  KARAOKE_WAIVER_VERSION,
  isWaiverError,
  waiverNeeded,
  waiverReducer,
} from "@/lib/karaoke/waiverRules";
export type { WaiverEvent, WaiverState, WaiverStatus } from "@/lib/karaoke/waiverRules";

// ── Store ───────────────────────────────────────────────────────────────────
let state: WaiverState = INITIAL_WAIVER_STATE;
let lastCheckAt = 0;
const listeners = new Set<() => void>();
function dispatch(e: WaiverEvent) {
  const next = waiverReducer(state, e);
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getState = () => state;

export function getWaiverState(): WaiverState {
  return state;
}

export async function refreshWaiverStatus(): Promise<WaiverState> {
  if (!state.userId) return state;
  const forUser = state.userId;
  dispatch({ type: "checking" });
  lastCheckAt = Date.now();
  const { data, error } = await supabase.rpc("karaoke_waiver_status");
  if (state.userId !== forUser) return state;
  if (error || !data || typeof data !== "object") dispatch({ type: "status-error" });
  else {
    const d = data as { accepted?: boolean; version?: string | null };
    dispatch({ type: "status", accepted: !!d.accepted, version: d.version ?? null });
  }
  return state;
}

/** Record acceptance of the waiver shown to the member. Returns an error message or null. */
export async function acceptKaraokeWaiver(): Promise<string | null> {
  const { error } = await supabase.rpc("accept_karaoke_waiver", {
    _version: KARAOKE_WAIVER_VERSION,
  });
  if (error) {
    if (/WAIVER_VERSION_OUTDATED/.test(error.message)) {
      return "The waiver has been updated. Reload the page to read the new version.";
    }
    return error.message;
  }
  dispatch({ type: "accepted", version: KARAOKE_WAIVER_VERSION });
  return null;
}

/** The server refused something because the waiver isn't valid any more. */
export function markWaiverRequired() {
  dispatch({ type: "required" });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("karaoke:waiver-required"));
}

let authWired = false;
function wireAuth() {
  if (authWired || typeof window === "undefined") return;
  authWired = true;
  supabase.auth.onAuthStateChange((evt, sess) => {
    if (evt === "SIGNED_OUT" || !sess) dispatch({ type: "signed-out" });
    else dispatch({ type: "user", userId: sess.user.id });
  });
}

/** Current waiver answer for the signed-in member (fetched once per sign-in). */
export function useKaraokeWaiver(userId: string | null | undefined) {
  wireAuth();
  const s = useSyncExternalStore(subscribe, getState, () => INITIAL_WAIVER_STATE);
  useEffect(() => {
    dispatch({ type: "user", userId: userId ?? null });
    if (userId && (getState().status === "unknown" || Date.now() - lastCheckAt > 60_000)) {
      void refreshWaiverStatus();
    }
  }, [userId]);
  const refresh = useCallback(() => refreshWaiverStatus(), []);
  return {
    status: s.status,
    needed: waiverNeeded(s),
    accepted: !waiverNeeded(s),
    refresh,
  };
}
