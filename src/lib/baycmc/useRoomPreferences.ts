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
// One entry PER storage key. A single shared slot thrashed when two mounted
// components briefly disagreed about the signed-in user (null vs id while
// auth hydrates): each getSnapshot call evicted the other's entry and
// returned a fresh object, which useSyncExternalStore treats as "the store
// changed during render" → endless re-render → React error #185 on join.
const cache = new Map<string, RoomPreferences>();
const listeners = new Set<() => void>();
let lastUserId: string | null = null;

function current(userId: string | null | undefined): RoomPreferences {
  const key = storageKey(userId);
  let prefs = cache.get(key);
  if (!prefs) {
    prefs = readPrefs(userId);
    cache.set(key, prefs);
  }
  return prefs;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key && cache.has(e.key)) {
      cache.delete(e.key);
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
  cache.set(storageKey(userId), next);
  writePrefs(userId, next);
  for (const l of listeners) l();
}

export function useRoomPreferences() {
  const { user, loading } = useAuth();
  // useAuth() is per-component and starts at null until the session loads.
  // While it loads, keep using the last signed-in user's prefs so a freshly
  // mounted control doesn't briefly apply the anonymous prefs (and flip the
  // mic) as the room connects.
  if (user?.id) lastUserId = user.id;
  const userId = user?.id ?? (loading ? lastUserId : null);
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
