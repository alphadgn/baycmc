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
  /**
   * A wallet the member just proved by signature in this session. Labels
   * that wallet (or its delegations) holds are ADDED; every other check is
   * loss-only.
   */
  addedWallet?: string;
}

// ── Session wallets ────────────────────────────────────────────────────────
// Wallets proven by signature in the CURRENT sign-in session. Only these
// (and their delegate.xyz delegations) count toward access. Server-only.

/**
 * Start of a sign-in session: forget every earlier wallet proof. The
 * signer counts, plus any wallets attached to the Glyph account that
 * signed in (confirmed server-side with this sign-in's Glyph token).
 */
export async function startSessionWallets(
  userId: string,
  signer: string | null,
  attached: string[] = [],
) {
  await supabaseAdmin.from("session_wallets").delete().eq("user_id", userId);
  const rows = [
    ...new Set(
      [signer, ...attached]
        .filter((a): a is string => !!a && isAddress(a))
        .map((a) => a.toLowerCase()),
    ),
  ].map((address) => ({ user_id: userId, address }));
  if (rows.length > 0) {
    await supabaseAdmin.from("session_wallets").upsert(rows, { onConflict: "user_id,address" });
  }
}
export async function addSessionWallet(userId: string, address: string) {
  if (!isAddress(address)) return;
  await supabaseAdmin
    .from("session_wallets")
    .upsert(
      { user_id: userId, address: address.toLowerCase(), proven_at: new Date().toISOString() },
      { onConflict: "user_id,address" },
    );
}
export async function removeSessionWallet(userId: string, address: string) {
  if (!isAddress(address)) return;
  await supabaseAdmin
    .from("session_wallets")
    .delete()
    .eq("user_id", userId)
    .eq("address", address.toLowerCase());
}
export async function clearSessionWallets(userId: string) {
  await supabaseAdmin.from("session_wallets").delete().eq("user_id", userId);
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

  // Every whitelisted collection held anywhere in this session's graph.
  const heldLabels = new Set<string>(
    result.ownership
      .map((o) => collectionLabel(o.contract))
      .filter((l): l is NonNullable<typeof l> => !!l),
  );
  for (const l of opts.confirmedLabels ?? []) heldLabels.add(l);
  const failed = new Set(result.failedContracts.map((c) => c.toLowerCase()));

  const { data: prevRow } = opts.fresh
    ? { data: null }
    : await supabaseAdmin
        .from("user_verifications")
        .select("verified_collections, otherpage_verified")
        .eq("user_id", userId)
        .maybeSingle();
  const prev = new Set<string>((prevRow?.verified_collections as string[] | null) ?? []);

  // Mid-session checks never ADD access (a purchase counts from the next
  // sign-in) — they only detect losses. A check that ERRORED for a
  // collection is "unknown", not "0", so that collection is kept.
  // Exception: a wallet proven by signature just now adds what it holds.
  let finalLabels: Set<string>;
  if (opts.fresh) {
    finalLabels = heldLabels;
  } else if (result.scanned.length === 0) {
    finalLabels = prev; // nothing to check against — change nothing
  } else {
    finalLabels = new Set(
      [...prev].filter((label) => {
        if (heldLabels.has(label)) return true;
        const col = ALLOWED_COLLECTIONS.find((c) => c.label === label);
        return !!col && failed.has(col.contract.toLowerCase());
      }),
    );
    if (opts.addedWallet && isAddress(opts.addedWallet)) {
      const added = opts.addedWallet.toLowerCase();
      const reach = new Set<string>([added]);
      for (const e of result.edges) {
        if (e.via === "delegate-in" && e.to.toLowerCase() === added)
          reach.add(e.from.toLowerCase());
        if (e.via === "delegate-out" && e.from.toLowerCase() === added)
          reach.add(e.to.toLowerCase());
      }
      for (const o of result.ownership) {
        const l = collectionLabel(o.contract);
        if (l && reach.has(o.wallet.toLowerCase())) finalLabels.add(l);
      }
    }
  }
  const collections = ALLOWED_COLLECTIONS.map((c) => c.label).filter((l) => finalLabels.has(l));
  // Holder clubhouse access (bayc_verified) comes ONLY from full-access
  // collections (BAYC / MAYC / CryptoPunks). Partner collections (Temp
  // Agency, Orca Business, Ugly Duck Labs) are recorded and shown as
  // verified, but unlock just the regular menu + Ape Rides.
  const fullLabels = collections.filter((l) => FULL_ACCESS_LABELS.includes(l));
  const collection = fullLabels[0] ?? collections[0] ?? null;
  const tokenProof = fullLabels.length > 0;
  const write = opts.fresh || result.scanned.length > 0;

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
  if (write) {
    updates.verified_collections = collections;
    updates.bayc_verified = tokenProof;
    updates.bayc_collection = collection; // partner label (or null)
    updates.verified_at = tokenProof ? new Date().toISOString() : null;
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
      // Mid-session checks are loss-only here too: a Lifer token that
      // appears mid-session counts from the next sign-in.
      if (!opts.fresh && !opts.addedWallet && op.verified && !prevRow?.otherpage_verified) {
        await supabaseAdmin
          .from("user_verifications")
          .update({ otherpage_verified: false })
          .eq("user_id", userId);
        otherpageVerified = false;
      }
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
