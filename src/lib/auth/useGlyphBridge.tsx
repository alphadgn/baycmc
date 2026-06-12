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
 *   1. Wallet connects through Glyph → wagmi's useAccount() reports the
 *      address (the automatic path, runVerify(false)).
 *   2. If a Supabase session already exists for this address → done, no popup.
 *   3. Otherwise the user must TAP "Sign to enter" (runVerify(true)). The
 *      wallet's signing popup can only open from inside a user gesture, so we
 *      never auto-pop it from an effect — that popup is silently blocked. The
 *      tap dispatches "baycmc:wallet-verify"; dispatchEvent runs the listener
 *      synchronously, so signMessage fires inside the same gesture. We build a
 *      SIWE message, sign it, and POST { message, signature } to the
 *      `verifyOwnership` server fn → it verifies the signature, runs on-chain
 *      balanceOf against BAYC + MAYC + delegate.cash, and mints a Supabase
 *      session (lobby for everyone, bayc_verified flipped for holders).
 *   4. supabase.auth.setSession(...) → onAuthStateChange fires → RLS-protected
 *      reads work app-wide.
 *
 * NOTE: unlike the old Privy flow there is no separate "lobby session without
 * a signature" path — the new server fn mints a session from the SIWE
 * signature directly, so every entrance requires exactly one signature.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
