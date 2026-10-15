/**
 * Whitelisted-NFT holdings for one wallet, read LIVE from the chain each
 * collection actually lives on. Server-only.
 *
 *   Ethereum  → Alchemy NFT API (contract-filtered, paginated), else RPC
 *   ApeChain  → Alchemy NFT API (apechain-mainnet, paginated), else RPC
 *   Robinhood → RPC: Transfer logs in/out (its explorer API blocks servers
 *               and Temp Agency isn't ERC721Enumerable)
 *
 * Each chain runs independently with its own time budget: one slow or
 * failing chain no longer blanks the whole wallet ("1 wallet lookup
 * unavailable"); it is reported in `errors` while the rest still shows.
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

export interface WalletNfts {
  items: NftItem[];
  /** Human-readable per-chain problems (partial results still returned). */
  errors: string[];
}

const ENUM_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

const FETCH_TIMEOUT_MS = 12_000;
const CHAIN_BUDGET_MS = 28_000;
const MAX_PAGES = 10; // Alchemy: 100 per page → up to 1,000 per wallet
const MAX_IDS = 1_000;
const SERVER_METADATA = 12; // the rest load their metadata in the browser

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function withBudget<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} took too long`)), CHAIN_BUDGET_MS),
    ),
  ]);
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

// ── Alchemy (paginated) ────────────────────────────────────────────────────

interface AlchemyNftResponse {
  ownedNfts?: Array<{
    contract?: { address?: string; name?: string; openSeaMetadata?: { collectionName?: string } };
    tokenId?: string;
    name?: string;
    image?: { cachedUrl?: string; thumbnailUrl?: string; originalUrl?: string };
  }>;
  pageKey?: string | null;
}

async function viaAlchemy(
  network: "eth-mainnet" | "apechain-mainnet",
  key: string,
  owner: string,
  cols: AllowedCollection[],
): Promise<NftItem[]> {
  const filter = cols.map((c) => `&contractAddresses[]=${c.contract}`).join("");
  const base = `https://${network}.g.alchemy.com/nft/v3/${key}/getNFTsForOwner?owner=${owner}&withMetadata=true&pageSize=100${filter}`;
  const out: NftItem[] = [];
  let pageKey: string | null | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = pageKey ? `${base}&pageKey=${encodeURIComponent(pageKey)}` : base;
    const resp = await fetchJson<AlchemyNftResponse>(url);
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
    pageKey = resp.pageKey;
    if (!pageKey) break;
  }
  return out;
}

// ── RPC paths ──────────────────────────────────────────────────────────────

type Client = ReturnType<typeof publicClientFor>;

