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
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { verifyPrivyOwnership } from "@/server/privy.functions";
import { usePrivyReady } from "@/components/PrivyAppProvider";

/**
 * Lightweight, app-wide view of Privy state. Lets the header render
 * "Click to verify" when the user has a connected Privy wallet but has
 * not yet completed SIWE → Supabase verification. Default value is the
 * "no Privy mounted" state.
 */
export interface PrivyAuthSnapshot {
  ready: boolean;
  authenticated: boolean;
  address: string | null;
}
const PrivyAuthStateContext = createContext<PrivyAuthSnapshot>({
  ready: false,
  authenticated: false,
  address: null,
});
export function usePrivyAuthState(): PrivyAuthSnapshot {
  return useContext(PrivyAuthStateContext);
}

const VERIFIED_TTL_MS = 24 * 60 * 60 * 1000;
function verifiedKey(addr: string) {
  return `baycmc:verified:${addr.toLowerCase()}`;
}
function isVerifiedFresh(addr: string): boolean {
  try {
    const raw = window.localStorage.getItem(verifiedKey(addr));
    if (!raw) return false;
    const ts = Number.parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < VERIFIED_TTL_MS;
  } catch {
    return false;
  }
}
function markVerified(addr: string) {
  try {
    window.localStorage.setItem(verifiedKey(addr), String(Date.now()));
  } catch {
    /* ignore quota / private mode */
  }
}

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
        uiOptions?: {
          showWalletUIs?: boolean;
          title?: string;
          description?: string;
          buttonText?: string;
        };
      },
    ) => Promise<{ signature: string }>;
  };
};

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (value) => {
        window.clearTimeout(t);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(t);
        reject(error);
      },
    );
  });
}

export function PrivyBridge({ hooks }: { hooks: PrivyHooks }) {
  const { ready, authenticated, user } = hooks.usePrivy();
  const { wallets, ready: walletsReady } = hooks.useWallets();
  const { signMessage } = hooks.useSignMessage();
  const verifyFn = useServerFn(verifyPrivyOwnership);
  const [retryNonce, setRetryNonce] = useState(0);

  // One-shot guard per wallet address. NEVER cleared while the address
  // is unchanged — this is what kills the historic verify loop.
  const inFlightRef = useRef<string | null>(null);
  const completedRef = useRef<Set<string>>(new Set());
  // Did the user explicitly request verification (button click → event)?
  // We never auto-prompt the SIWE signature on wallet connect anymore —
  // it was distorting the rest of the UI on first sign-in.
  const verifyRequestedRef = useRef(false);

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
    const retry = () => {
      inFlightRef.current = null;
      completedRef.current.clear();
      verifyRequestedRef.current = true;
      setRetryNonce((n) => n + 1);
    };
    window.addEventListener("baycmc:privy-bridge-retry", retry);
    return () => window.removeEventListener("baycmc:privy-bridge-retry", retry);
  }, []);

  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || !walletReady || !embeddedWallet) return;
    const address = embeddedWallet.address;
    if (!address) return;
    if (inFlightRef.current === address) return;
    if (completedRef.current.has(address.toLowerCase())) return;

    let cancelled = false;
    inFlightRef.current = address;
    const toastId = `privy-bridge-${address.toLowerCase()}`;

    void (async () => {
      try {
        // If the user already has a Supabase session for this wallet,
        // do nothing. This handles refresh after first verify.
        const { data: sess } = await supabase.auth.getSession();
        const existingEmail = sess.session?.user.email ?? "";
        if (existingEmail === `${address.toLowerCase()}@wallet.baycmc.local`) {
          completedRef.current.add(address.toLowerCase());
          // Backfill the freshness marker so future loads stay quiet.
          if (!isVerifiedFresh(address)) markVerified(address);
          return;
        }

        // 24h cache: a fresh marker means we already verified recently.
        // We can't restore a Supabase session from localStorage alone, so
        // the user still has to click "Click to verify" if their session
        // ever expires — but we won't auto-pop the signature modal.
        if (!verifyRequestedRef.current) {
          // No explicit user click → bail. The header will render a
          // "Click to verify" CTA that dispatches the retry event.
          return;
        }

        toast.loading("Preparing wallet sign-in…", { id: toastId });

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

        const { signature } = await withTimeout(
          signMessage(
            { message },
            {
              address,
              uiOptions: {
                showWalletUIs: true,
                title: "Sign in to BAYCMC",
                description:
                  "Signing in checks BAYC/MAYC ownership directly and via delegate.cash vaults.",
                buttonText: "Sign and continue",
              },
            },
          ),
          45_000,
          "Signature request timed out. Please try signing in again.",
        );
        if (cancelled) return;

        toast.loading("Checking BAYC / MAYC ownership…", { id: toastId });
        const result = await withTimeout(
          verifyFn({ data: { message, signature } }),
          20_000,
          "The verification check is taking longer than expected. Please try again.",
        );
        if (cancelled) return;

        if (!result.session) {
          toast.error(result.reason ?? "Sign-in failed.", { id: toastId });
          return;
        }
        const { error } = await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
        if (error) {
          toast.error(error.message, { id: toastId });
          return;
        }

        completedRef.current.add(address.toLowerCase());
        markVerified(address);
        verifyRequestedRef.current = false;

        // Surface deterministic UI states for the delegation/direct check:
        if (result.verified) {
          if (result.delegatedFrom) {
            toast.success(
              `Welcome — ${result.collection} verified via delegate.cash vault ${result.delegatedFrom.slice(0, 6)}…${result.delegatedFrom.slice(-4)}.`,
              { id: toastId, duration: 5000 },
            );
          } else {
            toast.success(`Welcome — ${result.collection} ownership confirmed.`, {
              id: toastId,
              duration: 5000,
            });
          }
        } else {
          // Lobby-only session (no BAYC/MAYC or delegate.cash blank).
          toast.message("You're in the lobby", {
            id: toastId,
            description:
              result.reason ?? "No BAYC/MAYC found for this wallet — gated rooms stay locked.",
            duration: 6000,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.toLowerCase().includes("user rejected")) {
          console.warn("[PrivyBridge] verify failed:", msg);
          toast.error(msg || "Sign-in failed. Please try again.", { id: toastId });
        } else {
          toast.dismiss(toastId);
        }
        verifyRequestedRef.current = false;
      } finally {
        if (inFlightRef.current === address) inFlightRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    ready,
    authenticated,
    walletsReady,
    walletReady,
    embeddedWallet?.address,
    signMessage,
    verifyFn,
    embeddedWallet,
    user?.id,
    retryNonce,
  ]);

  return (
    <PrivyAuthStateContext.Provider
      value={{
        ready: ready && walletsReady,
        authenticated: !!authenticated,
        address: walletReady && embeddedWallet ? embeddedWallet.address : null,
      }}
    >
      {/* Children come from PrivyBridgeMount via composition below. */}
    </PrivyAuthStateContext.Provider>
  );
}

/**
 * Lazy loader: dynamic-imports @privy-io/react-auth (SSR-unsafe) and
 * mounts <PrivyBridge> once Privy hooks are available.
 */
export function PrivyBridgeMount() {
  const privyReady = usePrivyReady();
  const [hooks, setHooks] = useState<PrivyHooks | null>(null);

  useEffect(() => {
    if (!privyReady) return;
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
  }, [privyReady]);

  if (!privyReady || !hooks) return null;
  return <PrivyBridge hooks={hooks} />;
}
