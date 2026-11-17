import type { NftItem } from "@/server/wallet-assets.functions";
import { isAllowedCollection } from "@/lib/web3/constants";

/** Only allowed collections; normalize contract addresses to dedupe cross-wallet holdings. */
export function mergeWalletNfts(
  walletItems: NftItem[][],
  allowed?: readonly { contract: string; active: boolean }[],
): NftItem[] {
  const items = new Map<string, NftItem>();
  for (const wallet of walletItems) {
    for (const nft of wallet) {
      if (
        allowed
          ? !allowed.some(
              (c) => c.active && c.contract.toLowerCase() === nft.contract.toLowerCase(),
            )
          : !isAllowedCollection(nft.contract)
      )
        continue;
      const key = `${nft.contract.toLowerCase()}-${nft.tokenId}`;
      if (!items.has(key)) items.set(key, nft);
    }
  }
  return [...items.values()];
}
