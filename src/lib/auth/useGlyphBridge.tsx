/**
 * Glyph → Supabase bridge (replaces the old Privy bridge).
 *
 * AUTHENTICATION (who you are): Supabase Auth.
 * AUTHORIZATION (what you can do): on-chain BAYC/MAYC ownership.
 *
 * This hook is the single place that ties Glyph's connected EVM wallet to a
 * Supabase session. It is mounted ONCE (via <GlyphBridgeMount>) and triggers
 * exactly once per wallet address, so the historic "infinite wallet creation
 * loop" cannot reappear here.
 *
 * Lifecycle (deterministic, no polling):
 *   1. Wait for Glyph:   ready && authenticated && user.evmWallet
 *   2. If a Supabase session already exists for this address → done.
 *   3. Otherwise: build a SIWE message, sign it via Glyph's signMessage,
 *      POST { message, signature } to the `verifyOwnership` server fn → it
 *      verifies the signature, runs on-chain balanceOf against BAYC + MAYC +
 *      delegate.cash, and mints a Supabase session for the wallet (lobby for
 *      everyone, bayc_verified flipped for holders).
 *   4. supabase.auth.setSession(...) → onAuthStateChange fires → RLS-protected
 *      reads work app-wide.
 *
 * NOTE: unlike the old Privy flow there is no separate "lobby session without
 * a signature" path — the new server fn mints a session from the SIWE
 * signature directly, so every entrance requires exactly one signature.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { verifyOwnership } from "@/server/wallet.functions";
import { useGlyphReady } from "@/components/GlyphAppProvider";
import { logEvent } from "@/lib/diagnostics";
import { importWithRetry } from "@/lib/import-with-retry";

/**
 * Lightweight, app-wide view of Glyph state. Lets the header render the
 * connected-wallet pill (and a re-verify affordance) without being wrapped
 * by the bridge component itself.
 *
 * Implemented as a module-level store + useSyncExternalStore so any
 * component (e.g. AppHeader) can read the bridge's view of Glyph.
 */
