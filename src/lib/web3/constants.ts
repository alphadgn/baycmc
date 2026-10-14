// BAYC mainnet contract
export const BAYC_CONTRACT = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;

// MAYC mainnet contract
export const MAYC_CONTRACT = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" as const;

// Collections that grant clubhouse access (single source of truth).
export const REQUIRED_COLLECTIONS = [BAYC_CONTRACT, MAYC_CONTRACT] as const;

// delegate.cash v2 registry (mainnet)
export const DELEGATE_REGISTRY_V2 = "0x00000000000000447e69651d841bD8D104Bed493" as const;

// WalletConnect (Reown) project ID. Must be YOUR project, created at
// https://dashboard.reown.com, with every domain the app runs on allow-listed
// (baycmc.app, your *.lovable.app preview). The old hard-coded fallback ID
// belonged to someone else and isn't allowed on this domain, so WalletConnect
// opened and showed "Invalid App Configuration". With no ID set, the
// WalletConnect option is simply hidden instead of failing.
export const REOWN_PROJECT_ID: string = (import.meta.env.VITE_REOWN_PROJECT_ID ?? "").trim();

// Resolution order:
//   1. process.env.ETH_RPC_URL          — runtime Cloudflare Worker secret
//   2. import.meta.env.VITE_ETH_RPC_URL — build-time Vite var
//   3. public LlamaRPC fallback         — heavily rate-limited, dev only
export const ETH_RPC_URL =
  (typeof process !== "undefined" && process.env?.ETH_RPC_URL) ||
  import.meta.env.VITE_ETH_RPC_URL ||
  "https://eth.llamarpc.com";
