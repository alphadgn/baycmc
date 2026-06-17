import { isAddress, getAddress } from "viem";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runOtherpageCheckAndPersist } from "@/server/otherpage.server";
import { runLuminaCheckAndPersist } from "@/server/lumina.server";
import { resolveOwnership, touchLinkedWallets } from "@/server/ownership/resolveOwnership";
import { collectionLabel } from "@/server/ownership/collections";

/**
 * Persisted snapshot shape (kept for backwards compatibility with existing
 * callers — `_verified` layout, livekit fn, hooks). The actual ownership
 * resolution lives in `src/server/ownership/resolveOwnership.ts` which is
 * the single source of truth.
 */
export interface OwnershipSnapshot {
  wallet: string | null;
  tokenProof: boolean;
  collection: "BAYC" | "MAYC" | null;
  delegationVerified: boolean;
  delegationVault: string | null;
  linkedHolder: string | null;
  otherpageVerified: boolean;
  reason: string | null;
}

export async function recomputeOwnership(userId: string): Promise<OwnershipSnapshot> {
  const result = await resolveOwnership(userId);

  // Find the "winning" row — direct holder on the connected wallet wins;
  // anything else flags delegation/linked attribution for the UI banner.
  const connectedLower = result.connected?.toLowerCase() ?? null;
  const linkedSet = new Set(result.linked.map((a) => a.toLowerCase()));
  const winner =
    result.ownership.find((o) => connectedLower && o.wallet.toLowerCase() === connectedLower) ??
    result.ownership[0] ??
    null;

  let delegationVault: string | null = null;
  let linkedHolder: string | null = null;
  if (winner && (!connectedLower || winner.wallet.toLowerCase() !== connectedLower)) {
    const wLower = winner.wallet.toLowerCase();
    if (linkedSet.has(wLower)) {
      linkedHolder = getAddress(winner.wallet);
    } else {
      delegationVault = getAddress(winner.wallet);
    }
  }

  const collection = winner ? collectionLabel(winner.contract) : null;
  const tokenProof = result.allowed;

  const updates: {
    user_id: string;
    delegation_verified: boolean;
    delegation_vault: string | null;
    bayc_verified?: boolean;
    bayc_collection?: string | null;
    verified_at?: string | null;
  } = {
    user_id: userId,
    delegation_verified: !!delegationVault,
    delegation_vault: delegationVault,
  };
  if (tokenProof) {
    updates.bayc_verified = true;
    updates.bayc_collection = collection;
    updates.verified_at = new Date().toISOString();
  } else if (result.scanned.length > 0) {
    // Only flip to false on a real scan — never on RPC outages (scanned=[]).
    updates.bayc_verified = false;
    updates.bayc_collection = null;
    updates.verified_at = null;
  }

  await supabaseAdmin.from("user_verifications").upsert(updates, { onConflict: "user_id" });
  if (result.linked.length > 0) {
    touchLinkedWallets(userId).catch(() => {});
  }

  // Re-evaluate Otherpage on the ape-holder wallet (signer, vault, or linked).
  const apeWallet =
    (winner && isAddress(winner.wallet) ? (getAddress(winner.wallet) as `0x${string}`) : null) ??
    (result.connected as `0x${string}` | null);
  let otherpageVerified = false;
  if (apeWallet) {
    try {
      const op = await runOtherpageCheckAndPersist({ userId, wallet: apeWallet });
      otherpageVerified = op.verified;
    } catch (e) {
      console.error("recompute: otherpage check failed", e);
    }
    runLuminaCheckAndPersist({ userId, wallet: apeWallet }).catch(() => {});
  }

  return {
    wallet: result.connected,
    tokenProof,
    collection,
    delegationVerified: !!delegationVault,
    delegationVault,
    linkedHolder,
    otherpageVerified,
    reason: tokenProof
      ? null
      : result.scanned.length === 0
        ? "rpc-unavailable-prior-state-preserved"
        : "no-ownership-across-walked-graph",
  };
}

// Re-export the engine result type for callers that want the full graph.
export type { OwnershipResult } from "@/server/ownership/resolveOwnership";
