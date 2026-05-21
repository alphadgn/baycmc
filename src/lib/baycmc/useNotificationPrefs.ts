import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/useAuth";

export interface NotificationPrefs {
  /** Master switch — when off, the global Sonner toaster is unmounted and
   *  no toasts surface anywhere in the app. */
  toastsEnabled: boolean;
  /** Audible chirp on toast (browsers without the WebAudio API silently
   *  ignore this). Kept separate from `toastsEnabled` so a user can mute
   *  sound without losing visible alerts. */
  soundEnabled: boolean;
  /** Show room-join / leave activity toasts. Many users find them noisy. */
  roomActivityEnabled: boolean;
}

const DEFAULTS: NotificationPrefs = {
  toastsEnabled: true,
  soundEnabled: false,
  roomActivityEnabled: true,
};

function storageKey(userId: string | null | undefined) {
  return userId ? `baycmc:notif-prefs:${userId}` : "baycmc:notif-prefs:anon";
}

function readPrefs(userId: string | null | undefined): NotificationPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      toastsEnabled: parsed.toastsEnabled ?? DEFAULTS.toastsEnabled,
      soundEnabled: parsed.soundEnabled ?? DEFAULTS.soundEnabled,
      roomActivityEnabled: parsed.roomActivityEnabled ?? DEFAULTS.roomActivityEnabled,
    };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(userId: string | null | undefined, prefs: NotificationPrefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
    // Cross-component sync: anyone listening (e.g. the global Toaster
    // gate in __root.tsx) re-reads on this event.
    window.dispatchEvent(new Event("baycmc:notif-prefs-changed"));
  } catch {
    /* quota / private mode — best effort */
  }
}

/**
 * Per-user persisted notification preferences. Same pattern as
 * `useRoomPreferences`: reads localStorage on mount, re-reads when the
 * signed-in user changes, and writes back on every patch so the next
 * session inherits the choice without re-toggling.
 */
export function useNotificationPrefs() {
  const { user } = useAuth();
  const [prefs, setPrefsState] = useState<NotificationPrefs>(() =>
    readPrefs(user?.id ?? null),
  );

  useEffect(() => {
    setPrefsState(readPrefs(user?.id ?? null));
  }, [user?.id]);

  // Stay in sync with writes from other components / tabs.
  useEffect(() => {
    function refresh() {
      setPrefsState(readPrefs(user?.id ?? null));
    }
    window.addEventListener("baycmc:notif-prefs-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("baycmc:notif-prefs-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [user?.id]);

  const setPrefs = useCallback(
    (patch: Partial<NotificationPrefs>) => {
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