/** Token ids owned via ERC721Enumerable, or null if unsupported. */
async function idsViaEnumerable(
  client: Client,
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


const LOGS_BUDGET_MS = 15_000;
const MAX_LOG_SPLITS = 64;

type TransferLog = Awaited<ReturnType<Client["getLogs"]>>[number] & {
  args: { from?: `0x${string}`; to?: `0x${string}`; tokenId?: bigint };
};

/**
 * eth_getLogs over [from, to]; public nodes often reject a whole-history
 * range ("block range too large" / "too many results"), so on error the range
 * is split in half and retried, within a time budget. Throws if it can't
 * finish — the caller then shows a "Collection × N" card instead.
 */
async function logsAdaptive(
  client: Client,
  address: `0x${string}`,
  args: { from?: `0x${string}`; to?: `0x${string}` },
  from: bigint,
  to: bigint,
  deadline: number,
  budget = { splits: 0 },
): Promise<TransferLog[]> {
  if (Date.now() > deadline) throw new Error("log scan out of time");
  try {
    return (await client.getLogs({
      address,
      event: TRANSFER_EVENT,
      args,
      fromBlock: from,
      toBlock: to,
    })) as TransferLog[];
  } catch (e) {
    if (to - from < 1_000n || ++budget.splits > MAX_LOG_SPLITS) throw e;
    const mid = from + (to - from) / 2n;
    const left = await logsAdaptive(client, address, args, from, mid, deadline, budget);
    const right = await logsAdaptive(client, address, args, mid + 1n, to, deadline, budget);
    return [...left, ...right];
  }
}

/** Replay ordered transfer events → token ids currently held. */
export function holdingsFromTransfers(events: { id: bigint; in: boolean }[]): Set<bigint> {
  const held = new Set<bigint>();
  for (const e of events) {
    if (e.in) held.add(e.id);
    else held.delete(e.id);
  }
  return held;
}

/**
 * Current holdings from Transfer logs alone (2 requests): every token sent
 * TO the wallet, minus those later sent FROM it, by (block, logIndex) order.
 */
async function idsViaTransferLogs(
  client: Client,
  address: `0x${string}`,
  owner: `0x${string}`,
): Promise<string[] | null> {
  const deadline = Date.now() + LOGS_BUDGET_MS;
  try {
    const latest = await client.getBlockNumber();
    const [incoming, outgoing] = await Promise.all([
      logsAdaptive(client, address, { to: owner }, 0n, latest, deadline),
      logsAdaptive(client, address, { from: owner }, 0n, latest, deadline),
    ]);
    const pos = (l: { blockNumber: bigint | null; logIndex: number | null }) =>
      (l.blockNumber ?? 0n) * 100_000n + BigInt(l.logIndex ?? 0);
    const events = [
      ...incoming.map((l) => ({ id: l.args.tokenId, at: pos(l), in: true })),
      ...outgoing.map((l) => ({ id: l.args.tokenId, at: pos(l), in: false })),
    ]
      .filter((e): e is { id: bigint; at: bigint; in: boolean } => typeof e.id === "bigint")
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const held = holdingsFromTransfers(events);
    return [...held]
      .sort((a, b) => (a < b ? -1 : 1))
      .slice(0, MAX_IDS)
      .map((x) => x.toString());
  } catch (e) {
    console.warn("[nft-holdings] transfer-log lookup failed", address, e);
    return null;
  }
}

/**
 * tokenURIs without one call per token: read one, and if it ends with the
 * token id (".../123" or ".../123.json") derive the rest from that pattern.
 */
async function tokenUris(
  client: Client,
  address: `0x${string}`,
  ids: string[],
): Promise<(string | null)[]> {
  if (ids.length === 0) return [];
  const read = (id: string) =>
    client
      .readContract({ address, abi: ENUM_ABI, functionName: "tokenURI", args: [BigInt(id)] })
      .then((u) => ipfs(u) ?? u)
      .catch(() => null);
  const firstId = ids[0] as string;
  const first = await read(firstId);
  const m = first?.match(new RegExp(`^(.*[/=])${firstId}(\\.json)?$`));
  if (first && m) {
    const [, prefix, suffix = ""] = m;
    return ids.map((id) => `${prefix}${id}${suffix}`);
  }
  // No pattern: read a bounded number individually, the rest stay unknown.
  const head = await Promise.all(ids.slice(0, 48).map(read));
  return ids.map((_, i) => (i < head.length ? (head[i] ?? null) : null));
}

async function viaRpc(owner: `0x${string}`, cols: AllowedCollection[]): Promise<NftItem[]> {
  const out: NftItem[] = [];
  await Promise.all(
    cols.map(async (col) => {
      const client = publicClientFor(col.chainId);
      const address = col.contract as `0x${string}`;
      const contract = col.contract.toLowerCase();
      const balance = await client.readContract({
        address,
        abi: ENUM_ABI,
        functionName: "balanceOf",
        args: [owner],
      });
      if (balance === 0n) return;

      let ids = await idsViaEnumerable(client, address, owner, balance);
      if (!ids && col.chainId !== CHAIN_ETHEREUM) {
        ids = await idsViaTransferLogs(client, address, owner);
      }
      if (!ids || ids.length === 0) {
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

      const uris = await tokenUris(client, address, ids);
      await Promise.all(
        ids.map(async (tokenId, i) => {
          const uri = uris[i] ?? null;
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

// ── Public API ─────────────────────────────────────────────────────────────

const CHAIN_LABEL: Record<CollectionChainId, string> = {
  [CHAIN_ETHEREUM]: "Ethereum",
  [CHAIN_APECHAIN]: "ApeChain",
  [CHAIN_ROBINHOOD]: "Robinhood Chain",
};

/** Every whitelisted NFT held by `owner`, chain by chain. Never throws. */
export async function listAllowedNfts(
  owner: `0x${string}`,
  alchemyKey: string | null,
): Promise<WalletNfts> {
  const byChain = (id: CollectionChainId) => ALLOWED_COLLECTIONS.filter((c) => c.chainId === id);
  const jobs: Array<{ chain: CollectionChainId; run: () => Promise<NftItem[]> }> = [];

  const eth = byChain(CHAIN_ETHEREUM);
  if (eth.length)
    jobs.push({
      chain: CHAIN_ETHEREUM,
      run: () =>
        alchemyKey
          ? viaAlchemy("eth-mainnet", alchemyKey, owner, eth).catch(() => viaRpc(owner, eth))
          : viaRpc(owner, eth),
    });
  const ape = byChain(CHAIN_APECHAIN);
  if (ape.length)
    jobs.push({
      chain: CHAIN_APECHAIN,
      run: () =>
        alchemyKey
          ? viaAlchemy("apechain-mainnet", alchemyKey, owner, ape).catch(() => viaRpc(owner, ape))
          : viaRpc(owner, ape),
    });
  const rh = byChain(CHAIN_ROBINHOOD);
  if (rh.length) jobs.push({ chain: CHAIN_ROBINHOOD, run: () => viaRpc(owner, rh) });

  const settled = await Promise.allSettled(
    jobs.map((j) => withBudget(j.run(), CHAIN_LABEL[j.chain])),
  );
  const items: NftItem[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else {
      const chain = CHAIN_LABEL[jobs[i]!.chain];
      console.warn("[nft-holdings]", chain, r.reason);
      errors.push(`${chain} NFTs couldn't be loaded right now.`);
    }
  });
  items.sort((a, b) => (a.collection ?? "").localeCompare(b.collection ?? ""));
  return { items, errors };
}
