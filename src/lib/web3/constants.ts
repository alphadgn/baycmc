// BAYC mainnet contract
export const BAYC_CONTRACT = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;

// MAYC mainnet contract
export const MAYC_CONTRACT = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" as const;

// Whitelisted collections (single source of truth). Holding any of these
// grants VIP entrance and shows the NFTs on the holder's profile. Per-collection
// menu unlocks can be layered on later using `label`.
export const ALLOWED_COLLECTIONS = [
  { label: "BAYC", name: "Bored Ape Yacht Club", contract: BAYC_CONTRACT },
  { label: "MAYC", name: "Mutant Ape Yacht Club", contract: MAYC_CONTRACT },
  { label: "PUNKS", name: "CryptoPunks", contract: "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB" },
  { label: "TEMP_AGENCY", name: "Temp Agency", contract: "0xc60283eBe17F6A6d7b49C1Df3602f440D98f5d25" },
  { label: "UGLY_DUCK_LABS", name: "Ugly Duck Labs", contract: "0xc3914cc9B40996532F1690Fa570B25B742c34b9a" },
  { label: "ORCA_BUSINESS", name: "Orca Business", contract: "0xF3DFD71822b10F9F1e6f21097C29E36c4f3952c0" },
  { label: "PUDGY_PENGUINS", name: "Pudgy Penguins", contract: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8" },
  { label: "LIL_PUDGYS", name: "Lil Pudgys", contract: "0x524cAB2ec69124574082676e6F654a18df49A048" },
] as const;

export type CollectionLabel = (typeof ALLOWED_COLLECTIONS)[number]["label"];

export const REQUIRED_COLLECTIONS = ALLOWED_COLLECTIONS.map(
  (c) => c.contract as `0x${string}`,
) as readonly `0x${string}`[];

export function isAllowedCollection(contract: string): boolean {
  const c = contract.toLowerCase();
  return ALLOWED_COLLECTIONS.some((a) => a.contract.toLowerCase() === c);
}

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
