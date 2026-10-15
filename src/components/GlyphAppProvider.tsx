import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, fallback, http, injected, type Config } from "wagmi";
import { apeChain, mainnet } from "viem/chains";
import { importWithRetry } from "@/lib/import-with-retry";
import { ensureBrowserPolyfills } from "@/lib/polyfill-check";
import { REOWN_PROJECT_ID } from "@/lib/web3/constants";

/**
 * Wallet stack: wagmi + Glyph Global Wallet + browser wallets + WalletConnect.
 *
 * WHAT WAS WRONG BEFORE
 *   1. <GlyphWalletProvider> builds a wagmi config containing ONLY the Glyph
 *      connector (and turns EIP-6963 discovery off), so MetaMask / Rabby /
 *      Coinbase / Ledger-via-WalletConnect users could not sign in with the
 *      wallet that actually holds their ape.
 *   2. <GlyphWalletProvider> returns `null` until it has fetched Glyph's
 *      supported-chains list — the WHOLE APP rendered blank during that
 *      request, and stayed blank if it failed (ad-blockers, Glyph outage).
 *   3. The provider was swapped in after a dynamic import, which changed the
 *      element tree above <Outlet/> and remounted the entire app once on
 *      every page load (double effects, karaoke joins firing twice).
 *   4. The only QueryClientProvider lived inside Glyph, so /account-merge's
 *      useQuery crashed whenever Glyph didn't load.
 *
 * NOW
 *   - QueryClientProvider + WagmiProvider are always mounted with a stable
 *     tree (SSR-safe: wagmi `ssr: true`, config created per render-root).
 *   - Connectors: Glyph (email / social / Glyph wallet — Glyph's own modal),
 *     every injected / EIP-6963 browser wallet, and WalletConnect (mobile
 *     wallets via QR / deep link).
 *   - The Glyph connector (SSR-unsafe — Privy touches `window` at import)
 *     is loaded after mount and appended to the live wagmi config.
 *
 * AUTH MODEL (unchanged): the wallet proves *who* you are via one SIWE
 * signature (server-issued nonce); Supabase holds the session; on-chain
 * BAYC/MAYC ownership (RLS + server checks) decides *what* you can do.
 */

export const GLYPH_CONNECTOR_ID = "io.useglyph.privy";
export const WALLETCONNECT_CONNECTOR_ID = "walletConnect";

interface WalletStackState {
  /** wagmi is mounted and usable (always true on the client after mount). */
  ready: boolean;
  /** The Glyph connector has been loaded into the config. */
  glyphLoaded: boolean;
  glyphError: string | null;
}
const WalletStackContext = createContext<WalletStackState>({
  ready: false,
  glyphLoaded: false,
  glyphError: null,
});

/** `true` once the wallet stack can be used (client, after mount). */
export function useGlyphReady(): boolean {
  return useContext(WalletStackContext).ready;
}
export function useWalletStack(): WalletStackState {
  return useContext(WalletStackContext);
}

function makeConfig(): Config {
  return createConfig({
    // ApeChain FIRST. Glyph is an ApeChain wallet: its connector connects on
    // the config's first chain (Glyph's own GlyphWalletProvider uses Glyph's
    // chain list, ApeChain first). With Ethereum first, Glyph's "Approve
    // Connection" was asked to connect on chain 1 ("0 ETH") and failed with
    // "Something went wrong" after Approve. Browser wallets / WalletConnect
    // are unaffected (they connect on whatever chain they're on).
    chains: [apeChain, mainnet],
    ssr: true,
    // EIP-6963: every installed browser wallet shows up as its own button.
    multiInjectedProviderDiscovery: true,
    connectors: [injected({ shimDisconnect: true })],
    transports: {
      [mainnet.id]: fallback([
        http(import.meta.env.VITE_ETH_RPC_URL || undefined),
        http("https://ethereum-rpc.publicnode.com"),
      ]),
      [apeChain.id]: http(),
    },
  });
}

async function addConnector(
  config: Config,
  fn: Parameters<Config["_internal"]["connectors"]["setup"]>[0],
) {
  const connector = config._internal.connectors.setup(fn);
  config._internal.connectors.setState((list) => [
    connector,
    ...list.filter((c) => c.id !== connector.id),
  ]);
  await connector.setup?.();
  return connector;
}

export function GlyphAppProvider({ children }: { children: ReactNode }) {
  // One QueryClient + wagmi config per React root (never shared across SSR
  // requests). Lazy initialisers keep them stable for the app's lifetime.
  const [queryClient] = useState(() => new QueryClient());
  const [config] = useState(makeConfig);
  const [mounted, setMounted] = useState(false);
  const [glyphLoaded, setGlyphLoaded] = useState(false);
  const [glyphError, setGlyphError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    // Compile-time constant: Vite drops this whole block (and the heavy
    // Privy / WalletConnect chunks it imports) from the server bundle.
    if (import.meta.env.SSR) return;
    let cancelled = false;
    void (async () => {
      // Browser polyfills (Buffer / process / global) must exist BEFORE the
      // Privy-based Glyph connector module evaluates.
      try {
        await import("@/lib/polyfill-shim").then((m) => m.installBrowserPolyfills());
      } catch (e) {
        console.warn("[wallet] polyfill install failed:", e);
      }
      if (!ensureBrowserPolyfills().ok) {
        setGlyphError("Your browser is missing features Glyph needs.");
      } else {
        try {
          const mod = await importWithRetry(() => import("@use-glyph/sdk-react"), {
            label: "glyph-sdk-react",
          });
          if (cancelled) return;
          await addConnector(config, mod.glyphWalletConnector());
          if (!cancelled) setGlyphLoaded(true);
        } catch (e) {
          console.warn("[wallet] Glyph connector failed to load:", e);
          if (!cancelled) setGlyphError("Glyph sign-in is unavailable right now.");
        }
      }
      // WalletConnect: QR on desktop, deep link on mobile. Needs a Reown
      // project id whose allowed domains include this site.
      try {
        if (REOWN_PROJECT_ID) {
          const { walletConnect } = await import("wagmi/connectors");
          if (cancelled) return;
          await addConnector(
            config,
            walletConnect({
              projectId: REOWN_PROJECT_ID,
              showQrModal: true,
              metadata: {
                name: "BAYCmc",
                description: "Bored Ape Yacht Club clubhouse",
                url: window.location.origin,
                icons: [`${window.location.origin}/favicon.ico`],
              },
            }),
          );
        }
      } catch (e) {
        console.warn("[wallet] WalletConnect unavailable:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config} reconnectOnMount>
        <WalletStackContext.Provider value={{ ready: mounted, glyphLoaded, glyphError }}>
          {children}
        </WalletStackContext.Provider>
      </WagmiProvider>
    </QueryClientProvider>
  );
}
