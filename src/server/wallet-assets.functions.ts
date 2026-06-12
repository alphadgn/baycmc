import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isAddress, getAddress } from "viem";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Wallet assets / activity server fns.
 *
 * Powered by Alchemy NFT + Transfers APIs over the same key as ETH_RPC_URL.
 * The Alchemy NFT API and Transfers API share the project key — we just
 * strip the v2/ prefix and substitute the right path.
 */

function parseAlchemyRpc(): { protocol: string; host: string; key: string } | null {
  const rpc = process.env.ETH_RPC_URL?.trim();
  if (!rpc) return null;
  try {
    const u = new URL(rpc);
    if (!u.hostname.endsWith("alchemy.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const key = parts[parts.length - 1];
    if (!key) return null;
    return { protocol: u.protocol, host: u.host, key };
  } catch {
    return null;
  }
}

function alchemyNftBaseUrl(): string | null {
  const p = parseAlchemyRpc();
  return p ? `${p.protocol}//${p.host}/nft/v3/${p.key}` : null;
}

function alchemyCoreBaseUrl(): string | null {
  const rpc = process.env.ETH_RPC_URL?.trim();
  if (!rpc) return null;
  try {
    const u = new URL(rpc);
    if (!u.hostname.endsWith("alchemy.com")) return null;
    return rpc;
  } catch {
    return null;
  }
}

const fetchTimeoutMs = 12_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from upstream`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

export interface NftItem {
  contract: string;
  tokenId: string;
  name: string | null;
  collection: string | null;
  image: string | null;
  openseaUrl: string;
}

interface AlchemyNftResponse {
  ownedNfts?: Array<{
    contract?: { address?: string; name?: string; openSeaMetadata?: { collectionName?: string } };
    tokenId?: string;
    name?: string;
    image?: { cachedUrl?: string; thumbnailUrl?: string; originalUrl?: string };
  }>;
}

/**
 * List the NFTs owned by a wallet address. Caller must be authenticated.
 * Returns up to 100 NFTs sorted by collection.
 */
export const listWalletNfts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) =>
    z.object({ address: z.string().min(10).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!isAddress(data.address)) {
      return { ok: false as const, reason: "invalid-address" as const, items: [] };
    }
    const owner = getAddress(data.address);
    const base = alchemyNftBaseUrl();
    if (!base) {
      return {
        ok: false as const,
        reason: "NFT lookup requires an Alchemy ETH_RPC_URL.",
        items: [],
      };
    }
    const url = `${base}/getNFTsForOwner?owner=${owner}&withMetadata=true&pageSize=100`;
    try {
      const resp = await fetchJson<AlchemyNftResponse>(url);
      const items: NftItem[] = (resp.ownedNfts ?? []).map((n) => {
        const contract = (n.contract?.address ?? "").toLowerCase();
        const tokenId = n.tokenId ?? "";
        const collection = n.contract?.openSeaMetadata?.collectionName ?? n.contract?.name ?? null;
        const image = n.image?.cachedUrl ?? n.image?.thumbnailUrl ?? n.image?.originalUrl ?? null;
        return {
          contract,
          tokenId,
          name: n.name ?? null,
          collection,
          image,
          openseaUrl: `https://opensea.io/assets/ethereum/${contract}/${tokenId}`,
        };
      });
      items.sort((a, b) => (a.collection ?? "").localeCompare(b.collection ?? ""));
      return { ok: true as const, items };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("listWalletNfts failed", msg);
      return { ok: false as const, reason: msg, items: [] };
    }
  });

export interface ActivityItem {
  hash: string;
  category: "external" | "erc20" | "erc721" | "erc1155" | "internal" | "specialnft";
  direction: "in" | "out";
  from: string;
  to: string;
  asset: string | null;
  value: number | null;
  tokenId: string | null;
  blockNum: number;
  timestamp: string | null;
  etherscanUrl: string;
}

interface AlchemyTransfersResponse {
  result?: {
    transfers?: Array<{
      hash?: string;
      from?: string;
      to?: string;
      value?: number | null;
      asset?: string | null;
      category?: string;
      tokenId?: string | null;
      blockNum?: string;
      metadata?: { blockTimestamp?: string };
    }>;
  };
}

/**
 * Recent on-chain activity for a wallet (last ~50 transfers in + out).
 * Uses Alchemy's `alchemy_getAssetTransfers` JSON-RPC method on the same
 * mainnet endpoint as ownership checks.
 */
export const listWalletActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { address: string }) =>
    z.object({ address: z.string().min(10).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    if (!isAddress(data.address)) {
      return { ok: false as const, reason: "invalid-address" as const, items: [] };
    }
    const owner = getAddress(data.address);
    const base = alchemyCoreBaseUrl();

    const categories = ["external", "erc20", "erc721", "erc1155"] as const;
    const body = (direction: "from" | "to") => ({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getAssetTransfers",
      params: [
        {
          fromBlock: "0x0",
          toBlock: "latest",
          [direction === "from" ? "fromAddress" : "toAddress"]: owner,
          category: categories,
          withMetadata: true,
          excludeZeroValue: false,
          maxCount: "0x32", // 50
          order: "desc",
        },
      ],
    });

    try {
      const [outRes, inRes] = await Promise.all([
        fetchJson<AlchemyTransfersResponse>(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body("from")),
        }),
        fetchJson<AlchemyTransfersResponse>(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body("to")),
        }),
      ]);

      const toItem = (
        t: NonNullable<NonNullable<AlchemyTransfersResponse["result"]>["transfers"]>[number],
        direction: "in" | "out",
      ): ActivityItem | null => {
        const hash = t.hash ?? "";
        if (!hash) return null;
        return {
          hash,
          category: (t.category as ActivityItem["category"]) ?? "external",
          direction,
          from: t.from ?? "",
          to: t.to ?? "",
          asset: t.asset ?? null,
          value: typeof t.value === "number" ? t.value : null,
          tokenId: t.tokenId ?? null,
          blockNum: t.blockNum ? parseInt(t.blockNum, 16) : 0,
          timestamp: t.metadata?.blockTimestamp ?? null,
          etherscanUrl: `https://etherscan.io/tx/${hash}`,
        };
      };

      const all: ActivityItem[] = [];
      for (const t of outRes.result?.transfers ?? []) {
        const it = toItem(t, "out");
        if (it) all.push(it);
      }
      for (const t of inRes.result?.transfers ?? []) {
        const it = toItem(t, "in");
        if (it) all.push(it);
      }
      // Dedupe by hash (same tx may appear in both lists for self-sends).
      const seen = new Set<string>();
      const items = all
        .filter((x) => {
          if (seen.has(x.hash)) return false;
          seen.add(x.hash);
          return true;
        })
        .sort((a, b) => b.blockNum - a.blockNum)
        .slice(0, 50);
      return { ok: true as const, items };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("listWalletActivity failed", msg);
      return { ok: false as const, reason: msg, items: [] };
    }
  });
