import { useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPrivyPublicConfig } from "@/server/privy.functions";

/**
 * Lazy-loaded Privy provider. Privy's SDK touches `window`/`localStorage` at
 * module-evaluation time, which crashes the Worker SSR runtime with
 * `HTTPError 500`. We therefore dynamic-import `@privy-io/react-auth` inside
 * an effect — same pattern as Web3Provider — so SSR renders children without
 * the Privy wrapper. The publishable App ID is fetched from the server fn.
 */
export function PrivyAppProvider({ children }: { children: ReactNode }) {
  const [appId, setAppId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [PrivyProviderCmp, setPrivyProviderCmp] = useState<any>(null);
  const fetchConfig = useServerFn(getPrivyPublicConfig);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await fetchConfig();
        if (cancelled || !cfg.configured) return;
        const mod = await import("@privy-io/react-auth");
        if (cancelled) return;
        setAppId(cfg.appId);
        setPrivyProviderCmp(() => mod.PrivyProvider);
      } catch {
        // If fetch or import fails, just render children without Privy.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  if (!appId || !PrivyProviderCmp) return <>{children}</>;

  return (
    <PrivyProviderCmp
      appId={appId}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#F5B100",
          logo: undefined,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
        },
      }}
    >
      {children}
    </PrivyProviderCmp>
  );
}
