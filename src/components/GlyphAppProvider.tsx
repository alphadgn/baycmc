import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, fallback, http, injected, type Config } from "wagmi";
import { apeChain, mainnet } from "viem/chains";
import type { Chain } from "viem";
import { importWithRetry } from "@/lib/import-with-retry";
import { ensureBrowserPolyfills } from "@/lib/polyfill-check";
import { REOWN_PROJECT_ID } from "@/lib/web3/constants";
import { injectedTarget } from "@/lib/web3/injected-target";

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
 * NOW (Glyph factory process)
 *   - QueryClientProvider + WagmiProvider are always mounted (stable tree).
 *   - Once Glyph's SDK loads, the wagmi config is rebuilt the way Glyph's own
 *     <GlyphWalletProvider> builds it: Glyph's live supported-chains list
 *     (useGlyphConfigureDynamicChains), Glyph's RPCs, and the Glyph connector
 *     created inside createConfig. "Continue with Glyph" then runs Glyph's
 *     native connect (useNativeGlyphConnection: connect({ connector })) —
 *     no chain override, no post-mount connector injection.
 *   - Browser wallets (EIP-6963) and WalletConnect stay in the same config,
 *     so wallet linking is unchanged.
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
    connectors: [injected({ shimDisconnect: true, target: injectedTarget })],
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

type GlyphModule = typeof import("@use-glyph/sdk-react");
type AnyChain = Chain;

/**
 * Glyph's FACTORY wagmi config — built exactly the way Glyph's own
 * <GlyphWalletProvider> builds it: Glyph's live supported-chains list (from
 * useglyph.io, in Glyph's order, with Glyph's RPCs) and the Glyph connector
 * created INSIDE createConfig. The only additions are the browser-wallet /
 * WalletConnect connectors, so linking and external-wallet sign-in keep
 * working exactly as before.
 */
function makeGlyphFactoryConfig(mod: GlyphModule, glyphChains: readonly AnyChain[]): Config {
  const list: AnyChain[] = glyphChains.length > 0 ? [...glyphChains] : [apeChain];
  if (!list.some((c) => c.id === mainnet.id)) list.push(mainnet);
  const transports: Record<number, ReturnType<typeof http> | ReturnType<typeof fallback>> = {};
  for (const c of list) {
    const urls = (c.rpcUrls?.default?.http ?? []).filter(Boolean);
    if (c.id === mainnet.id && import.meta.env.VITE_ETH_RPC_URL) {
      urls.unshift(import.meta.env.VITE_ETH_RPC_URL as string);
    }
    transports[c.id] = urls.length ? fallback(urls.map((u) => http(u))) : http();
  }
  return createConfig({
    chains: list as [AnyChain, ...AnyChain[]],
    ssr: true,
    multiInjectedProviderDiscovery: true,
    connectors: [
      mod.glyphWalletConnector(),
      injected({ shimDisconnect: true, target: injectedTarget }),
    ],
    transports,
  }) as unknown as Config;
}

/** Calls Glyph's own chain-list hook (it must run inside a component). */
function GlyphChainsProbe({
  mod,
  onChains,
}: {
  mod: GlyphModule;
  onChains: (chains: readonly AnyChain[]) => void;
}) {
  const { chainIds, chains } = mod.useGlyphConfigureDynamicChains();
  useEffect(() => {
    if (chainIds && chains.length > 0) onChains(chains);
  }, [chainIds, chains, onChains]);
  return null;
}

async function addWalletConnect(config: Config) {
  if (!REOWN_PROJECT_ID) return;
  try {
    const { walletConnect } = await import("wagmi/connectors");
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
  } catch (e) {
    console.warn("[wallet] WalletConnect unavailable:", e);
  }
}

