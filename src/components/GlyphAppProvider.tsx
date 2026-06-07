import { Component, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { importWithRetry } from "@/lib/import-with-retry";
import { ensureBrowserPolyfills } from "@/lib/polyfill-check";

/**
 * Glyph wallet provider (replaces the old Privy + Reown AppKit stack).
 *
 * We mount Glyph's all-in-one <GlyphWalletProvider> (the Glyph Global Wallet,
 * @use-glyph/sdk-react by Yuga Labs). It internally sets up the WagmiProvider
 * + QueryClientProvider + GlyphProvider that useGlyph() depends on — mounting
 * the bare <GlyphProvider> instead throws "WagmiProviderNotFoundError: useConfig
 * must be used within WagmiProvider" because it expects a wagmi config above it.
 *
 * `askForSignature={false}`: Glyph would otherwise pop its OWN login signature
 * prompt, and our bridge already pops a single SIWE signature for the Supabase
 * session (see useGlyphBridge.tsx). Disabling Glyph's keeps it to one prompt —
 * Glyph just connects the wallet, our bridge does the SIWE.
 *
 * AUTH MODEL (unchanged): Glyph proves *who* you are (a connected EVM
 * wallet); Supabase Auth holds the session; on-chain BAYC/MAYC ownership
 * (enforced by RLS) decides *what* you can do. The wiring lives in
 * <GlyphBridge> (see useGlyphBridge.tsx).
 */

/**
 * `true` only when <GlyphWalletProvider> is actually mounted above this
 * subtree. Children that call useGlyph() MUST gate on this — calling the hook
 * before the provider mounts throws ("useGlyph must be used within a
 * GlyphProvider") and kills the calling component (e.g. the Entrance handler).
 */
const GlyphReadyContext = createContext(false);
export function useGlyphReady(): boolean {
  return useContext(GlyphReadyContext);
}

/**
 * Defensive boundary so a Glyph initialization throw can never take down the
 * whole tree. If Glyph fails to mount, we silently render children — the app
 * still works, only the wallet flow is degraded.
 */
class GlyphMountBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[GlyphAppProvider] init failed, rendering without Glyph:", error);
  }
  render() {
    if (this.state.hasError) return <>{this.props.fallback}</>;
    return <>{this.props.children}</>;
  }
}

type GlyphModule = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GlyphWalletProvider: any;
};

/**
 * Lazy-loaded Glyph provider. The SDK touches `window`/`localStorage` at
 * module-evaluation time (Privy under the hood), which crashes the Cloudflare
 * Worker SSR runtime, so we dynamic-import it inside an effect — exactly the
 * pattern the old PrivyAppProvider used.
 */
export function GlyphAppProvider({ children }: { children: ReactNode }) {
  const [mod, setMod] = useState<GlyphModule | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Install browser polyfills (Buffer / process / global) BEFORE we
      // touch Privy/Glyph. Loaded from a client-only effect so the shim
      // (and its `import("buffer")` / `import("process")` calls) never
      // enters the Cloudflare Worker SSR bundle.
      try {
        await import("@/lib/polyfill-shim").then((m) => m.installBrowserPolyfills());
      } catch (e) {
        console.warn("[GlyphAppProvider] polyfill install failed:", e);
      }
      const polyfills = ensureBrowserPolyfills();
      if (!polyfills.ok) {
        console.warn(
          "[GlyphAppProvider] Skipping Glyph init: required browser polyfills missing.",
        );
        return;
      }
      try {
        // Glyph's widget styles must be present for the login modal / widget.
        await importWithRetry(() => import("@use-glyph/sdk-react/style.css") as Promise<unknown>, {
          label: "glyph-styles",
        }).catch(() => {
          /* non-fatal: styles missing only degrades modal appearance */
        });
        const loaded = (await importWithRetry(() => import("@use-glyph/sdk-react"), {
          label: "glyph-sdk-react",
        })) as unknown as GlyphModule;
        if (cancelled) return;
        setMod(loaded);
      } catch (e) {
        console.warn("[GlyphAppProvider] failed to load Glyph:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mod) {
    return <GlyphReadyContext.Provider value={false}>{children}</GlyphReadyContext.Provider>;
  }

  const { GlyphWalletProvider } = mod;

  return (
    <GlyphMountBoundary
      fallback={<GlyphReadyContext.Provider value={false}>{children}</GlyphReadyContext.Provider>}
    >
      <GlyphWalletProvider askForSignature={false}>
        <GlyphReadyContext.Provider value={true}>{children}</GlyphReadyContext.Provider>
      </GlyphWalletProvider>
    </GlyphMountBoundary>
  );
}
