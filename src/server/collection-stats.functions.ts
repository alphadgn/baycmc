import { createServerFn } from "@tanstack/react-start";
import { BAYC_CONTRACT } from "@/lib/web3/constants";

/**
 * Live BAYC collection size for the landing page.
 *
 * Source of truth is OpenSea (https://opensea.io/collection/boredapeyachtclub)
 * via its v2 API, which requires the OPENSEA_API_KEY secret. If the key is
 * missing or OpenSea is down, we read totalSupply() straight from the BAYC
 * contract on Ethereum so the number is still live, never a hard-coded guess.
 * Cached in memory for 5 minutes per server instance.
 */
const SLUG = "boredapeyachtclub";
const TTL_MS = 5 * 60_000;
let cache: { supply: number; source: "opensea" | "chain"; at: number } | null = null;

async function fromOpenSea(): Promise<number | null> {
  const key = process.env.OPENSEA_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch(`https://api.opensea.io/api/v2/collections/${SLUG}`, {
      headers: { accept: "application/json", "x-api-key": key },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      console.warn("[collection-stats] OpenSea", res.status);
      return null;
    }
    const json = (await res.json()) as { total_supply?: number | string };
    const n = Number(json.total_supply);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) {
    console.warn("[collection-stats] OpenSea failed", e);
    return null;
  }
}

async function fromChain(): Promise<number | null> {
  try {
    const { createPublicClient, http } = await import("viem");
    const { mainnet } = await import("viem/chains");
    const client = createPublicClient({
      chain: mainnet,
      transport: http(process.env.ETH_RPC_URL?.trim() || "https://ethereum-rpc.publicnode.com", {
        timeout: 6_000,
      }),
    });
    const n = await client.readContract({
      address: BAYC_CONTRACT,
      abi: [
        {
          type: "function",
          name: "totalSupply",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "uint256" }],
        },
      ] as const,
      functionName: "totalSupply",
    });
    return Number(n);
  } catch (e) {
    console.warn("[collection-stats] on-chain totalSupply failed", e);
    return null;
  }
}

export const getBaycSupply = createServerFn({ method: "GET" }).handler(async () => {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { supply: cache.supply, source: cache.source };
  }
  const os = await fromOpenSea();
  if (os !== null) {
    cache = { supply: os, source: "opensea", at: Date.now() };
    return { supply: os, source: "opensea" as const };
  }
  const chain = await fromChain();
  if (chain !== null) {
    cache = { supply: chain, source: "chain", at: Date.now() };
    return { supply: chain, source: "chain" as const };
  }
  if (cache) return { supply: cache.supply, source: cache.source };
  return { supply: null, source: null };
});
