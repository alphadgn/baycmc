import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { hasPartnerAccess } from "@/lib/web3/constants";
import { supabase } from "@/integrations/supabase/client";
import { revalidateOwnership } from "@/server/verification.functions";

/**
 * Verified-holder gate (Tier 2).
 *
 * Pathless layout — child routes (feed, messages, rooms, ape-rides)
 * keep their original URLs (/feed, /messages, /rooms, etc.) but require
 * a confirmed BAYC/MAYC ownership flag in user_verifications.
 *
 * On every navigation we force a fresh on-chain + delegate.cash recompute
 * so a transferred ape or revoked delegation drops the user back into the
 * lobby without needing to sign out.
 */
export const Route = createFileRoute("/_authenticated/_verified")({
  beforeLoad: async ({ location }) => {
    // Skip during SSR — localStorage is unavailable, so getSession() returns
    // null and we'd hard-redirect every refresh (iOS black-screen symptom).
    if (typeof window === "undefined") return;
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      throw redirect({ to: "/" });
    }

    // Admin bypass — admins administer the clubhouse and need access to
    // every verified-tier route without holding BAYC/MAYC themselves.
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
      console.warn("_verified beforeLoad: revalidate failed, falling back to cached row", e);
    }

    // Partner collections (Temp Agency, Orca Business, Ugly Duck Labs) get
    // Ape Rides only — every other verified-tier route stays BAYC/MAYC/Punks.
    const apeRides = location.pathname.startsWith("/ape-rides");

    if (snap) {
      if (snap.tokenProof) return;
      if (apeRides && hasPartnerAccess(snap.collections ?? [])) return;
      throw redirect({ to: "/lobby" });
    }

    // Fallback: trust the stored row when the on-chain check is unreachable.
    const { data } = await supabase
      .from("user_verifications")
      .select("bayc_verified, verified_collections")
      .eq("user_id", sess.session.user.id)
      .maybeSingle();
    if (data?.bayc_verified) return;
    if (apeRides && hasPartnerAccess(data?.verified_collections ?? [])) return;
    throw redirect({ to: "/lobby" });
  },
  component: () => <Outlet />,
});
