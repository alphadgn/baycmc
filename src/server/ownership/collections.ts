import { parseAbi } from "viem";
import {
  ALLOWED_COLLECTIONS,
  BAYC_CONTRACT,
  MAYC_CONTRACT,
  REQUIRED_COLLECTIONS,
  type CollectionLabel,
} from "@/lib/web3/constants";

export { BAYC_CONTRACT, MAYC_CONTRACT, REQUIRED_COLLECTIONS };

// CryptoPunks' market contract also exposes `balanceOf(address)`, so one ABI
// works for every whitelisted collection.
export const ERC721_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

export function collectionLabel(contract: string): CollectionLabel | null {
  const c = contract.toLowerCase();
  return ALLOWED_COLLECTIONS.find((a) => a.contract.toLowerCase() === c)?.label ?? null;
}
