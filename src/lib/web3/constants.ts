// BAYC mainnet contract
export const BAYC_CONTRACT = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;

// MAYC mainnet contract
export const MAYC_CONTRACT = "0x60E4d786628Fea6478F785A6d7e704777c86a7c6" as const;

// Chains the whitelisted collections live on.
export const CHAIN_ETHEREUM = 1 as const;
export const CHAIN_APECHAIN = 33139 as const;
export const CHAIN_ROBINHOOD = 4663 as const;
export type CollectionChainId =
  typeof CHAIN_ETHEREUM | typeof CHAIN_APECHAIN | typeof CHAIN_ROBINHOOD;

// Whitelisted collections (single source of truth). Holding any of these
// grants VIP entrance and shows the NFTs on the holder's profile. Each
// collection is checked ON ITS OWN CHAIN — Orca Business is an ApeChain
// contract and Temp Agency a Robinhood Chain contract; checking them on
// Ethereum always returned 0 (those addresses are empty accounts there).
// `tips: true` = holders may receive $APE tips while performing karaoke.
// Every collection the app knows about. `active: false` keeps a collection's
// name + address on file for later activation but grants NOTHING: no sign-in
// / VIP access, no NFT display, no tips. Flip to `true` to re-enable.
export const COLLECTION_REGISTRY = [
  {
    label: "BAYC",
    name: "Bored Ape Yacht Club",
    contract: BAYC_CONTRACT,
    chainId: CHAIN_ETHEREUM,
    tips: true,
    access: "full",
    active: true,
  },
  {
    label: "MAYC",
    name: "Mutant Ape Yacht Club",
    contract: MAYC_CONTRACT,
    chainId: CHAIN_ETHEREUM,
    tips: true,
    access: "full",
    active: true,
  },
  {
    label: "PUNKS",
    name: "CryptoPunks",
    contract: "0xb47e3cd837dDF8e4c57F05d70Ab865de6e193BBB",
    chainId: CHAIN_ETHEREUM,
    tips: true,
    access: "full",
    active: true,
  },
  {
    label: "TEMP_AGENCY",
    name: "Temp Agency",
    contract: "0xc60283eBe17F6A6d7b49C1Df3602f440D98f5d25",
    chainId: CHAIN_ROBINHOOD,
    tips: true,
    access: "partner",
    active: true,
  },
  {
    label: "UGLY_DUCK_LABS",
    name: "Ugly Duck Labs",
    contract: "0xc3914cc9B40996532F1690Fa570B25B742c34b9a",
    chainId: CHAIN_ETHEREUM,
    tips: true,
    access: "partner",
    active: true,
  },
  {
    label: "ORCA_BUSINESS",
    name: "Orca Business",
    contract: "0xF3DFD71822b10F9F1e6f21097C29E36c4f3952c0",
    chainId: CHAIN_APECHAIN,
    tips: true,
    access: "partner",
    active: true,
  },
  {
    label: "PUDGY_PENGUINS",
    name: "Pudgy Penguins",
    contract: "0xBd3531dA5CF5857e7CfAA92426877b022e612cf8",
    chainId: CHAIN_ETHEREUM,
    tips: false,
    access: "full",
    active: false, // inactive — kept for later activation
  },
  {
    label: "LIL_PUDGYS",
    name: "Lil Pudgys",
    contract: "0x524cAB2ec69124574082676e6F654a18df49A048",
    chainId: CHAIN_ETHEREUM,
    tips: false,
    access: "full",
    active: false, // inactive — kept for later activation
  },
] as const;

export type RegisteredCollection = (typeof COLLECTION_REGISTRY)[number];
export type AllowedCollection = RegisteredCollection;

/** Collections that currently count for anything (sign-in, display, tips). */
export const ALLOWED_COLLECTIONS: readonly AllowedCollection[] = COLLECTION_REGISTRY.filter(
  (c) => c.active,
);

/**
 * Access tiers:
 *  - "full"    (BAYC, MAYC, CryptoPunks): the holder clubhouse — Holders Chat,
 *              Conference Rooms, Calendar, Ape Rides, … (bayc_verified).
 *  - "partner" (Temp Agency, Orca Business, Ugly Duck Labs): the regular
 *              member menu PLUS Ape Rides only.
 */
export const FULL_ACCESS_LABELS: readonly string[] = ALLOWED_COLLECTIONS.filter(
  (c) => c.access === "full",
).map((c) => c.label);
export const PARTNER_LABELS: readonly string[] = ALLOWED_COLLECTIONS.filter(
  (c) => c.access === "partner",
).map((c) => c.label);
export function hasFullAccess(labels: readonly string[]): boolean {
  return labels.some((l) => FULL_ACCESS_LABELS.includes(l));
}
export function hasPartnerAccess(labels: readonly string[]): boolean {
  return labels.some((l) => PARTNER_LABELS.includes(l));
}

/** Human name for a stored label (e.g. "UGLY_DUCK_LABS" → "Ugly Duck Labs"). */
export function collectionNameForLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  return COLLECTION_REGISTRY.find((c) => c.label === label)?.name ?? label;
}

export function collectionByContract(contract: string): AllowedCollection | null {
  const c = contract.toLowerCase();
  return ALLOWED_COLLECTIONS.find((a) => a.contract.toLowerCase() === c) ?? null;
}

/** Collections whose holders can receive karaoke tips. */
export const TIP_COLLECTIONS = ALLOWED_COLLECTIONS.filter((c) => c.tips);

export type CollectionLabel = (typeof ALLOWED_COLLECTIONS)[number]["label"];

export const REQUIRED_COLLECTIONS = ALLOWED_COLLECTIONS.map(
  (c) => c.contract as `0x${string}`,
) as readonly `0x${string}`[];

export function isAllowedCollection(contract: string): boolean {
  return collectionByContract(contract) !== null;
}

// $APE tips are sent as native APE on ApeChain (cents in gas, and Glyph is an
// ApeChain wallet). Bounds keep a fat-finger from emptying a wallet.
export const TIP_CHAIN_ID = CHAIN_APECHAIN;
export const TIP_STEP_APE = 1;
export const TIP_MAX_APE = 1000;

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
