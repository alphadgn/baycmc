import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

/**
 * Web3Provider is strictly client-only.
 *
 * Wagmi + Reown AppKit touch `window`, `localStorage`, and `indexedDB` at
 * module-evaluation time. Importing them statically anywhere reachable from
 * the SSR entry crashes the Worker runtime with `HTTPError 500`. We dynamic-
 * import the adapter inside `useEffect` so the SSR pass renders the children
 * directly (still valid HTML — just no wallet UI until hydration).
 */
export function Web3Provider({ children }: { children: ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [wagmiConfig, setWagmiConfig] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [WagmiProviderCmp, setWagmiProviderCmp] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ WagmiProvider }, { wagmiAdapter, initAppKit }] = await Promise.all([
        import("wagmi"),
        import("@/lib/web3/appkit"),
      ]);
      initAppKit();
      if (cancelled) return;
      setWagmiConfig(wagmiAdapter.wagmiConfig);
      setWagmiProviderCmp(() => WagmiProvider);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // SSR + pre-hydration: render children inside react-query only, no wagmi.
  // Components that need wallet state must guard for it (useAccount returns
  // disconnected state when there is no WagmiProvider ancestor — handled by
  // the AppHeader's conditional rendering).
  if (!WagmiProviderCmp || !wagmiConfig) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return (
    <WagmiProviderCmp config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProviderCmp>
  );
}
