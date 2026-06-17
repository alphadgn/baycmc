import { type PublicClient, parseAbi, getAddress } from "viem";
import { DELEGATE_REGISTRY_V2, BAYC_CONTRACT, MAYC_CONTRACT } from "@/lib/web3/constants";

const NO_RIGHTS = "0x0000000000000000000000000000000000000000000000000000000000000000";

const registryAbi = parseAbi([
  "struct Delegation { uint8 type_; address to; address from; bytes32 rights; address contract_; uint256 tokenId; uint256 amount; }",
  "function getIncomingDelegations(address to) view returns (Delegation[])",
  "function getOutgoingDelegations(address from) view returns (Delegation[])",
]);

type RawDelegation = {
  type_: number;
  to: `0x${string}`;
  from: `0x${string}`;
  rights: `0x${string}`;
  contract_: `0x${string}`;
};

function relevant(d: RawDelegation): boolean {
  // type_: 1 = ALL, 2 = CONTRACT, 3 = ERC721
  if (d.rights !== NO_RIGHTS) return false;
  if (d.type_ === 1) return true;
  if (d.type_ === 2 || d.type_ === 3) {
    const c = d.contract_.toLowerCase();
    return c === BAYC_CONTRACT.toLowerCase() || c === MAYC_CONTRACT.toLowerCase();
  }
  return false;
}

export interface DelegationEdges {
  incomingVaults: `0x${string}`[]; // vaults that delegated TO `addr`
  outgoingDelegates: `0x${string}`[]; // delegates `addr` delegated assets TO
}

export async function resolveDelegations(
  client: PublicClient,
  addr: `0x${string}`,
): Promise<DelegationEdges> {
  const [incoming, outgoing] = await Promise.allSettled([
    client.readContract({
      address: DELEGATE_REGISTRY_V2,
      abi: registryAbi,
      functionName: "getIncomingDelegations",
      args: [addr],
    }) as Promise<readonly RawDelegation[]>,
    client.readContract({
      address: DELEGATE_REGISTRY_V2,
      abi: registryAbi,
      functionName: "getOutgoingDelegations",
      args: [addr],
    }) as Promise<readonly RawDelegation[]>,
  ]);

  const inVaults = new Set<string>();
  const outDelegates = new Set<string>();

  if (incoming.status === "fulfilled") {
    for (const d of incoming.value) if (relevant(d)) inVaults.add(getAddress(d.from));
  } else {
    console.warn("[nft-gate] getIncomingDelegations failed", addr, incoming.reason);
  }
  if (outgoing.status === "fulfilled") {
    for (const d of outgoing.value) if (relevant(d)) outDelegates.add(getAddress(d.to));
  } else {
    console.warn("[nft-gate] getOutgoingDelegations failed", addr, outgoing.reason);
  }

  return {
    incomingVaults: [...inVaults] as `0x${string}`[],
    outgoingDelegates: [...outDelegates] as `0x${string}`[],
  };
}
