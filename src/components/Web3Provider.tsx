import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

const Web3ReadyCtx = createContext(false);
export const useWeb3Ready = () => useContext(Web3ReadyCtx);

/**
 * Web3Provider is strictly client-only. Wagmi + Reown AppKit touch `window`,
 * `localStorage`, and `indexedDB` at module-evaluation time. Importing them
 * statically anywhere reachable from the SSR entry crashes the Worker
 * runtime with `HTTPError 500`. We dynamic-import the adapter inside an
 * effect so the SSR pass renders the children without a wagmi provider.
 *
 * Components that need wagmi hooks should gate on `useWeb3Ready()` so they
 * never call those hooks before WagmiProvider has mounted.
 */
export function Web3Provider({ children }: { children: ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [WagmiProviderCmp, setWagmiProviderCmp] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [wagmiConfig, setWagmiConfig] = useState<any>(null);

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

  if (!WagmiProviderCmp || !wagmiConfig) {
    return (
      <Web3ReadyCtx.Provider value={false}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </Web3ReadyCtx.Provider>
    );
  }

  return (
    <Web3ReadyCtx.Provider value={true}>
      <WagmiProviderCmp config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </WagmiProviderCmp>
    </Web3ReadyCtx.Provider>
  );
}
