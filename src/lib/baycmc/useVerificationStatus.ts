import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { revalidateOwnership } from "@/server/verification.functions";

export type BaycCollection = "BAYC" | "MAYC" | null;

export interface VerificationStatus {
  loading: boolean;
  tokenProof: boolean; // BAYC or MAYC verified
  collection: BaycCollection; // which collection Tokenproof attested
  otherpage: boolean;
  isLifer: boolean; // both
  refresh: () => Promise<void>;
}

/**
 * Verification status for the current user. Drives access to gated UI.
 *
 * Note: this is a UI hint only. All actual access control is enforced
 * server-side via RLS (see `is_token_proof_verified` and `is_lifer` SQL
 * helpers) and per-request Token Proof checks.
 */
export function useVerificationStatus(): VerificationStatus {
  const { user, loading: authLoading } = useAuth();
  const [tokenProof, setTokenProof] = useState(false);
  const [collection, setCollection] = useState<BaycCollection>(null);
  const [otherpage, setOtherpage] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!user) {
      setTokenProof(false);
      setCollection(null);
      setOtherpage(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Force a fresh on-chain + delegate.cash recompute so revoked
    // delegations or transferred apes flip the row immediately. Falls back
    // to the stored row on error.
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
    setTokenProof(!!data?.bayc_verified);
    setOtherpage(!!data?.otherpage_verified);
    setCollection(
      (data?.bayc_collection as BaycCollection | undefined) ?? null,
    );
    setLoading(false);
  }

  useEffect(() => {
    if (authLoading) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);

  return {
    loading: authLoading || loading,
    tokenProof,
    collection,
    otherpage,
    isLifer: tokenProof && otherpage,
    refresh: load,
  };
}