export function GlyphAppProvider({ children }: { children: ReactNode }) {
  // One QueryClient per React root. The wagmi config starts as a small
  // bootstrap config (SSR-safe, browser wallets only) and is replaced ONCE by
  // Glyph's factory config as soon as Glyph's SDK + chain list are loaded.
  // Swapping the WagmiProvider `config` prop does not remount the app.
  const [queryClient] = useState(() => new QueryClient());
  const [config, setConfig] = useState(makeConfig);
  const [mounted, setMounted] = useState(false);
  const [glyphMod, setGlyphMod] = useState<GlyphModule | null>(null);
  const [glyphLoaded, setGlyphLoaded] = useState(false);
  const [glyphError, setGlyphError] = useState<string | null>(null);
  const factoryBuilt = useRef(false);

  useEffect(() => {
    setMounted(true);
    if (import.meta.env.SSR) return;
    let cancelled = false;
    // Signed-in members get their saved wallet connection back; signed-out
    // visitors don't (see buildFactory).
    void import("@/integrations/supabase/client").then(async ({ supabase }) => {
      const { data } = await supabase.auth.getSession();
      if (data.session && !cancelled) {
        const { reconnect } = await import("wagmi/actions");
        await reconnect(config).catch(() => undefined);
      }
    });
    void (async () => {
      try {
        await import("@/lib/polyfill-shim").then((m) => m.installBrowserPolyfills());
      } catch (e) {
        console.warn("[wallet] polyfill install failed:", e);
      }
      if (!ensureBrowserPolyfills().ok) {
        setGlyphError("Your browser is missing features Glyph needs.");
        void addWalletConnect(config);
        return;
      }
      try {
        // NOTE: do NOT import "@use-glyph/sdk-react/style.css". It ships an
        // unlayered Tailwind v3 reset (`*{border-width:0}`, transparent
        // buttons, --tw-* variable resets) that overrides our Tailwind v4
        // utilities site-wide — borders, backgrounds, shadows and backdrops
        // all vanished. We render no Glyph widget UI, so we need none of it.
        const mod = await importWithRetry(() => import("@use-glyph/sdk-react"), {
          label: "glyph-sdk-react",
        });
        if (!cancelled) setGlyphMod(mod as GlyphModule);
      } catch (e) {
        console.warn("[wallet] Glyph SDK failed to load:", e);
        if (!cancelled) setGlyphError("Glyph sign-in is unavailable right now.");
        void addWalletConnect(config);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Bootstrap only — runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildFactory = useCallback(
    (chains: readonly AnyChain[]) => {
      if (!glyphMod || factoryBuilt.current) return;
      factoryBuilt.current = true;
      void (async () => {
        try {
          const next = makeGlyphFactoryConfig(glyphMod, chains);
          await addWalletConnect(next);
          setConfig(next);
          setGlyphLoaded(true);
          // Restore a saved wallet connection ONLY for a signed-in member. A
          // signed-out visitor starts clean: tapping VIP opens the sign-in
          // window with every option, instead of a stale "Sign to enter".
          const { supabase } = await import("@/integrations/supabase/client");
          const { data: sess } = await supabase.auth.getSession();
          if (sess.session) {
            const { reconnect } = await import("wagmi/actions");
            await reconnect(next).catch(() => undefined);
          }
        } catch (e) {
          console.warn("[wallet] Glyph factory config failed:", e);
          setGlyphError("Glyph sign-in is unavailable right now.");
        }
      })();
    },
    [glyphMod],
  );

  // Glyph's chain list normally arrives in well under a second; if useglyph.io
  // can't be reached, fall back to Glyph's home chain (ApeChain) after 8s.
  useEffect(() => {
    if (!glyphMod) return;
    const t = window.setTimeout(() => buildFactory([apeChain]), 8000);
    return () => window.clearTimeout(t);
  }, [glyphMod, buildFactory]);

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={config} reconnectOnMount={false}>
        <WalletStackContext.Provider value={{ ready: mounted, glyphLoaded, glyphError }}>
          {children}
        </WalletStackContext.Provider>
        {glyphMod && !glyphLoaded ? (
          <GlyphChainsProbe mod={glyphMod} onChains={buildFactory} />
        ) : null}
      </WagmiProvider>
    </QueryClientProvider>
  );
}
