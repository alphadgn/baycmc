import { parseAbi } from "viem";
import { BAYC_CONTRACT, MAYC_CONTRACT, REQUIRED_COLLECTIONS } from "@/lib/web3/constants";

export { BAYC_CONTRACT, MAYC_CONTRACT, REQUIRED_COLLECTIONS };

export const ERC721_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

export function collectionLabel(contract: string): "BAYC" | "MAYC" | null {
  const c = contract.toLowerCase();
  if (c === BAYC_CONTRACT.toLowerCase()) return "BAYC";
  if (c === MAYC_CONTRACT.toLowerCase()) return "MAYC";
  return null;
}
