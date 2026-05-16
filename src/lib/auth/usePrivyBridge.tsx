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
import { establishLobbySession, verifyPrivyOwnership } from "@/server/privy.functions";
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
    logout: () => Promise<void>;
    getAccessToken: () => Promise<string | null>;
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

/**
 * Hard-reset every shred of cached wallet state. Used by the inactivity
 * timer (and any other forced sign-out path) so the next visit must go
 * through Privy's modal from scratch. Without this, Privy's own session
 * persists in localStorage and the bridge can short-circuit the user
 * back in without a fresh signature.
 */
export function clearWalletAuthLocalState() {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    // Our 24h verify-fresh markers
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (!k) continue;
      if (k.startsWith("baycmc:verified:")) ls.removeItem(k);
      // Privy persists session/wallet metadata under "privy:*" keys.
      // Clearing them forces a full re-login on next visit.
      if (k.startsWith("privy:")) ls.removeItem(k);
    }
    // Privy also caches a couple of items in sessionStorage.
    const ss = window.sessionStorage;
    for (let i = ss.length - 1; i >= 0; i--) {
      const k = ss.key(i);
      if (!k) continue;
      if (k.startsWith("privy:")) ss.removeItem(k);
    }
  } catch {
    /* private mode / quota — ignore */
  }
}

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
  const { ready, authenticated, user, logout, getAccessToken } = hooks.usePrivy();
  const { wallets, ready: walletsReady } = hooks.useWallets();
  const { signMessage } = hooks.useSignMessage();
  const verifyFn = useServerFn(verifyPrivyOwnership);
  const lobbyFn = useServerFn(establishLobbySession);
  const [retryNonce, setRetryNonce] = useState(0);

  // signMessage/verifyFn/lobbyFn/getAccessToken are new refs every render —
  // store them in refs so we can call the latest version inside the effect
  // without putting them in the dep array (which would re-fire the effect
  // on every render and silently cancel in-flight verifies via the closure
  // cleanup).
  const signMessageRef = useRef(signMessage);
  signMessageRef.current = signMessage;
  const verifyFnRef = useRef(verifyFn);
  verifyFnRef.current = verifyFn;
  const lobbyFnRef = useRef(lobbyFn);
  lobbyFnRef.current = lobbyFn;
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  // One-shot guard per wallet address. NEVER cleared while the address
  // is unchanged — this is what kills the historic verify loop.
  const inFlightRef = useRef<string | null>(null);
  const completedRef = useRef<Set<string>>(new Set());
  // True when the user fired the "Verify holder access" dropdown action.
  // It only changes behaviour in one place: it lets an *already-signed-in*
  // user pop a fresh SIWE signature instead of short-circuiting on the
  // existing session. For a first-time connect we now auto-pop SIWE
  // unconditionally — no manual "Verify" click required.
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

  // Pick the wallet the user actually intends to verify with. An external
  // wallet (MetaMask / Rainbow / WalletConnect / Coinbase / …) ALWAYS wins
  // over the auto-provisioned Privy embedded wallet — if the user connected
  // one, it's because their BAYC/MAYC lives there. We fall back to the
  // embedded wallet only when no external is linked (e.g. email-only login,
  // in which case the embedded is the user's only identity).
  function isEmbeddedPrivyWallet(w: WalletLike) {
    const t = w.walletClientType ?? w.wallet_client_type;
    return t === "privy" || t === "privy-v2";
  }
  const externalWallet = wallets.find((w) => !isEmbeddedPrivyWallet(w)) ?? null;
  const fallbackEmbedded = wallets.find(isEmbeddedPrivyWallet) ?? null;
  const primaryWallet = externalWallet ?? fallbackEmbedded;
  const walletReady =
    !!primaryWallet && (primaryWallet.ready === undefined || primaryWallet.ready === true);

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

  // Hard sign-out from Privy on demand. The inactivity timer can't call
  // Privy hooks itself (it lives outside this React tree), so it dispatches
  // a window event we handle here from inside the hook context.
  useEffect(() => {
    const onLogout = () => {
      logEvent("auth", "info", "forced Privy logout");
      // Wipe our caches first so the bridge can't re-verify silently on
      // the next render cycle while Privy is mid-teardown.
      completedRef.current.clear();
      inFlightRef.current = null;
      verifyRequestedRef.current = false;
      patchPrivySnapshot({
        ready: false,
        authenticated: false,
        address: null,
        verifying: false,
      });
      void (async () => {
        try {
          await logout();
        } catch (e) {
          console.warn("[PrivyBridge] logout threw", e);
        }
        clearWalletAuthLocalState();
      })();
    };
    window.addEventListener("baycmc:privy-logout", onLogout);
    return () => window.removeEventListener("baycmc:privy-logout", onLogout);
  }, [logout]);

  useEffect(() => {
    if (!ready || !authenticated || !walletsReady || !walletReady || !primaryWallet) {
      logEvent("auth", "debug", "bridge gate: not ready", {
        ready,
        authenticated,
        walletsReady,
        walletReady,
        hasPrimary: !!primaryWallet,
      });
      return;
    }
    const address = primaryWallet.address;
    if (!address) {
      logEvent("auth", "warn", "bridge gate: primary wallet has no address");
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
        //
        // Exception: an explicit re-verify request from the user (the
        // "Verify holder access" dropdown action) MUST run the SIWE flow
        // again so we can re-check ownership on-chain against a fresh
        // signature. Without this, the dropdown action would silently
        // short-circuit and never pop the Privy signing modal.
        const { data: sess } = await supabase.auth.getSession();
        const existingEmail = sess.session?.user.email ?? "";
        if (
          existingEmail === `${address.toLowerCase()}@wallet.baycmc.local` &&
          !verifyRequestedRef.current
        ) {
          logEvent(
            "auth",
            "info",
            "bridge: existing Supabase session matches wallet — short-circuit",
          );
          completedRef.current.add(address.toLowerCase());
          // Backfill the freshness marker so future loads stay quiet.
          if (!isVerifiedFresh(address)) markVerified(address);
          return;
        }

        // Consume the explicit-request flag immediately so a thrown error
        // below doesn't leave us re-firing the loading toast on every
        // re-render of the bridge (which is what produced the stuck
        // "Preparing wallet sign-in…" loop).
        const explicitVerify = verifyRequestedRef.current;
        verifyRequestedRef.current = false;
        patchPrivySnapshot({ verifying: true });

        // First-touch entrance: no SIWE. Hand the Privy access token to
        // `establishLobbySession`, which verifies the token server-side
        // and mints a Supabase session keyed by the wallet. The on-chain
        // BAYC/MAYC check is deferred to the moment the user actually
        // tries to enter a gated area (see verifyPrivyOwnership flow
        // below — fired by an explicit retry event).
        if (!explicitVerify) {
          logEvent("auth", "info", "bridge: establishing lobby session (no SIWE)");
          const accessToken = await getAccessTokenRef.current();
          if (!accessToken) {
            throw new Error("Privy session is missing an access token. Please sign in again.");
          }
          const lobby = await withTimeout(
            lobbyFnRef.current({ data: { accessToken, wallet: address } }),
            20_000,
            "Lobby sign-in is taking longer than expected. Please try again.",
          );
          if (unmountedRef.current) return;
          const { error } = await supabase.auth.setSession({
            access_token: lobby.session.access_token,
            refresh_token: lobby.session.refresh_token,
          });
          if (error) {
            logEvent("auth", "error", "bridge: lobby setSession failed", {
              message: error.message,
            });
            toast.error(error.message, { id: toastId });
            return;
          }
          logEvent("auth", "info", "bridge: lobby Supabase session set");
          completedRef.current.add(address.toLowerCase());
          markVerified(address);
          window.dispatchEvent(new Event("baycmc:verification-refresh"));
          return;
        }

        // Explicit re-verify (e.g. "Verify holder access" dropdown action
        // or a gated-area click). Build a SIWE message, get a signature
        // from Privy, then run the full on-chain ownership check.
        logEvent("auth", "info", "bridge: building SIWE + calling signMessage");
        // Top-center keeps the prep toast out of the way of Privy's modal
        // (which lands centered, with its action button near the middle).
        toast.loading("Preparing wallet sign-in…", {
          id: toastId,
          position: "top-center",
        });

        const domain = window.location.host;
        const origin = window.location.origin;
        const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        // No `statement` — SIWE renders the default
        // "{domain} wants you to sign in with your Ethereum account:" line.
        // Keeps the modal short and recognisable.
        const siwe = new SiweMessage({
          domain,
          address,
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
        // Dismiss the "Preparing wallet sign-in…" toast NOW, just before
        // Privy opens its modal. Otherwise the toast sits at the bottom of
        // the viewport and covers Privy's "Sign and continue" button.
        toast.dismiss(toastId);
        let signResult: { signature: string };
        try {
          signResult = await withTimeout(
            signMessageRef.current({ message }, signOpts),
            45_000,
            "Signature request timed out. Please try signing in again.",
          );
        } catch (e) {
          if (!isChunkLoadError(e)) throw e;
          logEvent("auth", "warn", "bridge: signMessage chunk-load failed — retrying", {
            message: e instanceof Error ? e.message : String(e),
          });
          // Show a brief retry toast at top-center where it won't overlap
          // Privy's modal action button on the next attempt.
          toast.loading("Reloading wallet sign-in…", {
            id: toastId,
            position: "top-center",
          });
          await new Promise((r) => window.setTimeout(r, 600));
          toast.dismiss(toastId);
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
          logEvent("auth", "error", "bridge: server returned no session", {
            reason: result.reason,
          });
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

        // Tell consumers of useVerificationStatus to reload their row from
        // user_verifications — the server fn just rewrote it. Without this,
        // a re-verify from inside the wallet pill leaves the header (and
        // gated nav) stuck on the pre-recheck state until a full reload.
        window.dispatchEvent(new Event("baycmc:verification-refresh"));

        // No success / info toast after verification. The UI itself reflects
        // the result: gated nav items unlock (or stay locked) once
        // useVerificationStatus refreshes via the event above. Errors below
        // still surface a toast because the user needs to know about them.
        toast.dismiss(toastId);
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
    primaryWallet?.address,
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
      address: walletReady && primaryWallet ? primaryWallet.address : null,
    });
  }, [ready, walletsReady, authenticated, walletReady, primaryWallet]);

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
