/**
 * Mudwater gate. Everything Mudwater is only for members signed in with a
 * blockchain wallet in this session (a Glyph sign-in attached to a wallet
 * counts). Email-only sessions don't see Mudwater at all and are sent to
 * the lobby. The server enforces the same rule on every Mudwater call.
 */
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/mudwater")({
  beforeLoad: async () => {
    // Skip during SSR — the session lives in the browser.
    if (typeof window === "undefined") return;
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) throw redirect({ to: "/" });
    const { data: ok } = await supabase.rpc("my_mudwater_access");
    if (!ok) throw redirect({ to: "/lobby" });
  },
  component: () => <Outlet />,
});
