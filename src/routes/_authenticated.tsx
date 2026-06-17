import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    // SSR has no access to localStorage where the Supabase session lives, so
    // getSession() always returns null on the server. Hard-redirecting from
    // here on every SSR request causes a redirect-only HTML response that
    // manifests as a black screen + "TypeError: Load failed" flood on iOS
    // Safari. Defer the check to the client where the session is hydrated;
    // AuthRedirectWatcher handles the unauthenticated case after mount.
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/", search: { redirect: location.href } as never });
    }
  },
  component: () => <Outlet />,
});
