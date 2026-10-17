import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";
import { BAYC_CONTRACT } from "@/lib/web3/constants";

/**
 * Live BAYC collection size for the landing page.
 *
 * Source of truth is OpenSea (https://opensea.io/collection/boredapeyachtclub)
 * via its v2 API — the OPENSEA_API_KEY secret if set, otherwise a free
 * instant key the server mints itself. When OpenSea can't be reached we count
 * on-chain: the contract's totalSupply() minus apes sent to burn addresses,
 * which matches OpenSea's number. Cached 5 minutes.
 */
const SLUG = "boredapeyachtclub";
const BURN_ADDRESSES = [
  "0x000000000000000000000000000000000000dEaD",
  "0x0000000000000000000000000000000000000001",
] as const;
const TTL_MS = 5 * 60_000;
let cache: { supply: number; source: "opensea" | "chain"; at: number } | null = null;

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const KEY_SETTING = "opensea_instant_key";
const SUPPLY_SETTING = "opensea_bayc_supply";

/**
 * OpenSea API key. Uses the OPENSEA_API_KEY secret when set; otherwise mints
 * a free instant key (POST /api/v2/auth/keys — no account needed, valid 7
 * days) and keeps it server-side in app_settings until it expires.
 */
async function openSeaKey(db: AdminClient, forceNew = false): Promise<string | null> {
  const fixed = process.env.OPENSEA_API_KEY?.trim();
  if (fixed) return fixed;
  if (!forceNew) {
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", KEY_SETTING)
      .maybeSingle();
    const v = data?.value as { api_key?: string; expires_at?: string } | null;
    if (v?.api_key && (!v.expires_at || Date.parse(v.expires_at) - Date.now() > 60 * 60_000)) {
      return v.api_key;
    }
  }
  try {
    const res = await fetch("https://api.opensea.io/api/v2/auth/keys", {
      method: "POST",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn("[collection-stats] instant key", res.status);
      return null;
    }
    const json = (await res.json()) as { api_key?: string; expires_at?: string };
    if (!json.api_key) return null;
    await db.from("app_settings").upsert({
      key: KEY_SETTING,
      value: { api_key: json.api_key, expires_at: json.expires_at ?? null },
      updated_at: new Date().toISOString(),
    });
    return json.api_key;
  } catch (e) {
    console.warn("[collection-stats] instant key failed", e);
    return null;
  }
}

async function fetchCollection(key: string) {
  return fetch(`https://api.opensea.io/api/v2/collections/${SLUG}`, {
    headers: { accept: "application/json", "x-api-key": key },
    signal: AbortSignal.timeout(6_000),
  });
}

async function fromOpenSea(db: AdminClient): Promise<number | null> {
  try {
    let key = await openSeaKey(db);
    if (!key) return null;
    let res = await fetchCollection(key);
    if ((res.status === 401 || res.status === 403) && !process.env.OPENSEA_API_KEY) {
      key = await openSeaKey(db, true);
      if (!key) return null;
      res = await fetchCollection(key);
    }
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
    const urls = [
      process.env.ETH_RPC_URL?.trim(),
      "https://ethereum-rpc.publicnode.com",
      "https://eth.llamarpc.com",
      "https://rpc.ankr.com/eth",
      "https://cloudflare-eth.com",
    ].filter((u): u is string => Boolean(u));
    const client = createPublicClient({
      chain: mainnet,
      transport: fallback(
        urls.map((u) => http(u, { timeout: 6_000, retryCount: 1 })),
        { rank: false, retryCount: 1 },
      ),
    });
    const abi = [
      {
        type: "function",
        name: "totalSupply",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
      },
      {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ] as const;
    const total = await client.readContract({
      address: BAYC_CONTRACT,
      abi,
      functionName: "totalSupply",
    });
    // Apes sent to a burn address are gone for good; OpenSea leaves them
    // out of the collection size, so we do too (10,000 minted − burned).
    const burned = await Promise.all(
      BURN_ADDRESSES.map((a) =>
        client
          .readContract({ address: BAYC_CONTRACT, abi, functionName: "balanceOf", args: [a] })
          .catch(() => 0n),
      ),
    );
    const n = burned.reduce((acc, b) => acc - b, total);
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
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");

  // Shared cache across server instances (one OpenSea call per 5 minutes).
  const { data: saved } = await db
    .from("app_settings")
    .select("value")
    .eq("key", SUPPLY_SETTING)
    .maybeSingle();
  const prev = saved?.value as {
    supply?: number;
    source?: "opensea" | "chain";
    at?: number;
  } | null;
  if (prev?.supply && prev.at && Date.now() - prev.at < TTL_MS) {
    cache = { supply: prev.supply, source: prev.source ?? "opensea", at: prev.at };
    return { supply: prev.supply, source: cache.source };
  }

  const os = await fromOpenSea(db);
  const result: { supply: number; source: "opensea" | "chain" } | null =
    os !== null
      ? { supply: os, source: "opensea" }
      : await fromChain().then((n) =>
          n !== null ? { supply: n, source: "chain" as const } : null,
        );
  if (!result) return { supply: null, source: null };
  cache = { ...result, at: Date.now() };
  await db.from("app_settings").upsert({
    key: SUPPLY_SETTING,
    value: { supply: result.supply, source: result.source, at: cache.at },
    updated_at: new Date().toISOString(),
  });
  return result;
});
