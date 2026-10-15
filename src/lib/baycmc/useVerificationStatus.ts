import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationRevalidation } from "@/hooks/useVerificationRevalidation";
import { revalidateOwnership } from "@/server/verification.functions";

export type BaycCollection = string | null;
export interface VerificationStatus {
  loading: boolean;
  error: string | null;
  isVerifiedHolder: boolean;
  isLobby: boolean;
  tokenProof: boolean;
  collection: BaycCollection;
  /** Every whitelisted collection verified for this account (labels). */
  collections: string[];
  otherpage: boolean;
  lumina: boolean;
  delegationVerified: boolean;
  isLifer: boolean;
  isAdmin: boolean;
  roles: string[];
  refresh: () => Promise<void>;
}
const VerificationContext = createContext<VerificationStatus | null>(null);

/** One live snapshot for every verification display. Access remains enforced server-side. */
export function VerificationStatusProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const revalidate = useServerFn(revalidateOwnership);
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  const userId = user?.id;
  const queryKey = ["verification-status", userId];
  const query = useQuery({
    queryKey,
    enabled: !!userId && !authLoading,
    staleTime: 60_000,
    retry: 2,
    refetchOnReconnect: true,
    queryFn: async () => {
      if (!userId) throw new Error("Sign in to load verification");
      const [ver, roles] = await Promise.all([
        supabase
          .from("user_verifications")
          .select(
            "bayc_verified, bayc_collection, verified_collections, otherpage_verified, lumina_verified, delegation_verified",
          )
          .eq("user_id", userId)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);
      if (ver.error) throw new Error(ver.error.message);
      if (roles.error) throw new Error(roles.error.message);
      return { verification: ver.data, roles: (roles.data ?? []).map((r) => r.role) };
    },
  });
  const readLatest = async () => {
    await queryClient.invalidateQueries({ queryKey: ["verification-status", userId] });
  };
  const refresh = async () => {
    if (!userId) return;
    try {
      await revalidateRef.current();
    } finally {
      await readLatest();
    }
  };
  useVerificationRevalidation({ userId, onRevalidate: readLatest });
  useEffect(() => {
    if (authLoading || !userId) return;
    void refresh().catch((error) => console.warn("Ownership refresh failed", error));
    // One ownership recomputation per identity, not per consumer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, authLoading]);

  const roles = query.data?.roles ?? [];
  const ver = query.data?.verification;
  const isAdmin = roles.some((role) => role === "admin" || role === "super_admin");
  const isVerifiedHolder = !!ver?.bayc_verified || isAdmin;
  const value: VerificationStatus = {
    loading: authLoading || (!!userId && query.isPending),
    error: query.error?.message ?? null,
    isVerifiedHolder,
    isLobby: isAuthenticated && !isVerifiedHolder,
    tokenProof: isVerifiedHolder,
    collection: ver?.bayc_collection ?? null,
    collections:
      ver?.verified_collections && ver.verified_collections.length > 0
        ? ver.verified_collections
        : ver?.bayc_collection
          ? [ver.bayc_collection]
          : [],
    otherpage: !!ver?.otherpage_verified,
    lumina: !!ver?.lumina_verified,
    delegationVerified: !!ver?.delegation_verified,
    isLifer: (!!ver?.bayc_verified && !!ver?.otherpage_verified) || isAdmin,
    isAdmin,
    roles,
    refresh,
  };
  return createElement(VerificationContext.Provider, { value }, children);
}

export function useVerificationStatus(): VerificationStatus {
  const status = useContext(VerificationContext);
  if (!status) throw new Error("VerificationStatusProvider is required");
  return status;
}
