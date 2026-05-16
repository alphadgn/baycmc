import { useEffect, useState } from "react";
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
  refresh: () => Promise<void>;
}

/**
 * Verification status for the current user. Drives access to gated UI.
 *
 * UI hint only — actual access control is enforced server-side by RLS
 * (`is_verified_holder`, `is_lifer`) and per-request server fns.
 */
export function useVerificationStatus(): VerificationStatus {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [isVerifiedHolder, setIsVerifiedHolder] = useState(false);
  const [collection, setCollection] = useState<BaycCollection>(null);
  const [otherpage, setOtherpage] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) {
      setIsVerifiedHolder(false);
      setCollection(null);
      setOtherpage(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      await revalidateOwnership();
    } catch (e) {
      console.warn("revalidateOwnership failed, using cached row", e);
    }
    const { data } = await supabase
      .from("user_verifications")
      .select("bayc_verified, otherpage_verified, bayc_collection")
      .eq("user_id", user.id)
      .maybeSingle();
    setIsVerifiedHolder(!!data?.bayc_verified);
    setOtherpage(!!data?.otherpage_verified);
    setCollection((data?.bayc_collection as BaycCollection | undefined) ?? null);
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

  return {
    loading: authLoading || loading,
    isVerifiedHolder,
    isLobby: isAuthenticated && !isVerifiedHolder,
    tokenProof: isVerifiedHolder,
    collection,
    otherpage,
    isLifer: isVerifiedHolder && otherpage,
    refresh: load,
  };
}
