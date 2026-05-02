import { useEffect, useState, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { useServerFn } from "@tanstack/react-start";
import { getPrivyPublicConfig } from "@/server/privy.functions";

/**
 * Lazy-loaded Privy provider. The App ID is fetched from the server on mount
 * (it's publishable, so safe to surface client-side once needed). Until the
 * config has loaded — or if it's not configured — children render unwrapped
 * so the rest of the app keeps working.
 */
export function PrivyAppProvider({ children }: { children: ReactNode }) {
  const [appId, setAppId] = useState<string | null>(null);
  const fetchConfig = useServerFn(getPrivyPublicConfig);

  useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (cfg.configured) setAppId(cfg.appId);
      })
      .catch(() => {
        // If the server fn fails we just don't enable Privy. Tokenproof still works.
      });
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#F5B100",
          logo: undefined,
        },
        embeddedWallets: {
          createOnLogin: "off",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
