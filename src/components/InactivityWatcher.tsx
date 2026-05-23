import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { clearWalletAuthLocalState } from "@/lib/auth/usePrivyBridge";

const INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes — strict
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "visibilitychange",
] as const;

/**
 * Strict 5-minute inactivity sign-out.
 *
 * On timeout we:
 *   1. Sign out of Supabase.
 *   2. Dispatch `baycmc:privy-logout` — the PrivyBridge handles this from
 *      inside Privy's React context and calls `logout()` for real.
 *   3. Synchronously wipe any persisted Privy / verify cache from
 *      localStorage so a refresh after timeout can never short-circuit
 *      back into the app without going through the Privy modal again.
 *
 * Without step 2+3 the prior implementation left the Privy session in
 * localStorage; reopening the app silently logged the user back in,
 * skipping the modal — a security gap.
 */
export function InactivityWatcher() {
  const timerRef = useRef<number | null>(null);
  const signedOutRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const signOut = async () => {
      if (signedOutRef.current) return;
      signedOutRef.current = true;
      try {
        await supabase.auth.signOut();
      } catch (e) {
        console.warn("[InactivityWatcher] supabase signOut failed", e);
      }
      // Hand off to the PrivyBridge to perform Privy logout from inside
      // the hook context, then nuke local caches as a belt-and-braces.
      try {
        window.dispatchEvent(new Event("baycmc:privy-logout"));
      } catch {
        /* noop */
      }
      clearWalletAuthLocalState();
      toast.info("Signed out after 5 minutes of inactivity.", {
        duration: 8000,
      });
    };

    const reset = () => {
      if (signedOutRef.current) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void signOut();
      }, INACTIVITY_MS);
    };

    let unsub: (() => void) | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) reset();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      if (sess) {
        signedOutRef.current = false;
        reset();
      } else if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    });
    unsub = () => sub.subscription.unsubscribe();

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      unsub?.();
    };
  }, []);

  return null;
}
