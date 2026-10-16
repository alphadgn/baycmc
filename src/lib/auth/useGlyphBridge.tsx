/**
 * Wallet → Supabase bridge (Glyph, browser wallets, WalletConnect).
 *
 * AUTHENTICATION (who you are): one SIWE signature → Supabase session.
 * AUTHORIZATION (what you can do): on-chain BAYC/MAYC ownership.
 *
 * Lifecycle:
 *   1. A wallet connects through any wagmi connector (Glyph's modal for
 *      email/social/Glyph-wallet users, or an external wallet).
 *   2. If a Supabase session already exists for that address → done.
 *   3. Otherwise we immediately PREFETCH a single-use server nonce
 *      (getSiweNonce) so the user's "Sign to enter" tap can open the signing
 *      popup synchronously — the Glyph popup is blocked outside a gesture.
 *   4. Tap → SIWE sign (wagmi signMessage, works for every connector) →
 *      verifyOwnership → supabase.auth.setSession.
 *
 * SECURITY: we no longer send a client-built "linkedWallets" list (the server
 * used to trust it). If Glyph left a widget token in storage we forward it
 * and the SERVER asks Glyph which wallets are linked.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SiweMessage } from "siwe";
import { toast } from "sonner";
import { useAccount, useConfig, useDisconnect, useSignMessage } from "wagmi";
import { supabase } from "@/integrations/supabase/client";
import { collectionNameForLabel } from "@/lib/web3/constants";
import { getSiweNonce, verifyOwnership } from "@/server/wallet.functions";
import { useGlyphReady } from "@/components/GlyphAppProvider";
import { logEvent } from "@/lib/diagnostics";

export interface GlyphAuthSnapshot {
  ready: boolean;
  authenticated: boolean; // a wallet is connected
  address: string | null;
  connectorId: string | null;
  verifying: boolean;
}
let glyphSnapshot: GlyphAuthSnapshot = {
  ready: false,
  authenticated: false,
  address: null,
  connectorId: null,
  verifying: false,
};
const glyphListeners = new Set<() => void>();
function patchGlyphSnapshot(patch: Partial<GlyphAuthSnapshot>) {
  const next = { ...glyphSnapshot, ...patch };
  if ((Object.keys(next) as (keyof GlyphAuthSnapshot)[]).every((k) => next[k] === glyphSnapshot[k]))
    return;
  glyphSnapshot = next;
  for (const l of glyphListeners) l();
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
function markVerified(addr: string) {
  try {
    window.localStorage.setItem(verifiedKey(addr), String(Date.now()));
  } catch {
    /* ignore */
  }
}
export function isVerifiedFresh(addr: string): boolean {
  try {
    const ts = Number.parseInt(window.localStorage.getItem(verifiedKey(addr)) ?? "", 10);
    return Number.isFinite(ts) && Date.now() - ts < VERIFIED_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Hard-reset every shred of cached wallet state (inactivity timeout, forced
 * sign-out). Clears our markers, Glyph/Privy persisted sessions and wagmi's
 * remembered connector so the next visit starts from the entrance modal.
 */
export function clearWalletAuthLocalState() {
  if (typeof window === "undefined") return;
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = store.length - 1; i >= 0; i--) {
        const k = store.key(i);
        if (!k) continue;
        if (
          k.startsWith("baycmc:verified:") ||
          k.startsWith("glyph:") ||
          k.startsWith("privy:") ||
          // Glyph's cross-app connection cache (wallet address + encryption
          // keys for this site). Missing before → a previous Glyph
          // connection could carry into the next session.
          k.startsWith("privy-caw:") ||
          k.startsWith("__glyph-widget-") ||
          k.startsWith("wagmi.") ||
          k.startsWith("wc@2") ||
          k.startsWith("@w3m") ||
          k.startsWith("@appkit") ||
          k.startsWith("W3M") ||
          k.startsWith("WCM") ||
          k.startsWith("-walletlink") ||
          k.startsWith("walletconnect")
        ) {
          store.removeItem(k);
        }
      }
    }
  } catch {
    /* private mode — ignore */
  }
  // WalletConnect v2 keeps pairings/sessions in IndexedDB.
  try {
    window.indexedDB?.deleteDatabase("WALLET_CONNECT_V2_INDEXED_DB");
  } catch {
    /* ignore */
  }
  // Privy (Glyph) session cookies on this site.
  try {
    for (const c of document.cookie.split(";")) {
      const name = c.split("=")[0]?.trim();
      if (name && /^privy-/i.test(name)) {
        document.cookie = `${name}=; Max-Age=0; path=/`;
      }
    }
  } catch {
    /* ignore */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

function glyphSessionFromStorage(): { token: string; nonce: string } | undefined {
  try {
    const token = window.localStorage.getItem("__glyph-widget-token__");
    const nonce = window.localStorage.getItem("__glyph-widget-nonce__");
    return token && nonce ? { token, nonce } : undefined;
  } catch {
    return undefined;
  }
}

function WalletBridge() {
  const { address: wagmiAddress, isConnected, connector, chainId } = useAccount();
  const chainIdRef = useRef<number | undefined>(chainId);
  chainIdRef.current = chainId;
  const { signMessageAsync } = useSignMessage();
  const { disconnectAsync } = useDisconnect();
  const config = useConfig();
  const configRef = useRef(config);
  configRef.current = config;
  const verifyFn = useServerFn(verifyOwnership);
  const nonceFn = useServerFn(getSiweNonce);

  const address = isConnected ? (wagmiAddress ?? null) : null;
  const addressRef = useRef(address);
  addressRef.current = address;
  const signRef = useRef(signMessageAsync);
  signRef.current = signMessageAsync;
  const verifyRef = useRef(verifyFn);
  verifyRef.current = verifyFn;
  const nonceRef = useRef(nonceFn);
  nonceRef.current = nonceFn;
  const disconnectRef = useRef(disconnectAsync);
  disconnectRef.current = disconnectAsync;

  const inFlightRef = useRef<string | null>(null);
  const prefetched = useRef<{ address: string; nonce: string; expiresAt: number } | null>(null);

  // One nonce request at a time per address. Tapping "Sign to enter" while
  // the on-connect prefetch is still in flight used to start a second,
  // racing request; if either failed, the user only saw "Couldn't start
  // sign-in". Now the tap waits for the in-flight request, retries once, and
  // reports the server's actual reason.
  const nonceInFlight = useRef<{ address: string; promise: Promise<void> } | null>(null);
  const lastNonceError = useRef<string | null>(null);
  const prefetchNonce = useCallback(async (addr: string) => {
    const key = addr.toLowerCase();
    if (nonceInFlight.current?.address === key) return nonceInFlight.current.promise;
    const promise = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await nonceRef.current({ data: { address: addr } });
          prefetched.current = {
            address: key,
            nonce: res.nonce,
            expiresAt: new Date(res.expiresAt).getTime(),
          };
          lastNonceError.current = null;
          return;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          lastNonceError.current = message;
          logEvent("auth", "warn", "nonce prefetch failed", { message, attempt });
          if (/too many/i.test(message)) return; // rate-limited: retrying won't help
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    })();
    nonceInFlight.current = { address: key, promise };
    try {
      await promise;
    } finally {
      if (nonceInFlight.current?.promise === promise) nonceInFlight.current = null;
    }
  }, []);

  // On connect: reuse an existing session for this wallet, else prefetch a nonce.
  useEffect(() => {
    if (!address) {
      prefetched.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user.email === `${address.toLowerCase()}@wallet.baycmc.local`) {
        markVerified(address);
        return;
      }
      await prefetchNonce(address);
    })();
    return () => {
      cancelled = true;
    };
  }, [address, prefetchNonce]);

  const runVerify = useCallback(async () => {
    const addr = addressRef.current;
    if (!addr) {
      toast.error("Connect a wallet first.");
      return;
    }
    if (inFlightRef.current === addr) return;
    inFlightRef.current = addr;
    const toastId = `wallet-verify-${addr.toLowerCase()}`;
    patchGlyphSnapshot({ verifying: true });
    try {
      // A prefetch may still be running from the moment the wallet connected.
      if (nonceInFlight.current?.address === addr.toLowerCase()) {
        await nonceInFlight.current.promise;
      }
      let pre = prefetched.current;
      if (!pre || pre.address !== addr.toLowerCase() || pre.expiresAt - Date.now() < 30_000) {
        // Only hit when the prefetch is missing/expired. Browser wallets sign
        // fine after an await; Glyph's popup may need one more tap.
        await prefetchNonce(addr);
        pre = prefetched.current;
      }
      if (!pre) {
        throw new Error(
          lastNonceError.current && !/^failed to fetch$/i.test(lastNonceError.current)
            ? lastNonceError.current
            : "Couldn't reach the sign-in server. Check your connection and try again.",
        );
      }
      prefetched.current = null; // single use

      const message = new SiweMessage({
        domain: window.location.host,
        address: addr,
        statement: "Sign in to BAYCmc. This does not cost gas or move funds.",
        uri: window.location.origin,
        version: "1",
        // The chain the wallet is actually on (Glyph = ApeChain); the server
        // verifies signature + nonce, not the chain.
        chainId: chainIdRef.current ?? 1,
        nonce: pre.nonce,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      }).prepareMessage();

      const signature = await withTimeout(
        signRef.current({ message, account: addr as `0x${string}` }),
        90_000,
        "Signature request timed out. Please try again.",
      );

      toast.loading("Checking BAYC / MAYC ownership…", { id: toastId, position: "top-center" });
      const result = await withTimeout(
        verifyRef.current({
          data: { message, signature, glyphSession: glyphSessionFromStorage() },
        }),
        25_000,
        "The verification check is taking longer than expected. Please try again.",
      );
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
      markVerified(addr);
      window.dispatchEvent(new Event("baycmc:verification-refresh"));
      if (result.verified) {
        toast.success(
          `Welcome aboard — ${collectionNameForLabel(result.collection) ?? "holder"} verified`,
          {
            id: toastId,
            duration: 3000,
          },
        );
      } else {
        // No "You're in the lobby / No BAYC/MAYC found" notification — removed
        // app-wide by request. Just clear the "Checking ownership…" spinner.
        toast.dismiss(toastId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/user rejected|user denied|rejected the request/i.test(msg)) {
        toast.dismiss(toastId);
      } else {
        logEvent("auth", "error", "verify threw", { message: msg });
        toast.error(msg || "Sign-in failed. Please try again.", { id: toastId });
      }
      // Fresh nonce for the retry.
      if (addressRef.current) void prefetchNonce(addressRef.current);
    } finally {
      inFlightRef.current = null;
      patchGlyphSnapshot({ verifying: false });
    }
  }, [prefetchNonce]);

  // "Sign to enter" taps dispatch this; dispatchEvent is synchronous, so
  // signMessage starts inside the user gesture.
  useEffect(() => {
    const onVerify = () => void runVerify();
    window.addEventListener("baycmc:wallet-verify", onVerify);
    return () => window.removeEventListener("baycmc:wallet-verify", onVerify);
  }, [runVerify]);

  useEffect(() => {
    const onLogout = () => {
      prefetched.current = null;
      inFlightRef.current = null;
      // End EVERY wallet session — Glyph (Privy), browser wallets and
      // WalletConnect — not just the active one, then wipe persisted state.
      void (async () => {
        const cfg = configRef.current;
        const connectors = new Set(cfg.connectors);
        for (const conn of cfg.state.connections.values()) connectors.add(conn.connector);
        await Promise.allSettled(
          [...connectors].map((c) => disconnectRef.current({ connector: c })),
        );
        await Promise.allSettled([...connectors].map((c) => c.disconnect()));
        clearWalletAuthLocalState();
      })();
      clearWalletAuthLocalState();
      patchGlyphSnapshot({
        authenticated: false,
        address: null,
        connectorId: null,
        verifying: false,
      });
    };
    window.addEventListener("baycmc:wallet-logout", onLogout);
    return () => window.removeEventListener("baycmc:wallet-logout", onLogout);
  }, []);

  useEffect(() => {
    patchGlyphSnapshot({
      ready: true,
      authenticated: isConnected && !!address,
      address,
      connectorId: connector?.id ?? null,
    });
  }, [isConnected, address, connector?.id]);

  return null;
}

/** Mounted once at the root; renders the bridge as soon as wagmi is ready. */
export function GlyphBridgeMount() {
  const ready = useGlyphReady();
  return ready ? <WalletBridge /> : null;
}
