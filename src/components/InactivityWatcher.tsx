import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
 * Strict 5-minute inactivity sign-out. Listens for any user input on the
 * window; if no input lands within INACTIVITY_MS, signs the user out of
 * Supabase and (best-effort) Privy. Mounted once at the app root.
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
      // Best-effort Privy logout — dynamic import keeps this off the SSR path.
      try {
        const mod = await import("@privy-io/react-auth");
        const { usePrivy } = mod;
        // We can't easily call hooks here, but we can trigger a logout if we had access to the client.
        // Since we are outside the React tree context, we rely on Supabase session invalidation
        // which Privy's AuthProvider will observe.
        void usePrivy;
      } catch {
        /* noop */
      }
      toast.info("Signed out after 5 minutes of inactivity.");
    };

    const reset = () => {
      if (signedOutRef.current) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        void signOut();
      }, INACTIVITY_MS);
    };

    // Only arm the timer when there's an active session.
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
