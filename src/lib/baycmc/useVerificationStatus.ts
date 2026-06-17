import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { revalidateOwnership } from "@/server/verification.functions";

export type BaycCollection = "BAYC" | "MAYC" | null;

export interface VerificationStatus {
  loading: boolean;
  /** Tier 2 — owns BAYC/MAYC (or has a delegate.cash vault that does). */
  isVerifiedHolder: boolean;
  /** Tier 1 — signed in but not a verified holder. */
  isLobby: boolean;
  /** @deprecated use `isVerifiedHolder` — kept as alias while callers migrate. */
  tokenProof: boolean;
  collection: BaycCollection;
  otherpage: boolean;
  /** Tier 3 — verified holder + Otherpage / Lifer token. */
  isLifer: boolean;
  /** Has admin or super_admin role. */
  isAdmin: boolean;
  refresh: () => Promise<void>;
}

/**
 * Verification status for the current user. Drives access to gated UI.
 *
 * UI hint only — actual access control is enforced server-side by RLS
 * (`is_verified_holder`, `is_lifer`) and per-request server fns.
 *
 * Role overlay: `admin` / `super_admin` users bypass BOTH the BAYC and the
 * Lifer gate (they administer the clubhouse and need access everywhere
 * without holding tokens themselves). `verified_user` role currently has
 * no overlay here — the BAYC gate is checked by the underlying RLS helper
 * `is_verified_holder()` which already grants the verified_user role.
 */
export function useVerificationStatus(): VerificationStatus {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [baycVerified, setBaycVerified] = useState(false);
  const [collection, setCollection] = useState<BaycCollection>(null);
  const [otherpage, setOtherpage] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) {
      setBaycVerified(false);
      setCollection(null);
      setOtherpage(false);
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await revalidateOwnership();
    } catch (e) {
      console.warn("revalidateOwnership failed, using cached row", e);
    }
    const [{ data: ver }, { data: roles }] = await Promise.all([
      supabase
        .from("user_verifications")
        .select("bayc_verified, otherpage_verified, bayc_collection")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    setBaycVerified(!!ver?.bayc_verified);
    setOtherpage(!!ver?.otherpage_verified);
    setCollection((ver?.bayc_collection as BaycCollection | undefined) ?? null);
    setIsAdmin(!!roles?.some((r) => r.role === "admin" || r.role === "super_admin"));
    setLoading(false);
  }

  useEffect(() => {
    if (authLoading) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  // The Privy bridge fires this after an explicit re-verify (the
  // "Verify holder access" dropdown action). The user's id is unchanged,
  // so the [user?.id] effect above won't re-fire on its own.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      void load();
    };
    window.addEventListener("baycmc:verification-refresh", refresh);
    return () => window.removeEventListener("baycmc:verification-refresh", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Admin overlay: treat admins as if they hold BAYC + Lifer. Server-side
  // gates (RLS, livekit/bookings server fns) apply the same bypass.
  const isVerifiedHolder = baycVerified || isAdmin;
  const isLifer = (baycVerified && otherpage) || isAdmin;

  return {
    loading: authLoading || loading,
    isVerifiedHolder,
    isLobby: isAuthenticated && !isVerifiedHolder,
    tokenProof: isVerifiedHolder,
    collection,
    otherpage,
    isLifer,
    isAdmin,
    refresh: load,
  };
}
