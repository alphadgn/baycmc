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

const CHAIN_CONFIG = {
  [CHAIN_ETHEREUM]: {
    chain: mainnet,
    urls: () => [
      env("ETH_RPC_URL"),
      "https://eth.llamarpc.com",
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.ankr.com/eth",
    ],
  },
  [CHAIN_APECHAIN]: {
    chain: apeChain,
    urls: () => [
      env("APECHAIN_RPC_URL"),
      "https://rpc.apechain.com/http",
      "https://apechain.calderachain.xyz/http",
    ],
  },
  [CHAIN_ROBINHOOD]: {
    chain: robinhood,
    urls: () => [env("ROBINHOOD_RPC_URL"), ...robinhood.rpcUrls.default.http],
  },
} as const;

const clients = new Map<number, PublicClient>();

export function publicClientFor(chainId: CollectionChainId): PublicClient {
  const hit = clients.get(chainId);
  if (hit) return hit;
  const cfg = CHAIN_CONFIG[chainId];
  const urls = cfg.urls().filter((u): u is string => Boolean(u));
  const client = createPublicClient({
    chain: cfg.chain,
    transport: fallback(
      urls.map((u) =>
        http(u, { timeout: 10_000, retryCount: 2, batch: { batchSize: 50, wait: 16 } }),
      ),
      { rank: false, retryCount: 1 },
    ),
  }) as unknown as PublicClient;
  clients.set(chainId, client);
  return client;
}
