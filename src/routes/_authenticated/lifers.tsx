import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { revalidateOwnership } from "@/server/verification.functions";

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

    let snap: Awaited<ReturnType<typeof revalidateOwnership>> | null = null;
    try {
      snap = await revalidateOwnership();
    } catch (e) {
      console.warn("lifers beforeLoad: revalidate failed, falling back to cache", e);
    }
    if (snap) {
      if (!snap.tokenProof || !snap.otherpageVerified) {
        throw redirect({ to: "/feed" });
      }
      return;
    }
    const { data } = await supabase
      .from("user_verifications")
      .select("bayc_verified, otherpage_verified")
      .eq("user_id", sess.session.user.id)
      .maybeSingle();
    if (!data?.bayc_verified || !data?.otherpage_verified) {
      throw redirect({ to: "/feed" });
    }
  },
  component: () => <Outlet />,
});
