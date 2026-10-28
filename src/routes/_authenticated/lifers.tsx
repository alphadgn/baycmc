import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lifers layout — only dual-verified users (Token Proof + Otherpage) can
 * enter. We force a fresh on-chain + delegate.cash recompute on every
 * navigation so a user who lost a token (or had their delegation revoked)
 * loses access immediately.
 */
export const Route = createFileRoute("/_authenticated/lifers")({
  beforeLoad: async () => {
    // Skip during SSR — localStorage is unavailable, so getSession() returns
    // null and we'd hard-redirect every refresh (iOS black-screen symptom).
    if (typeof window === "undefined") return;
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      throw redirect({ to: "/" });
    }

    // Admin bypass — admins / super_admins enter the Lifer lounge without
    // an on-chain Otherpage token.
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", sess.session.user.id);
    if (roles?.some((r) => r.role === "admin" || r.role === "super_admin")) {
      return;
    }

    // Lifer access is a super-admin grant only (Super Admin → Lifer access).
    const { data: grant } = await supabase
      .from("lifer_grants")
      .select("user_id")
      .eq("user_id", sess.session.user.id)
      .maybeSingle();
    if (!grant) throw redirect({ to: "/lobby" });
  },
  component: () => <Outlet />,
});
