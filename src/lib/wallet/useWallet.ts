/**
 * useWallet — derived wallet readiness hook on top of Privy.
 *
 * Decouples authentication from wallet readiness so callers can gate
 * wallet-dependent UI on a single boolean (`walletReady`) without
 * re-deriving the rules each place. Adds:
 *
 *   - explicit createWallet() retry with exponential backoff (max 3)
 *   - structured logging via logEvent() for every state transition
 *   - HTTPS / secure-context validation
 *
 * The Privy SDK touches `window` at module evaluation time and crashes
 * Worker SSR, so this hook receives the dynamically-imported Privy hooks
 * as an argument rather than importing them statically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logEvent } from "@/lib/diagnostics";
import {
  resolvePrivyProvisionedWallet,
  type PrivyWalletLike,
} from "@/lib/privyWallets";

export type EthereumProviderLike = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type WalletLike = {
  address: string;
  chainType?: string;
  chain_type?: string;
  walletClientType?: string;
  wallet_client_type?: string;
  connectorType?: string;
  connector_type?: string;
  getEthereumProvider?: () => Promise<EthereumProviderLike>;
};

export type PrivyUserLike = {
  id?: string;
  email?: { address?: string } | null;
  wallet?: (PrivyWalletLike & WalletLike) | null;
  linkedAccounts?: Array<(PrivyWalletLike & WalletLike) & { type?: string }>;
};

export type WalletState = "idle" | "creating" | "ready" | "failed";
export type AuthState = "loading" | "unauthenticated" | "authenticated" | "WALLET_READY";

export interface UseWalletInput {
  ready: boolean;
  authenticated: boolean;
  walletsReady: boolean;
  wallets: WalletLike[];
  user: PrivyUserLike | null | undefined;
  createWallet: (opts?: { createAdditional?: boolean }) => Promise<WalletLike>;
  refreshUser: () => Promise<PrivyUserLike>;
}

export interface UseWalletResult {
  authState: AuthState;
  walletState: WalletState;
  /** Single boolean to gate wallet-dependent UI. */
  walletReady: boolean;
  wallet: WalletLike | null;
  sessionWallets: WalletLike[];
  error: string | null;
  attempt: number;
  retry: () => void;
  reset: () => void;
  isSecureContext: boolean;
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1500;

function backoffDelay(attempt: number): number {
  // 1.5s, 3s, 6s
  return BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempt - 1));
}

function isSecureCtx(): boolean {
  if (typeof window === "undefined") return true; // SSR — assume safe
  // localhost is treated as secure by browsers for crypto APIs
  return window.isSecureContext === true;
}

