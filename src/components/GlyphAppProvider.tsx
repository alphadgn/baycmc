import { Component, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { importWithRetry } from "@/lib/import-with-retry";

/**
 * Glyph wallet provider (replaces the old Privy + Reown AppKit stack).
 *
 * Glyph (@use-glyph/sdk-react, by Yuga Labs) is itself built on a hosted
 * Privy "cross-app" wallet, so we use its PRIVY strategy: Glyph manages its
 * own Privy app, embedded wallet and social/login UX. There is no app-id to
 * configure on our side (the SDK bakes in GLYPH_PRIVY_APP_ID), which is why
 * the old `getPrivyPublicConfig` server fn is gone.
 *
 * AUTH MODEL (unchanged): Glyph proves *who* you are (a connected EVM
 * wallet); Supabase Auth holds the session; on-chain BAYC/MAYC ownership
 * (enforced by RLS) decides *what* you can do. The wiring lives in
 * <GlyphBridge> (see useGlyphBridge.tsx).
 */

/**
 * `true` only when <GlyphProvider> is actually mounted above this subtree.
 * Children that call useGlyph() MUST gate on this — calling the hook before
 * the provider mounts throws ("useGlyph must be used within a GlyphProvider")
 * and kills the calling component (e.g. the Entrance button handler).
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
  GlyphProvider: any;
  StrategyType: { PRIVY: string; EIP1193: string };
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

  const { GlyphProvider, StrategyType } = mod;

  return (
    <GlyphMountBoundary
      fallback={<GlyphReadyContext.Provider value={false}>{children}</GlyphReadyContext.Provider>}
    >
      <GlyphProvider strategy={StrategyType.PRIVY}>
        <GlyphReadyContext.Provider value={true}>{children}</GlyphReadyContext.Provider>
      </GlyphProvider>
    </GlyphMountBoundary>
  );
}
