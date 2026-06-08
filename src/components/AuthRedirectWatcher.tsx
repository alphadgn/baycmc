import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * App-wide listener that bounces the user back to the landing page (`/`)
 * the moment their Supabase session ends — regardless of cause:
 *   • explicit "Disconnect" from the wallet pill menu
 *   • inactivity timeout from <InactivityWatcher />
 *   • a refresh-token failure
 *   • another tab signing out
 *
 * Mounted once at the app root. Doesn't redirect if the user is already
 * on a public route, so we don't fight the router's natural flow.
 */
const PUBLIC_ROUTES = new Set<string>(["/", "/diagnostics"]);

export function AuthRedirectWatcher() {
  const router = useRouter();
  // Track previous session state so we only redirect on the set→null
  // transition, not on initial mount (where session is `null` until the
  // first fetch resolves) and not on the SIGNED_IN event.
  const hadSessionRef = useRef<boolean | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      hadSessionRef.current = !!data.session;
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const hasSession = !!session;
      const wasSignedIn = hadSessionRef.current === true;
      hadSessionRef.current = hasSession;

      const current = router.state.location.pathname;

      // On a fresh sign-in (transition from no-session → session), land
      // the user at the top of the lobby. The lobby is the post-auth
      // home page for every member. Skip if they're already deep in the
      // app on an authenticated route.
      if (hasSession && !wasSignedIn && event === "SIGNED_IN") {
        if (current === "/" || current === "/login") {
          void router.navigate({ to: "/lobby", replace: true });
        }
        return;
      }

      // We only care about transitions to "no session" from a previously
      // signed-in state. SIGNED_OUT, USER_DELETED, and refresh failures
      // all emit a null session — we route them all to `/`.
      if (hasSession) return;
      if (!wasSignedIn) return;

      if (PUBLIC_ROUTES.has(current)) return;

      // Use `replace: true` so the back button doesn't take the user
      // straight back into a now-unauthorized route.
      void router.navigate({ to: "/", replace: true });
      // Light log for debugging — visible in /diagnostics if anything
      // ever feels off about the redirect cause.
      console.info("[AuthRedirectWatcher] redirected to / on", event);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [router]);

  return null;
}
