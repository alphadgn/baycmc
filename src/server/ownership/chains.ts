/**
 * Read-only RPC clients for every chain a whitelisted collection lives on.
 * Server-only. Each chain uses an optional private RPC secret first, then
 * public fallbacks.
 */
import { createPublicClient, defineChain, fallback, http, type PublicClient } from "viem";
import { apeChain, mainnet } from "viem/chains";
import {
  CHAIN_APECHAIN,
  CHAIN_ETHEREUM,
  CHAIN_ROBINHOOD,
  type CollectionChainId,
} from "@/lib/web3/constants";

// The installed viem release does not export Robinhood Chain, so define it
// locally. ROBINHOOD_RPC_URL (secret) first, then Robinhood's public RPC
// (rate-limited, but verified working for balanceOf reads).
const robinhood = defineChain({
  id: CHAIN_ROBINHOOD,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

function env(name: string): string | undefined {
  return (typeof process !== "undefined" && process.env?.[name]?.trim()) || undefined;
}

/**
 * The project's Alchemy key: ALCHEMY_API_KEY, else parsed from an Alchemy
 * ETH_RPC_URL. Alchemy serves all three collection chains (eth-mainnet,
 * apechain-mainnet, robinhood-mainnet), so ownership checks no longer depend
 * on rate-limited public nodes — those failures used to make a sign-in skip
 * collections the member really held.
 */
export function alchemyKey(): string | null {
  const direct = env("ALCHEMY_API_KEY");
  if (direct) return direct;
  const rpc = env("ETH_RPC_URL");
  if (!rpc) return null;
  try {
    const u = new URL(rpc);
    if (!u.hostname.endsWith("alchemy.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}
function alchemyRpc(network: string): string | undefined {
  const key = alchemyKey();
  return key ? `https://${network}.g.alchemy.com/v2/${key}` : undefined;
}

const CHAIN_CONFIG = {
  [CHAIN_ETHEREUM]: {
    chain: mainnet,
    urls: () => [
      env("ETH_RPC_URL"),
      alchemyRpc("eth-mainnet"),
      "https://eth.llamarpc.com",
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.ankr.com/eth",
    ],
  },
  [CHAIN_APECHAIN]: {
    chain: apeChain,
    urls: () => [
      env("APECHAIN_RPC_URL"),
      alchemyRpc("apechain-mainnet"),
      "https://rpc.apechain.com/http",
      "https://apechain.calderachain.xyz/http",
    ],
  },
  [CHAIN_ROBINHOOD]: {
    chain: robinhood,
    urls: () => [
      env("ROBINHOOD_RPC_URL"),
      alchemyRpc("robinhood-mainnet"),
      ...robinhood.rpcUrls.default.http,
    ],
  },
} as const;

const clients = new Map<number, PublicClient>();

export function publicClientFor(chainId: CollectionChainId): PublicClient {
  const hit = clients.get(chainId);
  if (hit) return hit;
  const cfg = CHAIN_CONFIG[chainId];
  const urls = [...new Set(cfg.urls().filter((u): u is string => Boolean(u)))];
  const client = createPublicClient({
    chain: cfg.chain,
    transport: fallback(
      urls.map((u) =>
        http(u, {
          // Robinhood: shorter per-call timeout so an over-wide log query
          // fails fast and gets split instead of eating the whole budget.
          timeout: chainId === CHAIN_ROBINHOOD ? 7_000 : 10_000,
          retryCount: chainId === CHAIN_ROBINHOOD ? 1 : 2,
          // Robinhood's public node isn't known to accept JSON-RPC batches;
          // its calls are few (balanceOf, Transfer logs), so send them plain.
          batch: chainId === CHAIN_ROBINHOOD ? false : { batchSize: 50, wait: 16 },
        }),
      ),
      { rank: false, retryCount: 1 },
    ),
  }) as unknown as PublicClient;
  clients.set(chainId, client);
  return client;
}
