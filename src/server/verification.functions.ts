import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http, getAddress, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BAYC_CONTRACT, DELEGATE_REGISTRY_V2, ETH_RPC_URL } from "@/lib/web3/constants";

function client() {
  return createPublicClient({ chain: mainnet, transport: http(ETH_RPC_URL) });
}

const erc721Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

const delegateAbi = parseAbi([
  "function checkDelegateForContract(address to, address from, address contract_, bytes32 rights) view returns (bool)",
]);

export const verifyBayc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { wallet: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const wallet = getAddress(data.wallet);

    let balance = 0n;
    try {
      balance = await client().readContract({
        address: BAYC_CONTRACT,
        abi: erc721Abi,
        functionName: "balanceOf",
        args: [wallet],
      });
    } catch (e) {
      console.error("BAYC balanceOf failed", e);
      return { verified: false, balance: 0, error: "RPC error — try again" };
    }

    const verified = balance > 0n;
    const { error } = await supabase
      .from("user_verifications")
      .upsert(
        {
          user_id: userId,
          bayc_verified: verified,
          verified_at: verified ? new Date().toISOString() : null,
        },
        { onConflict: "user_id" },
      );
    if (error) console.error("Failed to persist BAYC verification", error);

    return { verified, balance: Number(balance), error: null as string | null };
  });

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
      isDelegated = await client().readContract({
        address: DELEGATE_REGISTRY_V2,
        abi: delegateAbi,
        functionName: "checkDelegateForContract",
        args: [delegate, vault, BAYC_CONTRACT, "0x" + "00".repeat(32) as `0x${string}`],
      });
    } catch (e) {
      console.error("Delegation check failed", e);
      return { verified: false, error: "RPC error — try again" };
    }

    if (!isDelegated) return { verified: false, error: "No active BAYC delegation" };

    // Vault must hold BAYC for delegation to count
    const vaultBalance = await client().readContract({
      address: BAYC_CONTRACT,
      abi: erc721Abi,
      functionName: "balanceOf",
      args: [vault],
    });
    const verified = vaultBalance > 0n;

    await supabase.from("user_verifications").upsert(
      {
        user_id: userId,
        delegation_verified: verified,
        delegation_vault: verified ? vault : null,
        bayc_verified: verified ? true : undefined,
        verified_at: verified ? new Date().toISOString() : null,
      },
      { onConflict: "user_id" },
    );

    return { verified, error: verified ? null : "Vault holds no BAYC" };
  });

// Lumina verification — placeholder until you provide API docs/credentials.
// Once you share them, swap the fetch URL/headers below and add a LUMINA_API_KEY secret.
export const verifyLumina = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { wallet: string }) =>
    z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LUMINA_API_KEY;

    if (!apiKey) {
      return {
        verified: false,
        error: "Lumina not configured yet — add LUMINA_API_KEY",
        configured: false,
      };
    }

    // TODO: replace with real Lumina API once docs are provided
    try {
      const res = await fetch("https://api.lumina.xyz/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ wallet: data.wallet }),
      });
      if (!res.ok) {
        return { verified: false, error: `Lumina API ${res.status}`, configured: true };
      }
      const json = (await res.json()) as { verified?: boolean };
      const verified = !!json.verified;

      await supabase
        .from("user_verifications")
        .upsert(
          { user_id: userId, lumina_verified: verified },
          { onConflict: "user_id" },
        );
      return { verified, error: null as string | null, configured: true };
    } catch (e) {
      console.error("Lumina request failed", e);
      return { verified: false, error: "Lumina request failed", configured: true };
    }
  });
