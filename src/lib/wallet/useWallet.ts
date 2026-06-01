/**
 * NOTE: The previous useWallet hook (manual createWallet retry loop, polling,
 * exponential backoff) has been removed. Wallet provisioning is now handled by
 * the Glyph SDK (@use-glyph/sdk-react); the connected wallet and signer are
 * consumed via `useGlyph()` in the GlyphBridge. Do not re-add hook logic here.
 *
 * This file is kept only to export the EthereumProviderLike type used by
 * `txQueue.ts`.
 */

export type EthereumProviderLike = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};