export interface GlyphAuthSnapshot {
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  /** A SIWE + ownership verification is currently running. */
  verifying: boolean;
}
let glyphSnapshot: GlyphAuthSnapshot = {
  ready: false,
  authenticated: false,
  address: null,
  verifying: false,
};
const glyphListeners = new Set<() => void>();
function setGlyphSnapshot(next: GlyphAuthSnapshot) {
  if (
    glyphSnapshot.ready === next.ready &&
    glyphSnapshot.authenticated === next.authenticated &&
    glyphSnapshot.address === next.address &&
    glyphSnapshot.verifying === next.verifying
  ) {
    return;
  }
  glyphSnapshot = next;
  for (const l of glyphListeners) l();
}
function patchGlyphSnapshot(patch: Partial<GlyphAuthSnapshot>) {
  setGlyphSnapshot({ ...glyphSnapshot, ...patch });
}
export function useGlyphAuthState(): GlyphAuthSnapshot {
  return useSyncExternalStore(
    (cb) => {
      glyphListeners.add(cb);
      return () => glyphListeners.delete(cb);
    },
    () => glyphSnapshot,
    () => glyphSnapshot,
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

/**
 * Hard-reset every shred of cached wallet state. Used by the inactivity
 * timer (and any other forced sign-out path) so the next visit must go
 * through Glyph's modal from scratch. Without this, Glyph's underlying
 * Privy session persists in localStorage and the bridge can short-circuit
 * the user back in without a fresh signature.
 */
export function clearWalletAuthLocalState() {
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (!k) continue;
      // Our 24h verify-fresh markers.
      if (k.startsWith("baycmc:verified:")) ls.removeItem(k);
      // Glyph persists session/wallet metadata under "glyph:*", and its
      // underlying Privy cross-app wallet under "privy:*". Clear both so the
      // next visit forces a full re-login.
      if (k.startsWith("glyph:") || k.startsWith("privy:")) ls.removeItem(k);
    }
    const ss = window.sessionStorage;
    for (let i = ss.length - 1; i >= 0; i--) {
      const k = ss.key(i);
      if (!k) continue;
      if (k.startsWith("glyph:") || k.startsWith("privy:")) ss.removeItem(k);
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
 * The wallet SDK occasionally fails to load one of its lazy chunks on the
 * first request. The chunk is cached after that first miss so a single retry
 * succeeds. Detect the error shape and let the caller retry once.
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

/**
 * The bridge consumes two hooks (both valid inside <GlyphWalletProvider>,
 * which sets up WagmiProvider + the Glyph context):
 *
 *  - wagmi's `useAccount()` for the connected wallet address + connection
 *    state. In Glyph's EIP1193 "Global Wallet" strategy the address comes from
 *    wagmi — `useGlyph().user` is only populated after the optional Glyph
 *    *widget* login, which we don't use (we do our own SIWE for Supabase).
 *  - `useGlyph()` for `signMessage` (works as soon as the wallet is connected)
 *    and `logout`.
 */
type GlyphHookValue = {
  logout: () => void;
  signMessage: (params: { message: string }) => Promise<string>;
};
type UseGlyph = () => GlyphHookValue;
type AccountValue = { address?: string | null; isConnected: boolean };
type UseAccount = () => AccountValue;

export function GlyphBridge({
  useGlyph,
  useAccount,
}: {
  useGlyph: UseGlyph;
  useAccount: UseAccount;
}) {
  const { logout, signMessage } = useGlyph();
  const { address: wagmiAddress, isConnected } = useAccount();
  const verifyFn = useServerFn(verifyOwnership);
  const [retryNonce, setRetryNonce] = useState(0);

  const address = isConnected ? (wagmiAddress ?? null) : null;

  // signMessage/verifyFn/logout are new refs every render — store them in
  // refs so we call the latest version inside the effect without putting them
  // in the dep array (which would re-fire the effect on every render and
  // silently cancel in-flight verifies via the closure cleanup).
  const signMessageRef = useRef(signMessage);
  signMessageRef.current = signMessage;
  const verifyFnRef = useRef(verifyFn);
  verifyFnRef.current = verifyFn;
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  // One-shot guard per wallet address. NEVER cleared while the address is
  // unchanged — this is what kills the historic verify loop.
  const inFlightRef = useRef<string | null>(null);
  const completedRef = useRef<Set<string>>(new Set());
  // True when the user fired the "Verify holder access" action — lets an
  // already-signed-in user pop a fresh SIWE signature to re-check ownership
  // instead of short-circuiting on the existing session.
  const verifyRequestedRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const retry = () => {
      // Single-flight: ignore retries while a verify is already running.
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
    window.addEventListener("baycmc:wallet-verify", retry);
    return () => window.removeEventListener("baycmc:wallet-verify", retry);
  }, []);

  // Hard sign-out from Glyph on demand. The inactivity timer can't call Glyph
  // hooks itself (it lives outside this React tree), so it dispatches a window
  // event we handle here from inside the hook context.
  useEffect(() => {
    const onLogout = () => {
      logEvent("auth", "info", "forced Glyph logout");
      completedRef.current.clear();
      inFlightRef.current = null;
      verifyRequestedRef.current = false;
      patchGlyphSnapshot({
        ready: false,
        authenticated: false,
        address: null,
        verifying: false,
      });
      try {
        logoutRef.current();
      } catch (e) {
        console.warn("[GlyphBridge] logout threw", e);
      }
      clearWalletAuthLocalState();
    };
    window.addEventListener("baycmc:wallet-logout", onLogout);
    return () => window.removeEventListener("baycmc:wallet-logout", onLogout);
  }, []);

  useEffect(() => {
    if (!address) {
      logEvent("auth", "debug", "bridge gate: no connected wallet", {
        isConnected,
        hasAddress: !!address,
      });
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
    const toastId = `glyph-bridge-${address.toLowerCase()}`;
    logEvent("auth", "info", "bridge: entering verify path", {
      address: address.slice(0, 6) + "…" + address.slice(-4),
      verifyRequested: verifyRequestedRef.current,
    });

    void (async () => {
      try {
        // If the user already has a Supabase session for this wallet, do
        // nothing — handles refresh after first verify. Exception: an explicit
        // re-verify request (the "Verify holder access" action) MUST re-run
        // the SIWE flow to re-check ownership on-chain.
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
          if (!isVerifiedFresh(address)) markVerified(address);
          return;
        }

        // Consume the explicit-request flag immediately so a thrown error
        // below doesn't leave us re-firing the loading toast on every
        // re-render of the bridge.
        verifyRequestedRef.current = false;
        patchGlyphSnapshot({ verifying: true });

        logEvent("auth", "info", "bridge: building SIWE + calling signMessage");
        toast.loading("Preparing wallet sign-in…", { id: toastId, position: "top-center" });

        const domain = window.location.host;
        const origin = window.location.origin;
        const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
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

        // Dismiss the prep toast just before Glyph opens its signing UI so it
        // doesn't cover the modal's action button.
        toast.dismiss(toastId);
        let signature: string;
        try {
          signature = await withTimeout(
            signMessageRef.current({ message }),
            45_000,
            "Signature request timed out. Please try signing in again.",
          );
        } catch (e) {
          if (!isChunkLoadError(e)) throw e;
          logEvent("auth", "warn", "bridge: signMessage chunk-load failed — retrying", {
            message: e instanceof Error ? e.message : String(e),
          });
          toast.loading("Reloading wallet sign-in…", { id: toastId, position: "top-center" });
          await new Promise((r) => window.setTimeout(r, 600));
          toast.dismiss(toastId);
          signature = await withTimeout(
            signMessageRef.current({ message }),
            45_000,
            "Signature request timed out. Please try signing in again.",
          );
        }
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

        // Tell useVerificationStatus consumers to reload their row — the
        // server fn just rewrote user_verifications.
        window.dispatchEvent(new Event("baycmc:verification-refresh"));

        if (result.verified) {
          toast.success("Verified", { id: toastId, duration: 2500 });
        } else {
          toast.error("Not verified", { id: toastId, duration: 2500 });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          !msg.toLowerCase().includes("user rejected") &&
          !msg.toLowerCase().includes("user denied")
        ) {
          logEvent("auth", "error", "bridge: verify threw", { message: msg });
          toast.error(msg || "Sign-in failed. Please try again.", { id: toastId });
        } else {
          logEvent("auth", "info", "bridge: user rejected signature");
          toast.dismiss(toastId);
        }
      } finally {
        if (inFlightRef.current === address) inFlightRef.current = null;
        patchGlyphSnapshot({ verifying: false });
      }
    })();
  }, [address, retryNonce]);

  // Publish the latest snapshot to the module-level store. `verifying` is
  // owned by the verify effect — patch the other fields only. The provider is
  // mounted by the time this component renders, so `ready` is always true here;
  // `authenticated` tracks wallet connection.
  useEffect(() => {
    patchGlyphSnapshot({
      ready: true,
      authenticated: isConnected,
      address,
    });
  }, [isConnected, address]);

  return null;
}

/**
 * Lazy loader: dynamic-imports @use-glyph/sdk-react + wagmi (both SSR-unsafe to
 * import eagerly) and mounts <GlyphBridge> once the Glyph provider is ready and
 * the hooks are available. wagmi's useAccount reads the WagmiProvider that
 * <GlyphWalletProvider> sets up, so both hooks resolve the same wallet.
 */
export function GlyphBridgeMount() {
  const glyphReady = useGlyphReady();
  const [hooks, setHooks] = useState<{ useGlyph: UseGlyph; useAccount: UseAccount } | null>(null);

  useEffect(() => {
    if (!glyphReady) return;
    let cancelled = false;
    void (async () => {
      try {
        const [glyphMod, wagmiMod] = await Promise.all([
          importWithRetry(() => import("@use-glyph/sdk-react"), {
            label: "glyph-sdk-react-bridge",
          }),
          importWithRetry(() => import("wagmi"), { label: "wagmi-bridge" }),
        ]);
        if (cancelled) return;
        // Store the hook functions; wrap in a fn so React's setState doesn't
        // invoke them as updaters.
        setHooks(() => ({
          useGlyph: glyphMod.useGlyph as unknown as UseGlyph,
          useAccount: wagmiMod.useAccount as unknown as UseAccount,
        }));
      } catch (e) {
        console.warn("[GlyphBridgeMount] failed to load wallet hooks:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [glyphReady]);

  if (!glyphReady || !hooks) return null;
  return <GlyphBridge useGlyph={hooks.useGlyph} useAccount={hooks.useAccount} />;
}
