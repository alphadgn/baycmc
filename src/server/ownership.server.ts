import { isAddress, getAddress } from "viem";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runOtherpageCheckAndPersist } from "@/server/otherpage.server";
import { runLuminaCheckAndPersist } from "@/server/lumina.server";
import { resolveOwnership, touchLinkedWallets } from "@/server/ownership/resolveOwnership";
import { collectionLabel } from "@/server/ownership/collections";
import { ALLOWED_COLLECTIONS, FULL_ACCESS_LABELS } from "@/lib/web3/constants";

/**
 * Persisted snapshot shape (kept for backwards compatibility with existing
 * callers — `_verified` layout, livekit fn, hooks). The actual ownership
 * resolution lives in `src/server/ownership/resolveOwnership.ts` which is
 * the single source of truth.
 */
export interface OwnershipSnapshot {
  wallet: string | null;
  tokenProof: boolean;
  collection: string | null;
  collections: string[];
  delegationVerified: boolean;
  delegationVault: string | null;
  linkedHolder: string | null;
  otherpageVerified: boolean;
  reason: string | null;
}

export interface RecomputeOptions {
  /**
   * Start of a sign-in session: decide access from THIS check only. Nothing
   * verified in an earlier session is carried over, and a check that errors
   * grants nothing (fail closed).
   */
  fresh?: boolean;
  /** Labels positively confirmed on-chain moments ago in the same request. */
  confirmedLabels?: string[];
}

export async function recomputeOwnership(
  userId: string,
  opts: RecomputeOptions = {},
): Promise<OwnershipSnapshot> {
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

  // EVERY whitelisted collection held anywhere in the walked graph, in
  // allowlist order (previously only the first hit was stored, so a wallet
  // holding several collections showed just one).
  const heldLabels = new Set<string>(
    result.ownership
      .map((o) => collectionLabel(o.contract))
      .filter((l): l is NonNullable<typeof l> => !!l),
  );
  // A check that ERRORED (RPC outage / rate limit) is "unknown", not "0":
  // keep whatever was verified for that collection before, so a flaky node
  // can't silently strip a collection the member really holds.
  for (const l of opts.confirmedLabels ?? []) heldLabels.add(l);
  const failed = new Set(result.failedContracts.map((c) => c.toLowerCase()));
  // Within a session only: the stored labels were verified earlier in THIS
  // session (they are wiped at every sign-in and sign-out), so a transient
  // RPC error mid-session doesn't kick a member out of a room.
  if (failed.size > 0 && !opts.fresh) {
    const { data: prev } = await supabaseAdmin
      .from("user_verifications")
      .select("verified_collections")
      .eq("user_id", userId)
      .maybeSingle();
    for (const label of (prev?.verified_collections as string[] | null) ?? []) {
      const col = ALLOWED_COLLECTIONS.find((c) => c.label === label);
      if (col && failed.has(col.contract.toLowerCase())) heldLabels.add(col.label);
    }
  }
  const collections = ALLOWED_COLLECTIONS.map((c) => c.label).filter((l) => heldLabels.has(l));
  // Holder clubhouse access (bayc_verified) comes ONLY from full-access
  // collections (BAYC / MAYC / CryptoPunks). Partner collections (Temp
  // Agency, Orca Business, Ugly Duck Labs) are recorded and shown as
  // verified, but unlock just the regular menu + Ape Rides.
  const fullLabels = collections.filter((l) => FULL_ACCESS_LABELS.includes(l));
  const collection = fullLabels[0] ?? collections[0] ?? null;
  const tokenProof = fullLabels.length > 0;

  const updates: {
    user_id: string;
    delegation_verified: boolean;
    delegation_vault: string | null;
    bayc_verified?: boolean;
    bayc_collection?: string | null;
    verified_collections?: string[];
    verified_at?: string | null;
  } = {
    user_id: userId,
    delegation_verified: !!delegationVault,
    delegation_vault: delegationVault,
  };
  if (result.scanned.length > 0 || opts.fresh) updates.verified_collections = collections;
  if (tokenProof) {
    updates.bayc_verified = true;
    updates.bayc_collection = collection;
    updates.verified_at = new Date().toISOString();
  } else if (opts.fresh || (result.scanned.length > 0 && failed.size === 0)) {
    // Only flip to false on a clean scan — never on RPC errors/outages.
    updates.bayc_verified = false;
    updates.bayc_collection = collection; // partner label (or null)
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
    collections,
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
