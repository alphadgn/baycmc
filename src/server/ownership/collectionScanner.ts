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

/**
 * Parallel balanceOf scan across (wallet × contract) on ONE chain.
 * Cache hits skip RPC.
 */
export async function scanCollections(
  client: PublicClient,
  wallets: `0x${string}`[],
  contracts: readonly `0x${string}`[],
  block: bigint,
): Promise<OwnershipRow[]> {
  const tasks: Array<Promise<OwnershipRow | null>> = [];
  for (const w of wallets) {
    for (const c of contracts) {
      const cached = getBalance(w, c, block);
      if (cached !== null) {
        if (cached > 0n)
          tasks.push(Promise.resolve({ wallet: w, contract: c, balance: Number(cached) }));
        continue;
      }
      tasks.push(
        (async () => {
          try {
            const bal = (await client.readContract({
              address: c,
              abi: ERC721_ABI,
              functionName: "balanceOf",
              args: [w],
            })) as bigint;
            setBalance(w, c, block, bal);
            return bal > 0n ? { wallet: w, contract: c, balance: Number(bal) } : null;
          } catch (e) {
            console.warn("[nft-gate] balanceOf failed", w, c, e);
            return null;
          }
        })(),
      );
    }
  }
  const results = await Promise.all(tasks);
  return results.filter((r): r is OwnershipRow => r !== null);
}

/**
 * Scan every whitelisted collection on the chain it actually lives on.
 * `mainnetClient`/`mainnetBlock` are reused from the caller; other chains use
 * their own clients (block 0 = TTL-only cache key; contracts are chain-unique).
 */
export async function scanAllCollections(
  mainnetClient: PublicClient,
  wallets: `0x${string}`[],
  mainnetBlock: bigint,
  collections: readonly { contract: string; chainId: CollectionChainId }[] = ALLOWED_COLLECTIONS,
): Promise<OwnershipRow[]> {
  const byChain = new Map<CollectionChainId, `0x${string}`[]>();
  for (const c of collections) {
    const list = byChain.get(c.chainId) ?? [];
    list.push(c.contract as `0x${string}`);
    byChain.set(c.chainId, list);
  }
  const parts = await Promise.all(
    [...byChain.entries()].map(([chainId, contracts]) =>
      chainId === 1
        ? scanCollections(mainnetClient, wallets, contracts, mainnetBlock)
        : scanCollections(publicClientFor(chainId), wallets, contracts, 0n),
    ),
  );
  return parts.flat();
}