export function useWallet(input: UseWalletInput): UseWalletResult {
  const { ready, authenticated, walletsReady, wallets, user, createWallet, refreshUser } = input;

  const [walletState, setWalletState] = useState<WalletState>("idle");
  const [createdWallet, setCreatedWallet] = useState<WalletLike | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [bumpKey, setBumpKey] = useState(0);

  const mountedRef = useRef(true);
  const inflightRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);
  const timersRef = useRef<number[]>([]);
  const isSecureContext = useMemo(() => isSecureCtx(), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const t of timersRef.current) window.clearTimeout(t);
      timersRef.current = [];
    };
  }, []);

  const sessionWallets: WalletLike[] = useMemo(() => {
    const seen = new Map<string, WalletLike>();
    const add = (w: WalletLike | null | undefined) => {
      if (!w?.address) return;
      const chain = w.chainType ?? w.chain_type ?? "ethereum";
      if (chain !== "ethereum") return;
      const key = w.address.toLowerCase();
      if (!seen.has(key)) seen.set(key, w);
    };
    for (const w of wallets) add(w);
    add((user?.wallet ?? null) as WalletLike | null);
    for (const acc of user?.linkedAccounts ?? []) {
      if (acc.type === "wallet") add(acc as WalletLike);
    }
    if (createdWallet) add(createdWallet);
    return [...seen.values()];
  }, [wallets, user, createdWallet]);

  const embedded = useMemo(
    () => resolvePrivyProvisionedWallet({ user, wallets, createdWallet }) as WalletLike | null,
    [user, wallets, createdWallet],
  );
  const wallet: WalletLike | null = embedded ?? sessionWallets[0] ?? null;

  // Reset on user change (logout, re-auth as different user)
  useEffect(() => {
    const cur = authenticated ? (user?.id ?? null) : null;
    if (lastUserIdRef.current !== cur) {
      const prev = lastUserIdRef.current;
      lastUserIdRef.current = cur;
      logEvent("auth", "info", "auth user changed", { prev, next: cur });
      inflightRef.current = false;
      setAttempt(0);
      if (!authenticated) {
        setCreatedWallet(null);
        setWalletState("idle");
        setError(null);
      }
    }
  }, [authenticated, user?.id]);

  // Real-time wallet inspector: as soon as Privy surfaces an embedded wallet,
  // flip walletState to "ready". This unsticks the "creating" screen the
  // moment Privy confirms provisioning.
  useEffect(() => {
    if (!authenticated) return;
    if (!embedded) return;
    if (walletState === "ready") return;
    logEvent("wallet", "info", "embedded wallet detected", {
      address: embedded.address,
      via: embedded === createdWallet ? "createWallet" : "session",
    });
    setWalletState("ready");
    setError(null);
  }, [authenticated, embedded, walletState, createdWallet]);

  // Poll refreshUser while creating, so we don't depend on createWallet's
  // promise resolution to learn about provisioning.
  useEffect(() => {
    if (walletState !== "creating") return;
    const id = window.setInterval(() => {
      void refreshUser().catch(() => {});
    }, 1500);
    return () => window.clearInterval(id);
  }, [walletState, refreshUser]);

  // Auto-provisioning loop with exponential backoff.
  useEffect(() => {
    if (!authenticated || !walletsReady || !user?.id) return;
    if (embedded) return; // already have one
    if (walletState !== "idle" && walletState !== "failed") return;
    if (inflightRef.current) return;
    if (attempt >= MAX_ATTEMPTS) return;

    inflightRef.current = true;
    const next = attempt + 1;
    setAttempt(next);
    setWalletState("creating");
    setError(null);
    logEvent("wallet", "info", "createWallet attempt", { attempt: next });

    const timeout = window.setTimeout(
      () => {
        if (!mountedRef.current) return;
        logEvent("wallet", "warn", "createWallet timeout", { attempt: next });
        inflightRef.current = false;
        if (next >= MAX_ATTEMPTS) {
          setWalletState("failed");
          setError(
            "Wallet creation didn't confirm after several attempts. Tap Retry to try again.",
          );
        } else {
          // Schedule next attempt with backoff
          const delay = backoffDelay(next);
          const t = window.setTimeout(() => {
            if (!mountedRef.current) return;
            setBumpKey((k) => k + 1); // re-trigger effect
          }, delay);
          timersRef.current.push(t);
          setWalletState("idle");
        }
      },
      Math.max(15_000, backoffDelay(next) + 5_000),
    );
    timersRef.current.push(timeout);

    void createWallet({ createAdditional: false })
      .then(async (newWallet) => {
        window.clearTimeout(timeout);
        if (!mountedRef.current) return;
        logEvent("wallet", "info", "createWallet resolved", {
          attempt: next,
          address: newWallet.address,
        });
        setCreatedWallet(newWallet);
        try {
          await refreshUser();
        } catch (e) {
          logEvent("wallet", "warn", "refreshUser after create failed", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
        if (!mountedRef.current) return;
        setWalletState("ready");
        inflightRef.current = false;
      })
      .catch((e: unknown) => {
        window.clearTimeout(timeout);
        if (!mountedRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        logEvent("wallet", "error", "createWallet failed", { attempt: next, error: msg });
        inflightRef.current = false;
        if (next >= MAX_ATTEMPTS) {
          setWalletState("failed");
          setError(msg || "We couldn't create your embedded wallet. Try again.");
        } else {
          const delay = backoffDelay(next);
          logEvent("wallet", "info", "createWallet backoff", { attempt: next, delay });
          const t = window.setTimeout(() => {
            if (!mountedRef.current) return;
            setBumpKey((k) => k + 1);
          }, delay);
          timersRef.current.push(t);
          setWalletState("idle");
        }
      });
  }, [
    authenticated,
    walletsReady,
    user?.id,
    embedded,
    walletState,
    attempt,
    createWallet,
    refreshUser,
    bumpKey,
  ]);

  const retry = useCallback(() => {
    logEvent("wallet", "info", "manual retry requested");
    inflightRef.current = false;
    setError(null);
    setAttempt(0);
    setWalletState("idle");
    setBumpKey((k) => k + 1);
  }, []);

  const reset = useCallback(() => {
    inflightRef.current = false;
    setCreatedWallet(null);
    setError(null);
    setAttempt(0);
    setWalletState("idle");
  }, []);

  const walletReady =
    isSecureContext &&
    ready &&
    authenticated &&
    walletsReady &&
    wallet !== null &&
    walletState !== "creating" &&
    walletState !== "failed";

  const authState: AuthState = !ready
    ? "loading"
    : !authenticated
      ? "unauthenticated"
      : walletReady
        ? "WALLET_READY"
        : "authenticated";

  return {
    authState,
    walletState,
    walletReady,
    wallet,
    sessionWallets,
    error,
    attempt,
    retry,
    reset,
    isSecureContext,
  };
}
