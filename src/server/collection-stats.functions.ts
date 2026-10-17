import { createServerFn } from "@tanstack/react-start";
import { BAYC_CONTRACT } from "@/lib/web3/constants";

/**
 * Live BAYC collection size for the landing page.
 *
 * Source of truth is OpenSea (https://opensea.io/collection/boredapeyachtclub)
 * via its v2 API — the OPENSEA_API_KEY secret if set, otherwise a free
 * instant key the server mints itself. Only if OpenSea has never answered do
 * we fall back to the contract's on-chain totalSupply(). Cached 5 minutes.
 */
const SLUG = "boredapeyachtclub";
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
      : prev?.supply && prev.source === "opensea"
        ? // OpenSea briefly unavailable: keep its last number rather than
          // switch sources (the contract counts differently than OpenSea).
          { supply: prev.supply, source: "opensea" }
        : await fromChain().then((n) =>
            n !== null ? { supply: n, source: "chain" as const } : null,
          );
  if (!result) return { supply: null, source: null };
  cache = { ...result, at: Date.now() };
  if (os !== null || !prev) {
    await db.from("app_settings").upsert({
      key: SUPPLY_SETTING,
      value: { supply: result.supply, source: result.source, at: cache.at },
      updated_at: new Date().toISOString(),
    });
  }
  return result;
});
