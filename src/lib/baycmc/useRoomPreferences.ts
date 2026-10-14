import { useCallback, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth/useAuth";

export interface RoomPreferences {
  /** Microphone enabled on join. */
  micEnabled: boolean;
  /** Camera enabled on join. */
  cameraEnabled: boolean;
  /** Apply these preferences to every room (otherwise prompt per room). */
  applyToAll: boolean;
  /** Last-used audio input device id. null = system default. */
  audioInputDeviceId: string | null;
  /** Last-used video input device id. null = system default. */
  videoInputDeviceId: string | null;
}

const DEFAULT_PREFS: RoomPreferences = {
  micEnabled: true,
  cameraEnabled: true,
  applyToAll: true,
  audioInputDeviceId: null,
  videoInputDeviceId: null,
};

function storageKey(userId: string | null | undefined) {
  return userId ? `baycmc:room-prefs:${userId}` : "baycmc:room-prefs:anon";
}

function readPrefs(userId: string | null | undefined): RoomPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<RoomPreferences>;
    return {
      micEnabled: parsed.micEnabled ?? DEFAULT_PREFS.micEnabled,
      cameraEnabled: parsed.cameraEnabled ?? DEFAULT_PREFS.cameraEnabled,
      applyToAll: parsed.applyToAll ?? DEFAULT_PREFS.applyToAll,
      audioInputDeviceId: parsed.audioInputDeviceId ?? DEFAULT_PREFS.audioInputDeviceId,
      videoInputDeviceId: parsed.videoInputDeviceId ?? DEFAULT_PREFS.videoInputDeviceId,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(userId: string | null | undefined, prefs: RoomPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    /* noop — quota / privacy mode */
  }
}

/**
 * Per-user persisted mic/camera preferences — ONE shared copy per user.
 *
 * Previously every component that called this hook kept its own private
 * copy in useState. The room's bottom bar, the preferences panel (mounted
 * twice on mobile) and the karaoke machine therefore disagreed about
 * whether the mic was on, and each one's "enforce my preference" effect
 * kept flipping the LiveKit mic back — the mic buttons didn't control each
 * other, and on iPhone every flip interrupted media playback (the karaoke
 * music started, then stopped). Now all callers read and write the same
 * store, so every mic control in the app shows and drives the same state.
 */
let cache: { key: string; prefs: RoomPreferences } | null = null;
const listeners = new Set<() => void>();

function current(userId: string | null | undefined): RoomPreferences {
  const key = storageKey(userId);
  if (!cache || cache.key !== key) cache = { key, prefs: readPrefs(userId) };
  return cache.prefs;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (cache && e.key === cache.key) {
      cache = null;
      cb();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Imperative setter for code outside React (same store as the hook). */
export function setRoomPreferences(
  userId: string | null | undefined,
  patch: Partial<RoomPreferences>,
) {
  const prev = current(userId);
  const next = { ...prev, ...patch };
  if ((Object.keys(next) as (keyof RoomPreferences)[]).every((k) => next[k] === prev[k])) return;
  cache = { key: storageKey(userId), prefs: next };
  writePrefs(userId, next);
  for (const l of listeners) l();
}

export function useRoomPreferences() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const prefs = useSyncExternalStore(
    subscribe,
    () => current(userId),
    () => DEFAULT_PREFS,
  );
  const setPrefs = useCallback(
    (patch: Partial<RoomPreferences>) => setRoomPreferences(userId, patch),
    [userId],
  );
  return { prefs, setPrefs };
}
