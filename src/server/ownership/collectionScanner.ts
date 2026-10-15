import { type PublicClient } from "viem";
import { ALLOWED_COLLECTIONS, type CollectionChainId } from "@/lib/web3/constants";
import { ERC721_ABI } from "./collections";
import { getBalance, setBalance } from "./ownershipCache";
import { publicClientFor } from "./chains";

export interface OwnershipRow {
  wallet: string;
  contract: string;
  balance: number;
}

export interface ScanResult {
  rows: OwnershipRow[];
  /** Contracts (lowercase) where at least one wallet's check FAILED (RPC
   *  error). Their result is unknown — callers must not treat it as "0". */
  failed: Set<string>;
}

const ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function balanceWithRetry(
  client: PublicClient,
  wallet: `0x${string}`,
  contract: `0x${string}`,
): Promise<bigint | null> {
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      return (await client.readContract({
        address: contract,
        abi: ERC721_ABI,
        functionName: "balanceOf",
        args: [wallet],
      })) as bigint;
    } catch (e) {
      if (i === ATTEMPTS - 1) {
        console.warn("[nft-gate] balanceOf failed after retries", wallet, contract, e);
        return null;
      }
      await sleep(300 * (i + 1));
    }
  }
  return null;
}

/**
 * balanceOf for every (wallet × contract) on ONE chain.
 *
 * Previously each pair was its own unretried request fired all at once;
 * public RPCs rate-limited the burst, failures were swallowed as "holds 0",
 * and collections the user really held (BAYC, Ugly Duck Labs, Temp Agency)
 * randomly dropped off their verification. Now: the transport batches calls
 * (see chains.ts), each call retries, and failures are reported separately.
 */
export async function scanCollectionsDetailed(
  client: PublicClient,
  wallets: `0x${string}`[],
  contracts: readonly `0x${string}`[],
  block: bigint,
): Promise<ScanResult> {
  const rows: OwnershipRow[] = [];
  const failed = new Set<string>();
  const tasks: Promise<void>[] = [];
  for (const w of wallets) {
    for (const c of contracts) {
      const cached = getBalance(w, c, block);
      if (cached !== null) {
        if (cached > 0n) rows.push({ wallet: w, contract: c, balance: Number(cached) });
        continue;
      }
      tasks.push(
        (async () => {
          const bal = await balanceWithRetry(client, w, c);
          if (bal === null) {
            failed.add(c.toLowerCase());
            return;
          }
          setBalance(w, c, block, bal);
          if (bal > 0n) rows.push({ wallet: w, contract: c, balance: Number(bal) });
        })(),
      );
    }
  }
  await Promise.all(tasks);
  return { rows, failed };
}

/** Back-compat: rows only. */
export async function scanCollections(
  client: PublicClient,
  wallets: `0x${string}`[],
  contracts: readonly `0x${string}`[],
  block: bigint,
): Promise<OwnershipRow[]> {
  return (await scanCollectionsDetailed(client, wallets, contracts, block)).rows;
}

/**
 * Scan every whitelisted collection on the chain it actually lives on.
 * `mainnetClient`/`mainnetBlock` are reused from the caller; other chains use
 * their own clients (block 0 = TTL-only cache key; contracts are chain-unique).
 */
export async function scanAllCollectionsDetailed(
  mainnetClient: PublicClient,
  wallets: `0x${string}`[],
  mainnetBlock: bigint,
  collections: readonly { contract: string; chainId: CollectionChainId }[] = ALLOWED_COLLECTIONS,
): Promise<ScanResult> {
  const byChain = new Map<CollectionChainId, `0x${string}`[]>();
  for (const c of collections) {
    const list = byChain.get(c.chainId) ?? [];
    list.push(c.contract as `0x${string}`);
    byChain.set(c.chainId, list);
  }
  const parts = await Promise.all(
    [...byChain.entries()].map(([chainId, contracts]) =>
      chainId === 1
        ? scanCollectionsDetailed(mainnetClient, wallets, contracts, mainnetBlock)
        : scanCollectionsDetailed(publicClientFor(chainId), wallets, contracts, 0n),
    ),
  );
  const failed = new Set<string>();
  for (const p of parts) for (const f of p.failed) failed.add(f);
  return { rows: parts.flatMap((p) => p.rows), failed };
}

export async function scanAllCollections(
  mainnetClient: PublicClient,
  wallets: `0x${string}`[],
  mainnetBlock: bigint,
  collections: readonly { contract: string; chainId: CollectionChainId }[] = ALLOWED_COLLECTIONS,
): Promise<OwnershipRow[]> {
  return (await scanAllCollectionsDetailed(mainnetClient, wallets, mainnetBlock, collections)).rows;
}
