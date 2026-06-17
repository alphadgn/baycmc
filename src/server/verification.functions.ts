import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, fallback, getAddress, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BAYC_CONTRACT, DELEGATE_REGISTRY_V2 } from "@/lib/web3/constants";

/**
 * Force-recompute ownership for the authenticated user. Updates
 * user_verifications based on a fresh on-chain balanceOf + delegate.cash
 * lookup. Used by the client `useVerificationStatus` hook so a revoked
 * delegation propagates without requiring sign-out / sign-in.
 */
export const revalidateOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { recomputeOwnership } = await import("@/server/ownership.server");
    return recomputeOwnership(context.userId);
  });

/**
 * Returns the full wallet graph that drove the latest ownership decision —
 * connected wallet, verified linked wallets, delegate.cash edges, every
 * address scanned, and which (wallet, contract) pairs returned a positive
 * balance. Used by the /verify walkthrough so users can see exactly why
 * they did or did not get access.
 */
export const getOwnershipGraph = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { resolveOwnership } = await import("@/server/ownership/resolveOwnership");
    return resolveOwnership(context.userId);
  });

/**
 * Server-side verification helpers.
 *
 * Note: BAYC/MAYC ownership verification at the entrance is handled by
 * Tokenproof (`@/server/tokenproof.functions`). The functions here are
 * server-only utilities used by gated server routes (premium access checks,
 * delegate.cash, Otherpage admin gating). They are NOT called from the
 * Entrance dialog.
 */

function client() {
  const url = process.env.ETH_RPC_URL;
  if (!url) {
    throw new Error("Ethereum RPC is not configured.");
  }
  return createPublicClient({
    chain: mainnet,
    transport: http(url, { timeout: 8_000, retryCount: 1 }),
  });
}

const delegateAbi = parseAbi([
  "function checkDelegateForContract(address to, address from, address contract_, bytes32 rights) view returns (bool)",
]);

// ---------------------------------------------------------------------------
// Delegation (delegate.cash)
// ---------------------------------------------------------------------------

export const verifyDelegation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { delegate: string; vault: string }) =>
    z
      .object({
        delegate: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        vault: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const delegate = getAddress(data.delegate);
    const vault = getAddress(data.vault);

    let isDelegated = false;
    try {
      isDelegated = (await client().readContract({
        address: DELEGATE_REGISTRY_V2,
        abi: delegateAbi,
        functionName: "checkDelegateForContract",
        args: [delegate, vault, BAYC_CONTRACT, ("0x" + "00".repeat(32)) as `0x${string}`],
      })) as boolean;
    } catch (e) {
      console.error("Delegation check failed", e);
      return { verified: false, error: "RPC error — try again" };
    }

    if (!isDelegated) return { verified: false, error: "No active BAYC delegation" };

    const { requireTokenProof, invalidateTokenProof } = await import("@/server/token-proof.server");
    invalidateTokenProof({ wallet: vault, contract: BAYC_CONTRACT });
    const vaultProof = await requireTokenProof({
      wallet: vault,
      contract: BAYC_CONTRACT,
      minBalance: 1,
    });

    await supabase.from("user_verifications").upsert(
      {
        user_id: userId,
        delegation_verified: vaultProof.verified,
        delegation_vault: vaultProof.verified ? vault : null,
        bayc_verified: vaultProof.verified ? true : undefined,
        verified_at: vaultProof.verified ? new Date().toISOString() : null,
      },
      { onConflict: "user_id" },
    );

    return {
      verified: vaultProof.verified,
      error: vaultProof.verified ? null : "Vault holds no BAYC",
    };
  });

// ---------------------------------------------------------------------------
// Otherpage.xyz — secondary token gate, admin-configurable contract
// ---------------------------------------------------------------------------

interface OtherpageGate {
  contract: string | null;
  min_balance: number;
  chain_id: number;
}

async function loadOtherpageGate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<OtherpageGate | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "otherpage_gate")
    .maybeSingle();
  if (error || !data) return null;
  const v = data.value as Partial<OtherpageGate> | null;
  if (!v || !v.contract) return null;
  return {
    contract: v.contract,
    min_balance: typeof v.min_balance === "number" ? v.min_balance : 1,
    chain_id: typeof v.chain_id === "number" ? v.chain_id : 1,
  };
}

/**
 * Gate-check for premium-room access. Always called from the server side
 * immediately before granting access.
 */
export const checkPremiumAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { wallet: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const wallet = getAddress(data.wallet);
    const gate = await loadOtherpageGate(supabase);
    if (!gate || !gate.contract) {
      return { allowed: false, reason: "Premium gating not configured" };
    }
    const { requireTokenProof } = await import("@/server/token-proof.server");
    const proof = await requireTokenProof({
      wallet,
      contract: gate.contract,
      minBalance: gate.min_balance,
      chainId: gate.chain_id,
    });
    return {
      allowed: proof.verified,
      cached: proof.cached,
      reason: proof.verified ? null : (proof.reason ?? "No qualifying tokens"),
    };
  });

// ---------------------------------------------------------------------------
// Admin: read / write the Otherpage gate contract address
// ---------------------------------------------------------------------------

export const getOtherpageGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const gate = await loadOtherpageGate(context.supabase);
    return { gate };
  });

export const setOtherpageGate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { contract: string; minBalance?: number; chainId?: number }) =>
    z
      .object({
        contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        minBalance: z.number().int().min(1).max(10_000).optional(),
        chainId: z.number().int().min(1).max(2_000_000_000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const value = {
      contract: getAddress(data.contract),
      min_balance: data.minBalance ?? 1,
      chain_id: data.chainId ?? 1,
    };
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "otherpage_gate", value, updated_by: userId }, { onConflict: "key" });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, value };
  });
