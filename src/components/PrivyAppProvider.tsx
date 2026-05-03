import { Component, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPrivyPublicConfig } from "@/server/privy.functions";

/**
 * Privy App IDs are ~25-char base32-ish strings (e.g. "clpispdty00ycl80fpueukbhl").
 * If the secret value is missing, a placeholder, or malformed, the SDK throws
 * "Cannot initialize the Privy provider with an invalid Privy app ID" during
 * render — which then crashes the whole app via the router error boundary.
 *
 * We validate strictly here and refuse to mount the provider for anything that
 * doesn't look like a real ID.
 */
function isValidPrivyAppId(id: string | null | undefined): id is string {
  if (!id) return false;
  const trimmed = id.trim();
  // Reject Privy *app secret* values pasted into the App ID slot.
  if (/^privy_app_secret/i.test(trimmed)) return false;
  if (trimmed.length < 20 || trimmed.length > 40) return false;
  if (!/^[a-z0-9]+$/i.test(trimmed)) return false;
  if (/^(your|placeholder|test|xxx|change|todo)/i.test(trimmed)) return false;
  return true;
}

/**
 * Defensive boundary so a Privy initialization throw can never take down the
 * whole tree. If Privy fails to mount, we silently render children — the app
 * still works, only the wallet flow is degraded.
 */
class PrivyMountBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[PrivyAppProvider] init failed, rendering without Privy:", error);
  }
  render() {
    if (this.state.hasError) return <>{this.props.fallback}</>;
    return <>{this.props.children}</>;
  }
}

/**
 * Lazy-loaded Privy provider. Privy's SDK touches `window`/`localStorage` at
 * module-evaluation time, which crashes the Worker SSR runtime, so we
 * dynamic-import `@privy-io/react-auth` inside an effect.
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
        if (cancelled) return;
        if (!cfg.configured || !isValidPrivyAppId(cfg.appId)) {
          if (cfg.configured && !isValidPrivyAppId(cfg.appId)) {
            console.warn(
              "[PrivyAppProvider] PRIVY_APP_ID is set but not a valid format — skipping Privy.",
            );
          }
          return;
        }
        const mod = await import("@privy-io/react-auth");
        if (cancelled) return;
        setAppId(cfg.appId.trim());
        setPrivyProviderCmp(() => mod.PrivyProvider);
      } catch (e) {
        console.warn("[PrivyAppProvider] failed to load Privy:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  if (!appId || !PrivyProviderCmp) return <>{children}</>;

  return (
    <PrivyMountBoundary fallback={children}>
      <PrivyProviderCmp
        appId={appId}
        config={{
          loginMethods: ["wallet", "email"],
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
    </PrivyMountBoundary>
  );
}
