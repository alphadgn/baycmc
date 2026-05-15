/**
 * Privy → Supabase bridge.
 *
 * AUTHENTICATION (who you are): Supabase Auth.
 * AUTHORIZATION (what you can do): on-chain BAYC/MAYC ownership.
 *
 * This hook is the single place that ties Privy's embedded wallet to a
 * Supabase session. It is mounted ONCE inside PrivyAppProvider and it
 * triggers exactly once per wallet address, so the historic
 * "infinite wallet creation loop" cannot reappear here.
 *
 * Lifecycle (deterministic, no polling):
 *   1. Wait for Privy:   ready && authenticated && walletsReady
 *   2. Find embedded wallet (walletClientType === 'privy' | 'privy-v2')
 *   3. If a Supabase session already exists for this address → done.
 *   4. Otherwise: build SIWE message, signMessage via Privy, POST to
 *      verifyPrivyOwnership server fn → it does on-chain balanceOf
 *      against BAYC + MAYC + delegate.cash, mints a Supabase session,
 *      returns { access_token, refresh_token }.
 *   5. supabase.auth.setSession(...) → onAuthStateChange fires →
 *      RLS-protected reads work app-wide.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { verifyPrivyOwnership } from "@/server/privy.functions";

type EthereumProviderLike = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type WalletLike = {
  address: string;
  walletClientType?: string;
  wallet_client_type?: string;
  ready?: boolean;
  getEthereumProvider?: () => Promise<EthereumProviderLike>;
};

type PrivyHooks = {
  usePrivy: () => {
    ready: boolean;
    authenticated: boolean;
    user?: { id?: string; email?: { address?: string } | null } | null;
  };
  useWallets: () => { wallets: WalletLike[]; ready: boolean };
  useSignMessage: () => {
    signMessage: (
      input: { message: string },
      options?: {
        address?: string;
        uiOptions?: { showWalletUIs?: boolean; title?: string; description?: string; buttonText?: string };
      },
    ) => Promise<{ signature: string }>;
  };
};

export function PrivyBridge({ hooks }: { hooks: PrivyHooks }) {
  const { ready, authenticated, user } = hooks.usePrivy();
  const { wallets, ready: walletsReady } = hooks.useWallets();
  const { signMessage } = hooks.useSignMessage();
  const verifyFn = useServerFn(verifyPrivyOwnership);

  // One-shot guard per wallet address. NEVER cleared while the address
  // is unchanged — this is what kills the historic verify loop.
  const inFlightRef = useRef<string | null>(null);
  const completedRef = useRef<Set<string>>(new Set());

  // Only the embedded Privy wallet counts. External wallets are ignored.
  const embeddedWallet =
    wallets.find(
      (w) =>
        (w.walletClientType ?? w.wallet_client_type) === "privy" ||
        (w.walletClientType ?? w.wallet_client_type) === "privy-v2",
    ) ?? null;
  const walletReady =
    !!embeddedWallet && (embeddedWallet.ready === undefined || embeddedWallet.ready === true);

  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || !walletReady || !embeddedWallet) return;
    const address = embeddedWallet.address;
    if (!address) return;
    if (inFlightRef.current === address) return;
    if (completedRef.current.has(address.toLowerCase())) return;

    let cancelled = false;
    inFlightRef.current = address;

    void (async () => {
      try {
        // If the user already has a Supabase session for this wallet,
        // do nothing. This handles refresh after first verify.
        const { data: sess } = await supabase.auth.getSession();
        const existingEmail = sess.session?.user.email ?? "";
        if (existingEmail === `${address.toLowerCase()}@wallet.baycmc.local`) {
          completedRef.current.add(address.toLowerCase());
          return;
        }

        const domain = window.location.host;
        const origin = window.location.origin;
        const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const siwe = new SiweMessage({
          domain,
          address,
          statement: "Sign in to BAYCMC to verify BAYC/MAYC ownership.",
          uri: origin,
          version: "1",
          chainId: 1,
          nonce,
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        });
        const message = siwe.prepareMessage();

        const { signature } = await signMessage(
          { message },
          {
            address,
            uiOptions: {
              showWalletUIs: true,
              title: "Verify ownership",
              description: "Sign to check BAYC / MAYC ownership.",
              buttonText: "Sign and verify",
            },
          },
        );
        if (cancelled) return;

        const result = await verifyFn({ data: { message, signature } });
        if (cancelled) return;

        if (!result.verified) {
          completedRef.current.add(address.toLowerCase());
          toast.error(result.reason ?? "No qualifying BAYC/MAYC assets found.", {
            duration: 5000,
          });
          return;
        }

        const { error } = await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
        if (error) {
          toast.error(error.message);
          return;
        }
        completedRef.current.add(address.toLowerCase());
        toast.success(
          result.delegatedFrom
            ? `Verified — ${result.collection} delegated`
            : `Verified — ${result.collection} ownership confirmed`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.toLowerCase().includes("user rejected")) {
          console.warn("[PrivyBridge] verify failed:", msg);
          toast.error(msg || "Verification failed. Please try again.");
        }
      } finally {
        if (inFlightRef.current === address) inFlightRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, walletsReady, walletReady, embeddedWallet?.address, signMessage, verifyFn, embeddedWallet, user?.id]);

  return null;
}

/**
 * Lazy loader: dynamic-imports @privy-io/react-auth (SSR-unsafe) and
 * mounts <PrivyBridge> once Privy hooks are available.
 */
export function PrivyBridgeMount() {
  const [hooks, setHooks] = useState<PrivyHooks | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("@privy-io/react-auth");
        if (cancelled) return;
        setHooks({
          usePrivy: mod.usePrivy,
          useWallets: mod.useWallets,
          useSignMessage: mod.useSignMessage,
        });
      } catch (e) {
        console.warn("[PrivyBridgeMount] failed to load Privy hooks:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hooks) return null;
  return <PrivyBridge hooks={hooks} />;
}
