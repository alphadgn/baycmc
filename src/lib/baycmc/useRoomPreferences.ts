import { useCallback, useEffect, useState } from "react";
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
 * Per-user persisted mic/camera defaults for conference rooms.
 *
 * Reads from localStorage on mount and on user change so a returning user
 * lands in the same audio/video state they left in. Toggling within a room
 * writes back immediately so the next room (or next session) inherits it.
 */
export function useRoomPreferences() {
  const { user } = useAuth();
  const [prefs, setPrefsState] = useState<RoomPreferences>(() => readPrefs(user?.id ?? null));

  useEffect(() => {
    setPrefsState(readPrefs(user?.id ?? null));
  }, [user?.id]);

  const setPrefs = useCallback(
    (patch: Partial<RoomPreferences>) => {
      setPrefsState((prev) => {
        const next = { ...prev, ...patch };
        writePrefs(user?.id ?? null, next);
        return next;
      });
    },
    [user?.id],
  );

  return { prefs, setPrefs };
}
