/**
 * Whitelisted-NFT holdings for one wallet, read from the chain each
 * collection actually lives on. Server-only.
 *
 *   Ethereum  → Alchemy NFT API (contract-filtered)
 *   ApeChain  → Alchemy NFT API (apechain-mainnet), else on-chain reads
 *   Robinhood → Blockscout API, else on-chain reads
 *
 * Only collections in ALLOWED_COLLECTIONS are ever returned.
 */
import { parseAbi } from "viem";
import {
  ALLOWED_COLLECTIONS,
  CHAIN_APECHAIN,
  CHAIN_ETHEREUM,
  CHAIN_ROBINHOOD,
  type AllowedCollection,
  type CollectionChainId,
} from "@/lib/web3/constants";
import { publicClientFor } from "@/server/ownership/chains";

export interface NftItem {
  contract: string;
  tokenId: string;
  name: string | null;
  collection: string | null;
  image: string | null;
  openseaUrl: string;
}

const ENUM_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

const MAX_PER_COLLECTION = 24;
const TIMEOUT_MS = 12_000;

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function ipfs(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${u.slice(7).replace(/^ipfs\//, "")}`;
  if (u.startsWith("ar://")) return `https://arweave.net/${u.slice(5)}`;
  return u;
}

export function nftLink(chainId: CollectionChainId, contract: string, tokenId: string): string {
  if (chainId === CHAIN_APECHAIN)
    return `https://opensea.io/assets/ape_chain/${contract}/${tokenId}`;
  if (chainId === CHAIN_ROBINHOOD)
    return `https://robinhoodchain.blockscout.com/token/${contract}/instance/${tokenId}`;
  return `https://opensea.io/assets/ethereum/${contract}/${tokenId}`;
}

interface AlchemyNftResponse {
  ownedNfts?: Array<{
    contract?: { address?: string; name?: string; openSeaMetadata?: { collectionName?: string } };
    tokenId?: string;
    name?: string;
    image?: { cachedUrl?: string; thumbnailUrl?: string; originalUrl?: string };
  }>;
}

async function viaAlchemy(
  network: "eth-mainnet" | "apechain-mainnet",
  key: string,
  owner: string,
  cols: AllowedCollection[],
): Promise<NftItem[]> {
  const filter = cols.map((c) => `&contractAddresses[]=${c.contract}`).join("");
  const url = `https://${network}.g.alchemy.com/nft/v3/${key}/getNFTsForOwner?owner=${owner}&withMetadata=true&pageSize=100${filter}`;
  const resp = await fetchJson<AlchemyNftResponse>(url);
  const out: NftItem[] = [];
  for (const n of resp.ownedNfts ?? []) {
    const contract = (n.contract?.address ?? "").toLowerCase();
    const col = cols.find((c) => c.contract.toLowerCase() === contract);
    if (!col) continue;
    const tokenId = n.tokenId ?? "";
    out.push({
      contract,
      tokenId,
      name: n.name ?? null,
      collection: n.contract?.openSeaMetadata?.collectionName ?? n.contract?.name ?? col.name,
      image: n.image?.cachedUrl ?? n.image?.thumbnailUrl ?? n.image?.originalUrl ?? null,
      openseaUrl: nftLink(col.chainId, contract, tokenId),
    });
  }
  return out;
}

interface BlockscoutNftResponse {
  items?: Array<{
    id?: string;
    image_url?: string | null;
    metadata?: { name?: string; image?: string } | null;
    token?: { address?: string; address_hash?: string; name?: string };
  }>;
}

async function viaBlockscout(owner: string, cols: AllowedCollection[]): Promise<NftItem[]> {
  const url = `https://robinhoodchain.blockscout.com/api/v2/addresses/${owner}/nft?type=ERC-721`;
  const resp = await fetchJson<BlockscoutNftResponse>(url);
  const out: NftItem[] = [];
  for (const n of resp.items ?? []) {
    const contract = (n.token?.address_hash ?? n.token?.address ?? "").toLowerCase();
    const col = cols.find((c) => c.contract.toLowerCase() === contract);
    if (!col || !n.id) continue;
    out.push({
      contract,
      tokenId: n.id,
      name: n.metadata?.name ?? null,
      collection: n.token?.name ?? col.name,
      image: ipfs(n.image_url ?? n.metadata?.image),
      openseaUrl: nftLink(col.chainId, contract, n.id),
    });
  }
  return out;
}

/** Plain RPC fallback: balanceOf, then enumerate + tokenURI when supported. */
async function viaRpc(owner: `0x${string}`, cols: AllowedCollection[]): Promise<NftItem[]> {
  const out: NftItem[] = [];
  await Promise.all(
    cols.map(async (col) => {
      const client = publicClientFor(col.chainId);
      const address = col.contract as `0x${string}`;
      const contract = col.contract.toLowerCase();
      let balance = 0n;
      try {
        balance = await client.readContract({
          address,
          abi: ENUM_ABI,
          functionName: "balanceOf",
          args: [owner],
        });
      } catch {
        return;
      }
      if (balance === 0n) return;
      const n = Number(balance > BigInt(MAX_PER_COLLECTION) ? BigInt(MAX_PER_COLLECTION) : balance);
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        try {
          const id = await client.readContract({
            address,
            abi: ENUM_ABI,
            functionName: "tokenOfOwnerByIndex",
            args: [owner, BigInt(i)],
          });
          ids.push(id.toString());
        } catch {
          break; // not enumerable
        }
      }
      if (ids.length === 0) {
        // Holder confirmed, token ids unknown — show one summary card.
        out.push({
          contract,
          tokenId: `held-${owner.toLowerCase()}`,
          name: `${col.name} × ${balance.toString()}`,
          collection: col.name,
          image: null,
          openseaUrl: nftLink(col.chainId, contract, "").replace(/\/$/, ""),
        });
        return;
      }
      await Promise.all(
        ids.map(async (tokenId) => {
          let image: string | null = null;
          let name: string | null = null;
          try {
            const uri = await client.readContract({
              address,
              abi: ENUM_ABI,
              functionName: "tokenURI",
              args: [BigInt(tokenId)],
            });
            const meta = await fetchJson<{ name?: string; image?: string }>(ipfs(uri) ?? uri);
            image = ipfs(meta.image);
            name = meta.name ?? null;
          } catch {
            /* metadata optional */
          }
          out.push({
            contract,
            tokenId,
            name,
            collection: col.name,
            image,
            openseaUrl: nftLink(col.chainId, contract, tokenId),
          });
        }),
      );
    }),
  );
  return out;
}

/**
 * Every whitelisted NFT held by `owner`, across all collection chains.
 * Throws only if EVERY chain lookup failed.
 */
export async function listAllowedNfts(
  owner: `0x${string}`,
  alchemyKey: string | null,
): Promise<NftItem[]> {
  const byChain = (id: CollectionChainId) => ALLOWED_COLLECTIONS.filter((c) => c.chainId === id);
  const jobs: Array<Promise<NftItem[]>> = [];

  const eth = byChain(CHAIN_ETHEREUM);
  if (eth.length)
    jobs.push(alchemyKey ? viaAlchemy("eth-mainnet", alchemyKey, owner, eth) : viaRpc(owner, eth));

  const ape = byChain(CHAIN_APECHAIN);
  if (ape.length)
    jobs.push(
      (alchemyKey
        ? viaAlchemy("apechain-mainnet", alchemyKey, owner, ape)
        : Promise.reject()
      ).catch(() => viaRpc(owner, ape)),
    );

  const rh = byChain(CHAIN_ROBINHOOD);
  if (rh.length) jobs.push(viaBlockscout(owner, rh).catch(() => viaRpc(owner, rh)));

  const settled = await Promise.allSettled(jobs);
  const ok = settled.filter(
    (r): r is PromiseFulfilledResult<NftItem[]> => r.status === "fulfilled",
  );
  if (ok.length === 0 && settled.length > 0) {
    const first = settled[0] as PromiseRejectedResult;
    throw first.reason instanceof Error ? first.reason : new Error("NFT lookup failed");
  }
  const items = ok.flatMap((r) => r.value);
  items.sort((a, b) => (a.collection ?? "").localeCompare(b.collection ?? ""));
  return items;
}
