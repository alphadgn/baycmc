import { type PublicClient } from "viem";
import { ERC721_ABI } from "./collections";
import { getBalance, setBalance } from "./ownershipCache";

export interface OwnershipRow {
  wallet: string;
  contract: string;
  balance: number;
}

/**
 * Parallel balanceOf scan across (wallet × contract). Cache hits skip RPC.
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
        if (cached > 0n) tasks.push(Promise.resolve({ wallet: w, contract: c, balance: Number(cached) }));
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
