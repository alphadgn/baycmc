// BAYC mainnet contract
export const BAYC_CONTRACT = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as const;

// delegate.cash v2 registry (mainnet)
export const DELEGATE_REGISTRY_V2 = "0x00000000000000447e69651d841bD8D104Bed493" as const;

// Reown AppKit project ID — replace with your own from https://cloud.reown.com
// (a free public ID is fine for dev; a real one is required for production)
export const REOWN_PROJECT_ID =
  import.meta.env.VITE_REOWN_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694";

// Public mainnet RPC fallback — for production, set VITE_ETH_RPC_URL to a paid provider
export const ETH_RPC_URL =
  import.meta.env.VITE_ETH_RPC_URL || "https://eth.llamarpc.com";
