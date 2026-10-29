import { getAddress, isAddress } from "viem";
import { CHAIN_ETHEREUM } from "@/lib/web3/constants";
import { publicClientFor } from "./chains";
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

/**
 * Single source of truth for NFT-ownership-based authorization.
 *
 * Walks: this session's proven wallets → delegate.cash incoming vaults AND
 * outgoing delegates for every address in the set, then balanceOf-scans
 * every whitelisted collection across the whole graph in parallel.
 */
export async function resolveOwnership(userId: string): Promise<OwnershipResult> {
  // Which wallets are checked — all server-proven, never a list from the
  // browser:
  //   * wallets proven by signature in the CURRENT sign-in session
  //     (session_wallets: the signer, Glyph-attached wallets, in-session
  //     links), and
  //   * the account's own wallets proven by signature earlier: its primary
  //     wallet and every linked wallet with verified_at (written by the
  //     server only after a signature check).
  // Every one of them is scanned live on-chain each time; nothing verified
  // earlier is carried over. Previously only session wallets counted, so a
  // vault wallet linked once (e.g. a cold wallet holding the ape) stopped
  // counting at the next sign-in and the member lost access they had.
  // Delegations INTO / OUT OF these wallets still count.
  const [{ data: profile }, { data: sessionRows }, { data: provenLinked }] = await Promise.all([
    supabaseAdmin.from("profiles").select("wallet_address").eq("id", userId).maybeSingle(),
    supabaseAdmin
      .from("session_wallets")
      .select("address")
      .eq("user_id", userId)
      .order("proven_at"),
    supabaseAdmin
      .from("linked_wallets")
      .select("address")
      .eq("user_id", userId)
      .not("verified_at", "is", null)
      .limit(20),
  ]);
  const norm = (a: string | null | undefined) =>
    a && isAddress(a) ? (getAddress(a) as `0x${string}`) : null;
  const session = (sessionRows ?? [])
    .map((r) => norm(r.address))
    .filter((a): a is `0x${string}` => !!a);
  const primary = norm(profile?.wallet_address);
  const accountWallets = [
    primary,
    ...(provenLinked ?? []).map((r) => norm(r.address as string)),
  ].filter((a): a is `0x${string}` => !!a);
  const connected =
    session.find((a) => a.toLowerCase() === primary?.toLowerCase()) ?? session[0] ?? primary;
  const linked = [...session, ...accountWallets].filter(
    (a, i, all) =>
      a.toLowerCase() !== connected?.toLowerCase() &&
      all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i,
  );

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

  const client = publicClientFor(CHAIN_ETHEREUM);
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
