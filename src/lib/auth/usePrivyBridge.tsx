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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { verifyPrivyOwnership } from "@/server/privy.functions";
import { usePrivyReady } from "@/components/PrivyAppProvider";
import { logEvent } from "@/lib/diagnostics";
import { importWithRetry } from "@/lib/import-with-retry";

/**
 * Lightweight, app-wide view of Privy state. Lets the header render
 * "Click to verify" when the user has a connected Privy wallet but has
 * not yet completed SIWE → Supabase verification.
 *
 * Implemented as a module-level store + useSyncExternalStore so any
 * component (e.g. AppHeader) can read the bridge's view of Privy without
 * being wrapped by the bridge component itself.
 */
export interface PrivyAuthSnapshot {
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  /** A SIWE + ownership verification is currently running. */
  verifying: boolean;
}
let privySnapshot: PrivyAuthSnapshot = {
  ready: false,
  authenticated: false,
  address: null,
  verifying: false,
};
const privyListeners = new Set<() => void>();
function setPrivySnapshot(next: PrivyAuthSnapshot) {
  if (
    privySnapshot.ready === next.ready &&
    privySnapshot.authenticated === next.authenticated &&
    privySnapshot.address === next.address &&
    privySnapshot.verifying === next.verifying
  ) {
    return;
  }
  privySnapshot = next;
  for (const l of privyListeners) l();
}
function patchPrivySnapshot(patch: Partial<PrivyAuthSnapshot>) {
  setPrivySnapshot({ ...privySnapshot, ...patch });
}
export function usePrivyAuthState(): PrivyAuthSnapshot {
  return useSyncExternalStore(
    (cb) => {
      privyListeners.add(cb);
      return () => privyListeners.delete(cb);
    },
    () => privySnapshot,
    () => privySnapshot,
  );
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

/**
 * Privy's iframe at auth.privy.io occasionally fails to load one of its
 * Next.js chunks on first request ("Loading chunk 5893 failed"). The chunk
 * is cached server-side after that first miss so a single retry succeeds.
 * Detect the error shape and let the caller retry once before bubbling up.
 */
function isChunkLoadError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed")
  );
}

