import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, getAddress, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BAYC_CONTRACT, DELEGATE_REGISTRY_V2, ETH_RPC_URL } from "@/lib/web3/constants";
import {
  requireTokenProof,
  invalidateTokenProof,
} from "@/server/token-proof.server";

function client() {
  return createPublicClient({ chain: mainnet, transport: http(ETH_RPC_URL) });
}

const delegateAbi = parseAbi([
  "function checkDelegateForContract(address to, address from, address contract_, bytes32 rights) view returns (bool)",
]);

const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// BAYC verification — Token Proof (fresh on-chain balanceOf, server-side cache)
// ---------------------------------------------------------------------------

export const verifyBayc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { wallet: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const wallet = getAddress(data.wallet);

    // Force a fresh look — the user explicitly asked us to (re)verify.
    invalidateTokenProof({ wallet, contract: BAYC_CONTRACT });
    const proof = await requireTokenProof({
      wallet,
      contract: BAYC_CONTRACT,
      minBalance: 1,
    });

    if (proof.reason) {
      return { verified: false, balance: 0, error: proof.reason };
    }

    const { error } = await supabase
      .from("user_verifications")
      .upsert(
        {
          user_id: userId,
          bayc_verified: proof.verified,
          verified_at: proof.verified ? new Date().toISOString() : null,
        },
        { onConflict: "user_id" },
      );
    if (error) console.error("Failed to persist BAYC verification", error);

    return { verified: proof.verified, balance: proof.balance, error: null as string | null };
  });

// ---------------------------------------------------------------------------
// Delegation (delegate.cash) — keeps existing semantics
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

    // Vault must currently hold BAYC for delegation to count.
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
// Lumina — backend-only. UI surfaces have been removed; this remains for
// internal/server-side checks only and is NEVER called from the client.
// ---------------------------------------------------------------------------

export const verifyLumina = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { wallet: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LUMINA_API_KEY;
    if (!apiKey) {
      return { verified: false, error: "Lumina not configured", configured: false };
    }
    try {
      const res = await fetch("https://api.lumina.xyz/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ wallet: data.wallet }),
      });
      if (!res.ok) {
        return { verified: false, error: `Lumina API ${res.status}`, configured: true };
      }
      const json = (await res.json()) as { verified?: boolean };
      const verified = !!json.verified;
      await supabase
        .from("user_verifications")
        .upsert({ user_id: userId, lumina_verified: verified }, { onConflict: "user_id" });
      return { verified, error: null as string | null, configured: true };
    } catch (e) {
      console.error("Lumina request failed", e);
      return { verified: false, error: "Lumina request failed", configured: true };
    }
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

export const verifyOtherpage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { wallet: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const wallet = getAddress(data.wallet);

    const gate = await loadOtherpageGate(supabase);
    if (!gate || !gate.contract) {
      return {
        verified: false,
        configured: false,
        error: "Otherpage contract not configured by admin",
      };
    }

    invalidateTokenProof({ wallet, contract: gate.contract, chainId: gate.chain_id });
    const proof = await requireTokenProof({
      wallet,
      contract: gate.contract,
      minBalance: gate.min_balance,
      chainId: gate.chain_id,
    });

    if (proof.reason) {
      return { verified: false, configured: true, error: proof.reason };
    }

    await supabase
      .from("user_verifications")
      .upsert(
        { user_id: userId, otherpage_verified: proof.verified },
        { onConflict: "user_id" },
      );

    return {
      verified: proof.verified,
      configured: true,
      balance: proof.balance,
      error: null as string | null,
    };
  });

/**
 * Gate-check for premium-room access. Performs a FRESH on-chain check (cache
 * may serve a recent value but never older than POSITIVE_TTL_MS). Always
 * called from the server side immediately before granting access.
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
  .inputValidator((input: { contract: string; minBalance?: number; chainId?: number }) =>
    z
      .object({
        contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        minBalance: z.number().int().min(1).max(10_000).optional(),
        chainId: z.number().int().min(1).max(2_000_000_000).optional(),
      })
      .parse(input),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const value = {
      contract: getAddress(data.contract),
      min_balance: data.minBalance ?? 1,
      chain_id: data.chainId ?? 1,
    };
    // RLS enforces super_admin-only writes; this update will fail otherwise.
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: "otherpage_gate", value, updated_by: userId },
        { onConflict: "key" },
      );
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, value };
  });
