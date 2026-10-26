import { createPublicClient, http, fallback, getAddress, isAddress, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveDelegations } from "./delegateResolver";
import { scanAllCollectionsDetailed, type OwnershipRow } from "./collectionScanner";

export interface OwnershipResult {
  userId: string;
  connected: string | null;
  linked: string[];
  allowed: boolean;
  ownership: OwnershipRow[];
  /** Contracts whose check errored this time (unknown, not "0"). */
  failedContracts: string[];
  scanned: string[];
  edges: Array<{ from: string; to: string; via: "linked" | "delegate-in" | "delegate-out" }>;
  blockNumber: string; // serialized bigint for SSR safety
}

const MAX_ADDRESSES = 32;

function publicClient(): PublicClient {
  const configured = process.env.ETH_RPC_URL?.trim();
  if (!configured) {
    console.warn("[nft-gate] ETH_RPC_URL not set — using public RPC fallbacks");
  }
  const urls = [
    configured,
    "https://eth.llamarpc.com",
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.ankr.com/eth",
  ].filter((u): u is string => Boolean(u));
  return createPublicClient({
    chain: mainnet,
    transport: fallback(
      urls.map((u) =>
        http(u, { timeout: 10_000, retryCount: 2, batch: { batchSize: 50, wait: 16 } }),
      ),
      { rank: false, retryCount: 1 },
    ),
  });
}

/**
 * Single source of truth for NFT-ownership-based authorization.
 *
 * Walks: this session's proven wallets → delegate.cash incoming vaults AND
 * outgoing delegates for every address in the set, then balanceOf-scans
 * every whitelisted collection across the whole graph in parallel.
 */
export async function resolveOwnership(userId: string): Promise<OwnershipResult> {
  // Only wallets connected and proven by signature in the member's CURRENT
  // sign-in session count (session_wallets — written by the server at
  // wallet sign-in and in-session wallet linking, wiped at sign-in and
  // sign-out). Wallets linked in earlier sessions don't count until they
  // are proven again. Delegations INTO / OUT OF these wallets still count.
  const [{ data: profile }, { data: sessionRows }] = await Promise.all([
    supabaseAdmin.from("profiles").select("wallet_address").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("session_wallets")
      .select("address")
      .eq("user_id", userId)
      .order("proven_at"),
  ]);
  const session = (sessionRows ?? [])
    .map((r) => r.address)
    .filter((a): a is string => !!a && isAddress(a))
    .map((a) => getAddress(a) as `0x${string}`);
  const primary =
    profile?.wallet_address && isAddress(profile.wallet_address)
      ? getAddress(profile.wallet_address).toLowerCase()
      : null;
  const connected = session.find((a) => a.toLowerCase() === primary) ?? session[0] ?? null;
  const linked = session.filter((a) => a !== connected);

  const addresses = new Set<string>();
  const edges: OwnershipResult["edges"] = [];
  if (connected) addresses.add(connected.toLowerCase());
  for (const a of linked) {
    if (!addresses.has(a.toLowerCase())) {
      addresses.add(a.toLowerCase());
      edges.push({ from: connected ?? userId, to: a, via: "linked" });
    }
  }

  if (addresses.size === 0) {
    return {
      userId,
      connected: null,
      linked: [],
      allowed: false,
      ownership: [],
      failedContracts: [],
      scanned: [],
      edges: [],
      blockNumber: "0",
    };
  }

  const client = publicClient();
  let block = 0n;
  try {
    block = await client.getBlockNumber();
  } catch (e) {
    console.warn("[nft-gate] getBlockNumber failed; cache disabled this call", e);
  }

  // Walk delegations (incoming + outgoing) for every seed address.
  const seeds = [...addresses] as `0x${string}`[];
  const delegationResults = await Promise.all(
    seeds.map(async (addr) => {
      try {
        const d = await resolveDelegations(client, addr);
        return { addr, ...d };
      } catch (e) {
        console.warn("[nft-gate] resolveDelegations failed", addr, e);
        return { addr, incomingVaults: [], outgoingDelegates: [] };
      }
    }),
  );

  for (const { addr, incomingVaults, outgoingDelegates } of delegationResults) {
    for (const v of incomingVaults) {
      const k = v.toLowerCase();
      if (!addresses.has(k)) {
        addresses.add(k);
        edges.push({ from: v, to: addr, via: "delegate-in" });
      }
    }
    for (const d of outgoingDelegates) {
      const k = d.toLowerCase();
      if (!addresses.has(k)) {
        addresses.add(k);
        edges.push({ from: addr, to: d, via: "delegate-out" });
      }
    }
    if (addresses.size >= MAX_ADDRESSES) break;
  }

  const capped = [...addresses].slice(0, MAX_ADDRESSES).map((a) => getAddress(a) as `0x${string}`);

  const { rows: ownership, failed } = await scanAllCollectionsDetailed(client, capped, block);
  const allowed = ownership.length > 0;

  // Structured log — drives observability the spec asks for.
  try {
    console.group("NFT Gate");
    console.log("user", userId);
    console.log("connected", connected);
    console.log("linked", linked);
    console.log(
      "delegates",
      delegationResults.map((d) => ({
        addr: d.addr,
        in: d.incomingVaults,
        out: d.outgoingDelegates,
      })),
    );
    console.log("scanned", capped);
    console.log("ownership", ownership);
    console.log(allowed ? "event=ownership-confirmed" : "event=ownership-denied");
    console.groupEnd();
  } catch {
    /* noop */
  }

  return {
    userId,
    connected,
    linked,
    allowed,
    ownership,
    failedContracts: [...failed],
    scanned: capped,
    edges,
    blockNumber: block.toString(),
  };
}

// Refresh the linked_wallets.last_checked_at column without blocking the caller.
export async function touchLinkedWallets(userId: string) {
  await supabaseAdmin
    .from("linked_wallets")
    .update({ last_checked_at: new Date().toISOString() })
    .eq("user_id", userId);
}