export function PrivyBridge({ hooks }: { hooks: PrivyHooks }) {
  const { ready, authenticated, user } = hooks.usePrivy();
  const { wallets, ready: walletsReady } = hooks.useWallets();
  const { signMessage } = hooks.useSignMessage();
  const verifyFn = useServerFn(verifyPrivyOwnership);
  const [retryNonce, setRetryNonce] = useState(0);

  // signMessage/verifyFn are new refs every render — store them in refs so
  // we can call the latest version inside the effect without putting them
  // in the dep array (which would re-fire the effect on every render and
  // silently cancel in-flight verifies via the closure cleanup).
  const signMessageRef = useRef(signMessage);
  signMessageRef.current = signMessage;
  const verifyFnRef = useRef(verifyFn);
  verifyFnRef.current = verifyFn;

  // One-shot guard per wallet address. NEVER cleared while the address
  // is unchanged — this is what kills the historic verify loop.
  const inFlightRef = useRef<string | null>(null);
  const completedRef = useRef<Set<string>>(new Set());
  // Did the user explicitly request verification (button click → event)?
  // We never auto-prompt the SIWE signature on wallet connect anymore —
  // it was distorting the rest of the UI on first sign-in.
  const verifyRequestedRef = useRef(false);
  // True only when the bridge component is unmounting. Used to suppress
  // post-await state updates in the truly-gone case. Plain `cancelled`
  // closure flags were causing silent aborts when the effect re-fired
  // due to render-time ref changes (signMessage / verifyFn).
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

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
      // Single-flight: ignore retries while a verify is already running.
      // This is what stops the "Preparing wallet sign-in…" loop — without
      // it, every click was clearing the guard and spawning a second
      // signMessage() in parallel with the first.
      if (inFlightRef.current) {
        logEvent("auth", "info", "retry ignored — verify already in-flight", {
          inFlight: inFlightRef.current,
        });
        return;
      }
      logEvent("auth", "info", "retry accepted — kicking verify");
      completedRef.current.clear();
      verifyRequestedRef.current = true;
      setRetryNonce((n) => n + 1);
    };
    window.addEventListener("baycmc:privy-bridge-retry", retry);
    return () => window.removeEventListener("baycmc:privy-bridge-retry", retry);
  }, []);

  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || !walletReady || !embeddedWallet) {
      logEvent("auth", "debug", "bridge gate: not ready", {
        ready,
        authenticated,
        walletsReady,
        walletReady,
        hasEmbedded: !!embeddedWallet,
      });
      return;
    }
    const address = embeddedWallet.address;
    if (!address) {
      logEvent("auth", "warn", "bridge gate: embedded wallet has no address");
      return;
    }
    if (inFlightRef.current === address) {
      logEvent("auth", "debug", "bridge gate: already in-flight for address");
      return;
    }
    if (completedRef.current.has(address.toLowerCase())) {
      logEvent("auth", "debug", "bridge gate: already completed for address");
      return;
    }

    inFlightRef.current = address;
    const toastId = `privy-bridge-${address.toLowerCase()}`;
    logEvent("auth", "info", "bridge: entering verify path", {
      address: address.slice(0, 6) + "…" + address.slice(-4),
      verifyRequested: verifyRequestedRef.current,
    });

    void (async () => {
      try {
        // If the user already has a Supabase session for this wallet,
        // do nothing. This handles refresh after first verify.
        const { data: sess } = await supabase.auth.getSession();
        const existingEmail = sess.session?.user.email ?? "";
        if (existingEmail === `${address.toLowerCase()}@wallet.baycmc.local`) {
          logEvent("auth", "info", "bridge: existing Supabase session matches wallet — short-circuit");
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
          logEvent("auth", "debug", "bridge: no explicit verify request — waiting on user click");
          return;
        }

        // Consume the explicit-request flag immediately so a thrown error
        // below doesn't leave us re-firing the loading toast on every
        // re-render of the bridge (which is what produced the stuck
        // "Preparing wallet sign-in…" loop).
        verifyRequestedRef.current = false;
        patchPrivySnapshot({ verifying: true });

        logEvent("auth", "info", "bridge: building SIWE + calling signMessage");
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

        const signOpts = {
          address,
          uiOptions: {
            showWalletUIs: true,
            title: "Sign in to BAYCMC",
            description:
              "Signing in checks BAYC/MAYC ownership directly and via delegate.cash vaults.",
            buttonText: "Sign and continue",
          },
        } as const;
        let signResult: { signature: string };
        try {
          signResult = await withTimeout(
            signMessageRef.current({ message }, signOpts),
            45_000,
            "Signature request timed out. Please try signing in again.",
          );
        } catch (e) {
          if (!isChunkLoadError(e)) throw e;
          // Privy iframe missed a chunk on the first request — retry once
          // after a short delay so the CDN can serve the cached chunk.
          logEvent("auth", "warn", "bridge: signMessage chunk-load failed — retrying", {
            message: e instanceof Error ? e.message : String(e),
          });
          toast.loading("Reloading wallet sign-in…", { id: toastId });
          await new Promise((r) => window.setTimeout(r, 600));
          signResult = await withTimeout(
            signMessageRef.current({ message }, signOpts),
            45_000,
            "Signature request timed out. Please try signing in again.",
          );
        }
        const { signature } = signResult;
        if (unmountedRef.current) {
          logEvent("auth", "warn", "bridge: aborted after signMessage — component unmounted");
          return;
        }
        logEvent("auth", "info", "bridge: signature obtained — calling verifyFn");

        toast.loading("Checking BAYC / MAYC ownership…", { id: toastId });
        const result = await withTimeout(
          verifyFnRef.current({ data: { message, signature } }),
          20_000,
          "The verification check is taking longer than expected. Please try again.",
        );
        if (unmountedRef.current) {
          logEvent("auth", "warn", "bridge: aborted after verifyFn — component unmounted");
          return;
        }
        logEvent("auth", "info", "bridge: verifyFn returned", {
          verified: result.verified,
          hasSession: !!result.session,
          collection: result.collection,
          reason: result.reason ?? null,
        });

        if (!result.session) {
          logEvent("auth", "error", "bridge: server returned no session", { reason: result.reason });
          toast.error(result.reason ?? "Sign-in failed.", { id: toastId });
          return;
        }
        const { error } = await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
        if (error) {
          logEvent("auth", "error", "bridge: setSession failed", { message: error.message });
          toast.error(error.message, { id: toastId });
          return;
        }
        logEvent("auth", "info", "bridge: Supabase session set — redirect should follow");

        completedRef.current.add(address.toLowerCase());
        markVerified(address);

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
          // Dismiss the loading toast explicitly first — sonner inherits the
          // loading spinner when updating a loading toast via the same id
          // with `toast.message`, which made it appear to roll forever.
          toast.dismiss(toastId);
          toast.info("You're in the lobby", {
            description:
              result.reason ?? "No BAYC/MAYC found for this wallet — gated rooms stay locked.",
            duration: 6000,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.toLowerCase().includes("user rejected")) {
          logEvent("auth", "error", "bridge: verify threw", { message: msg });
          toast.error(msg || "Sign-in failed. Please try again.", { id: toastId });
        } else {
          logEvent("auth", "info", "bridge: user rejected signature");
          toast.dismiss(toastId);
        }
      } finally {
        if (inFlightRef.current === address) inFlightRef.current = null;
        patchPrivySnapshot({ verifying: false });
      }
    })();

    // No cleanup that flips a `cancelled` flag — the previous version
    // silently aborted in-flight signMessage promises every time Privy
    // returned a new signMessage / verifyFn reference, which was on every
    // render. inFlightRef + completedRef + unmountedRef are sufficient.
  }, [
    ready,
    authenticated,
    walletsReady,
    walletReady,
    embeddedWallet?.address,
    user?.id,
    retryNonce,
  ]);

  // Publish the latest snapshot to the module-level store so the header
  // (and any other component) can react without being a child of this node.
  // `verifying` is owned by the verify effect — patch the other fields only.
  useEffect(() => {
    patchPrivySnapshot({
      ready: !!ready && !!walletsReady,
      authenticated: !!authenticated,
      address: walletReady && embeddedWallet ? embeddedWallet.address : null,
    });
  }, [ready, walletsReady, authenticated, walletReady, embeddedWallet]);

  return null;
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
        const mod = await importWithRetry(() => import("@privy-io/react-auth"), {
          label: "privy-react-auth-bridge",
        });
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
