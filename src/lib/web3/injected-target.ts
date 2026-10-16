/**
 * Real name for the generic `window.ethereum` wallet.
 *
 * wagmi's plain injected() connector is labelled "Injected" when the wallet
 * doesn't announce itself via EIP-6963 — which is what in-app wallet
 * browsers (Rabby, MetaMask, Coinbase, Trust… on phones) do. Read the
 * provider's own flags instead so the button says e.g. "Rabby Wallet".
 * Order matters: several wallets also set `isMetaMask` for compatibility.
 */
type Flags = Record<string, unknown>;

const KNOWN: Array<[flag: string, name: string]> = [
  ["isRabby", "Rabby Wallet"],
  ["isGlyph", "Glyph"],
  ["isCoinbaseWallet", "Coinbase Wallet"],
  ["isTrust", "Trust Wallet"],
  ["isTrustWallet", "Trust Wallet"],
  ["isRainbow", "Rainbow"],
  ["isZerion", "Zerion"],
  ["isOkxWallet", "OKX Wallet"],
  ["isOKExWallet", "OKX Wallet"],
  ["isBitKeep", "Bitget Wallet"],
  ["isBitget", "Bitget Wallet"],
  ["isPhantom", "Phantom"],
  ["isUniswapWallet", "Uniswap Wallet"],
  ["isFrame", "Frame"],
  ["isTokenPocket", "TokenPocket"],
  ["isImToken", "imToken"],
  ["isSafePal", "SafePal"],
  ["isExodus", "Exodus"],
  ["isBraveWallet", "Brave Wallet"],
  ["isMetaMask", "MetaMask"],
];

export const GENERIC_WALLET_NAME = "Browser wallet";

export function injectedWalletName(provider: unknown): string {
  if (!provider || typeof provider !== "object") return GENERIC_WALLET_NAME;
  const p = provider as Flags;
  for (const [flag, name] of KNOWN) if (p[flag]) return name;
  return GENERIC_WALLET_NAME;
}

/** wagmi `injected({ target })` value: same id ("injected"), real name. */
export function injectedTarget() {
  const provider =
    typeof window !== "undefined"
      ? (window as unknown as { ethereum?: unknown }).ethereum
      : undefined;
  return {
    id: "injected",
    name: injectedWalletName(provider),
    provider: (w?: unknown) =>
      (w as { ethereum?: unknown } | undefined)?.ethereum as never,
  };
}

/** Display name for any connector, never the raw "Injected". */
export function walletLabel(name: string | undefined | null): string {
  if (!name || /^injected$/i.test(name.trim())) {
    return injectedWalletName(
      typeof window !== "undefined"
        ? (window as unknown as { ethereum?: unknown }).ethereum
        : undefined,
    );
  }
  return name;
}
