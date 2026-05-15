/**
 * NOTE: The previous useWallet hook (manual createWallet retry loop, polling,
 * exponential backoff) has been removed. Privy embedded wallet provisioning
 * is now handled entirely by PrivyProvider's
 * `embeddedWallets.ethereum.createOnLogin: 'all-users'` config and is
 * consumed strictly via `useWallets()` in PrivyVerifyCard. Manual
 * createWallet() calls created an infinite hydration loop and are forbidden.
 *
 * This file is kept only to export the EthereumProviderLike type used by
 * `txQueue.ts`. Do not re-add hook logic here.
 */

export type EthereumProviderLike = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
