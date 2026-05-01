import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lifers layout — only dual-verified users (Token Proof + Otherpage) can
 * enter. The check runs server-side via RLS on user_verifications.
 *
 * We re-check on every navigation so a user who lost a token loses access.
 */
export const Route = createFileRoute("/_authenticated/lifers")({
  beforeLoad: async () => {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      throw redirect({ to: "/" });
    }
    const { data } = await supabase
      .from("user_verifications")
      .select("bayc_verified, otherpage_verified")
      .eq("user_id", sess.session.user.id)
      .maybeSingle();
    if (!data?.bayc_verified || !data?.otherpage_verified) {
      throw redirect({ to: "/" });
    }
  },
  component: () => <Outlet />,
});