type GlyphLinkedWallet = { address: string; walletClientType?: string };
type GlyphUser = {
  evmWallet?: string;
  smartWallet?: string;
  linkedWallets?: GlyphLinkedWallet[];
} | null;
type GlyphHookValue = {
  logout: () => void;
  signMessage: (params: { message: string }) => Promise<string>;
  user?: GlyphUser;
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
  const { logout, signMessage, user } = useGlyph();
  const { address: wagmiAddress, isConnected } = useAccount();
  const verifyFn = useServerFn(verifyOwnership);

  const address = isConnected ? (wagmiAddress ?? null) : null;

  // Collect every EVM address Glyph knows about for this account: the
  // signing wallet, the smart wallet, and any "linked wallets" the user has
  // attached via the Glyph modal. We pass these to verifyOwnership so the
  // server can check BAYC/MAYC holdings + delegate.cash delegations against
  // the entire linked set, not just the active signer.
  const linkedWallets = (() => {
    const out: string[] = [];
    const push = (a?: string | null) => {
      if (!a || !/^0x[a-fA-F0-9]{40}$/.test(a)) return;
      if (out.some((x) => x.toLowerCase() === a.toLowerCase())) return;
      out.push(a);
    };
    push(user?.evmWallet);
    push(user?.smartWallet);
    for (const w of user?.linkedWallets ?? []) push(w?.address);
    return out;
  })();
  const linkedWalletsRef = useRef(linkedWallets);
  linkedWalletsRef.current = linkedWallets;

  // Latest connected address, read inside the stable runVerify callback so we
  // don't have to thread it through deps.
  const addressRef = useRef(address);
  addressRef.current = address;


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
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // The SIWE sign + on-chain verify + Supabase session mint.
  //
  // `explicit` means a real user gesture (a tap) is driving this. The wallet's
  // signing popup can ONLY be opened from inside a user gesture — a popup
  // requested from a bare effect (e.g. right after the wallet connects) is
  // blocked by the browser and silently never appears. So the automatic path
  // (`explicit === false`) NEVER opens the signing popup: it only reuses an
  // existing Supabase session for a returning wallet. A brand-new connection
  // signs only once the user taps "Sign to enter", which calls this with
  // `explicit === true` synchronously inside the tap.
  const runVerify = useCallback(async (explicit: boolean) => {
    const addr = addressRef.current;
    if (!addr) {
      logEvent("auth", "debug", "verify skipped: no connected wallet");
      return;
    }

    if (!explicit) {
      if (completedRef.current.has(addr.toLowerCase())) return;
      const { data: sess } = await supabase.auth.getSession();
      const existingEmail = sess.session?.user.email ?? "";
      if (existingEmail === `${addr.toLowerCase()}@wallet.baycmc.local`) {
        logEvent(
          "auth",
          "info",
          "verify: existing Supabase session matches wallet — short-circuit",
        );
        completedRef.current.add(addr.toLowerCase());
        if (!isVerifiedFresh(addr)) markVerified(addr);
      } else {
        logEvent(
          "auth",
          "info",
          "verify: wallet connected — awaiting user tap (popup needs a gesture)",
        );
      }
      return;
    }

    // Explicit path — single-flight so a double-tap can't fire two popups.
    if (inFlightRef.current === addr) {
      logEvent("auth", "debug", "verify skipped: signature already in-flight");
      return;
    }
    inFlightRef.current = addr;
    const toastId = `glyph-bridge-${addr.toLowerCase()}`;
    logEvent("auth", "info", "verify: entering signature path", {
      address: addr.slice(0, 6) + "…" + addr.slice(-4),
    });

    try {
      patchGlyphSnapshot({ verifying: true });
      logEvent("auth", "info", "verify: building SIWE + calling signMessage");

      const domain = window.location.host;
      const origin = window.location.origin;
      const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const siwe = new SiweMessage({
        domain,
        address: addr,
        uri: origin,
        version: "1",
        chainId: 1,
        nonce,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
      const message = siwe.prepareMessage();

      // signMessage is invoked synchronously here (inside the user's tap) so
      // the wallet's signing popup is allowed to open.
      let signature: string;
      try {
        signature = await withTimeout(
          signMessageRef.current({ message }),
          45_000,
          "Signature request timed out. Please try signing in again.",
        );
      } catch (e) {
        if (!isChunkLoadError(e)) throw e;
        logEvent("auth", "warn", "verify: signMessage chunk-load failed — retrying", {
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
        logEvent("auth", "warn", "verify: aborted after signMessage — component unmounted");
        return;
      }
      logEvent("auth", "info", "verify: signature obtained — calling verifyFn");

      toast.loading("Checking BAYC / MAYC ownership…", { id: toastId, position: "top-center" });
      const result = await withTimeout(
        verifyFnRef.current({ data: { message, signature } }),
        20_000,
        "The verification check is taking longer than expected. Please try again.",
      );
      if (unmountedRef.current) {
        logEvent("auth", "warn", "verify: aborted after verifyFn — component unmounted");
        return;
      }
      logEvent("auth", "info", "verify: verifyFn returned", {
        verified: result.verified,
        hasSession: !!result.session,
        collection: result.collection,
        reason: result.reason ?? null,
      });

      if (!result.session) {
        logEvent("auth", "error", "verify: server returned no session", { reason: result.reason });
        toast.error(result.reason ?? "Sign-in failed.", { id: toastId });
        return;
      }
      const { error } = await supabase.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      });
      if (error) {
        logEvent("auth", "error", "verify: setSession failed", { message: error.message });
        toast.error(error.message, { id: toastId });
        return;
      }
      logEvent("auth", "info", "verify: Supabase session set — redirect should follow");

      completedRef.current.add(addr.toLowerCase());
      markVerified(addr);

      // Tell useVerificationStatus consumers to reload their row — the server
      // fn just rewrote user_verifications.
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
        logEvent("auth", "error", "verify: threw", { message: msg });
        toast.error(msg || "Sign-in failed. Please try again.", { id: toastId });
      } else {
        logEvent("auth", "info", "verify: user rejected signature");
        toast.dismiss(toastId);
      }
    } finally {
      if (inFlightRef.current === addr) inFlightRef.current = null;
      patchGlyphSnapshot({ verifying: false });
    }
  }, []);

  // Explicit sign trigger. dispatchEvent runs listeners synchronously, so a
  // tap that dispatches "baycmc:wallet-verify" reaches signMessage inside the
  // same gesture and the wallet popup is allowed to open. Clearing the
  // completed guard lets a lobby user re-sign to re-check holdings.
  useEffect(() => {
    const onVerify = () => {
      completedRef.current.clear();
      void runVerify(true);
    };
    window.addEventListener("baycmc:wallet-verify", onVerify);
    return () => window.removeEventListener("baycmc:wallet-verify", onVerify);
  }, [runVerify]);

  // Hard sign-out from Glyph on demand. The inactivity timer can't call Glyph
  // hooks itself (it lives outside this React tree), so it dispatches a window
  // event we handle here from inside the hook context.
  useEffect(() => {
    const onLogout = () => {
      logEvent("auth", "info", "forced Glyph logout");
      completedRef.current.clear();
      inFlightRef.current = null;
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

  // Automatic path on connect: reuse an existing Supabase session if there is
  // one for this wallet (a returning user — no popup needed). A brand-new
  // connection does NOT sign here; it waits for the user's "Sign to enter"
  // tap, because the wallet signing popup can't open outside a user gesture.
  useEffect(() => {
    void runVerify(false);
  }, [address, runVerify]);

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
