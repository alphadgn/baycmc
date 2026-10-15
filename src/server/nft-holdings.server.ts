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
import { parseAbi, parseAbiItem } from "viem";
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
  /** tokenURI to load in the browser when the server didn't fetch it. */
  metadataUrl?: string | null;
  openseaUrl: string;
}

const ENUM_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
const OWNER_ABI = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

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

const MAX_IDS = 300; // per collection per wallet
const SERVER_METADATA = 24; // rest load their metadata in the browser

/** Token ids owned via ERC721Enumerable, or null if unsupported. */
async function idsViaEnumerable(
  client: ReturnType<typeof publicClientFor>,
  address: `0x${string}`,
  owner: `0x${string}`,
  balance: bigint,
): Promise<string[] | null> {
  const n = Number(balance > BigInt(MAX_IDS) ? BigInt(MAX_IDS) : balance);
  try {
    const first = await client.readContract({
      address,
      abi: ENUM_ABI,
      functionName: "tokenOfOwnerByIndex",
      args: [owner, 0n],
    });
    // The transport batches these into one HTTP request.
    const rest = await Promise.all(
      Array.from({ length: n - 1 }, (_, i) =>
        client
          .readContract({
            address,
            abi: ENUM_ABI,
            functionName: "tokenOfOwnerByIndex",
            args: [owner, BigInt(i + 1)],
          })
          .catch(() => null),
      ),
    );
    return [first, ...rest].filter((x): x is bigint => x !== null).map((x) => x.toString());
  } catch {
    return null;
  }
}

/**
 * Non-enumerable contracts (e.g. Temp Agency on Robinhood Chain, whose
 * explorer API blocks server requests): find every token ever transferred
 * TO the wallet from the contract's Transfer logs, then keep the ones it
 * still owns (ownerOf). Used off-Ethereum only (young chains, cheap logs).
 */
async function idsViaTransferLogs(
  client: ReturnType<typeof publicClientFor>,
  address: `0x${string}`,
  owner: `0x${string}`,
): Promise<string[] | null> {
  try {
    const logs = await client.getLogs({
      address,
      event: TRANSFER_EVENT,
      args: { to: owner },
      fromBlock: 0n,
      toBlock: "latest",
    });
    const candidates = [
      ...new Set(
        logs
          .map((l) => (l.args as { tokenId?: bigint }).tokenId)
          .filter((t): t is bigint => typeof t === "bigint"),
      ),
    ].slice(0, MAX_IDS * 2);
    const owners = await Promise.all(
      candidates.map((id) =>
        client
          .readContract({ address, abi: OWNER_ABI, functionName: "ownerOf", args: [id] })
          .catch(() => null),
      ),
    );
    const mine = candidates.filter(
      (_, i) => (owners[i] as string | null)?.toLowerCase() === owner.toLowerCase(),
    );
    mine.sort((x, y) => (x < y ? -1 : 1));
    return mine.slice(0, MAX_IDS).map((x) => x.toString());
  } catch (e) {
    console.warn("[nft-holdings] transfer-log lookup failed", address, e);
    return null;
  }
}

/** Plain RPC path: balanceOf → token ids → tokenURI (+ metadata). */
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

      let ids = await idsViaEnumerable(client, address, owner, balance);
      if (!ids && col.chainId !== CHAIN_ETHEREUM) {
        ids = await idsViaTransferLogs(client, address, owner);
      }
      if (!ids || ids.length === 0) {
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

      const uris = await Promise.all(
        ids.map((id) =>
          client
            .readContract({
              address,
              abi: ENUM_ABI,
              functionName: "tokenURI",
              args: [BigInt(id)],
            })
            .catch(() => null),
        ),
      );
      await Promise.all(
        ids.map(async (tokenId, i) => {
          const uri = uris[i] ? (ipfs(uris[i]) ?? uris[i]) : null;
          let image: string | null = null;
          let name: string | null = null;
          if (uri && i < SERVER_METADATA) {
            try {
              const meta = await fetchJson<{ name?: string; image?: string }>(uri);
              image = ipfs(meta.image);
              name = meta.name ?? null;
            } catch {
              /* metadata optional */
            }
          }
          out.push({
            contract,
            tokenId,
            name: name ?? `${col.name} #${tokenId}`,
            collection: col.name,
            image,
            metadataUrl: image ? null : uri,
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
  // Robinhood's Blockscout API answers servers with a Cloudflare challenge
  // (403), so read the chain directly.
  if (rh.length) jobs.push(viaRpc(owner, rh));

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
