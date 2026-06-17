import { createPublicClient, http, fallback, getAddress, isAddress, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { REQUIRED_COLLECTIONS } from "./collections";
import { resolveDelegations } from "./delegateResolver";
import { scanCollections, type OwnershipRow } from "./collectionScanner";

export interface OwnershipResult {
  userId: string;
  connected: string | null;
  linked: string[];
  allowed: boolean;
  ownership: OwnershipRow[];
  scanned: string[];
  edges: Array<{ from: string; to: string; via: "linked" | "delegate-in" | "delegate-out" }>;
  blockNumber: string; // serialized bigint for SSR safety
}

const MAX_ADDRESSES = 32;

function publicClient(): PublicClient {
  const url = process.env.ETH_RPC_URL;
  if (!url) throw new Error("Ethereum RPC is not configured.");
  return createPublicClient({
    chain: mainnet,
    transport: http(url, { timeout: 8_000, retryCount: 1 }),
  });
}

/**
 * Single source of truth for NFT-ownership-based authorization.
 *
 * Walks: connected wallet → verified linked_wallets → delegate.cash
 * incoming vaults AND outgoing delegates for every address in the set,
 * then balanceOf-scans BAYC + MAYC across the whole graph in parallel.
 */
export async function resolveOwnership(userId: string): Promise<OwnershipResult> {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("wallet_address")
    .eq("id", userId)
    .maybeSingle();

  const { data: linkedRows } = await supabaseAdmin
    .from("linked_wallets")
    .select("address")
    .eq("user_id", userId)
    .not("verified_at", "is", null);

  const connectedRaw = profile?.wallet_address ?? null;
  const connected =
    connectedRaw && isAddress(connectedRaw) ? (getAddress(connectedRaw) as `0x${string}`) : null;

  const linked = (linkedRows ?? [])
    .map((r) => r.address)
    .filter((a): a is string => !!a && isAddress(a))
    .map((a) => getAddress(a) as `0x${string}`);

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

  const ownership = await scanCollections(client, capped, REQUIRED_COLLECTIONS, block);
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
