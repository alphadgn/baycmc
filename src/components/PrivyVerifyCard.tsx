import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ExternalLink, Wallet, AlertTriangle } from "lucide-react";
import { SiweMessage } from "siwe";
import { supabase } from "@/integrations/supabase/client";
import {
  verifyPrivyOwnership,
  getPrivyPublicConfig,
  logEmbeddedWalletProvisioned,
} from "@/server/privy.functions";
import {
  isProvisionedPrivyWallet,
  resolvePrivyProvisionedWallet,
} from "@/lib/privyWallets";
import { logEvent } from "@/lib/diagnostics";
import { enqueueSign } from "@/lib/wallet/txQueue";
import { toast } from "sonner";

type EthereumProviderLike = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

type WalletLike = {
  address: string;
  chainType?: string;
  chain_type?: string;
  walletClientType?: string;
  wallet_client_type?: string;
  connectorType?: string;
  connector_type?: string;
  getEthereumProvider?: () => Promise<EthereumProviderLike>;
};

type PrivyLinkedWalletLike = WalletLike & {
  type?: string;
  chainType?: string;
  chain_type?: string;
  walletClientType?: string;
  wallet_client_type?: string;
  connectorType?: string;
  connector_type?: string;
};

type PrivyUserLike = {
  id?: string;
  email?: { address?: string } | null;
  wallet?: Partial<PrivyLinkedWalletLike> | null;
  linkedAccounts?: Array<Partial<PrivyLinkedWalletLike> & { type?: string }>;
};

type PrivyOwnershipResult =
  | {
      verified: false;
      reason?: string;
      wallet: string;
    }
  | {
      verified: true;
      collection: "BAYC" | "MAYC";
      wallet: string;
      verificationBasis?: "direct" | "delegated";
      delegatedFrom?: string | null;
      delegationDetailsUrl?: string | null;
      session: { access_token: string; refresh_token: string };
    };

type VerifiedWalletPayload = {
  address: string;
  collection: "BAYC" | "MAYC";
  signature: string;
};

type PrivyHooks = {
  usePrivy: () => {
    ready: boolean;
    authenticated: boolean;
    login: () => void;
    logout: () => void;
    user?: PrivyUserLike | null;
  };
  useWallets: () => { wallets: WalletLike[]; ready: boolean };
  useCreateWallet: () => {
    createWallet: (options?: { createAdditional?: boolean }) => Promise<WalletLike>;
  };
  useUser: () => { user: PrivyUserLike | null; refreshUser: () => Promise<PrivyUserLike> };
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
 * Privy verification card. The Privy SDK touches `window`/`localStorage` at
 * module-evaluation time and crashes the Worker SSR runtime, so we
 * dynamic-import its hooks inside an effect and render a skeleton until
 * they're available. This component must NOT statically import
 * `@privy-io/react-auth` anywhere reachable from SSR.
 */
export function PrivyVerifyCard({
  onVerified,
  onLoginRequested,
  onNoQualifyingAssets,
}: {
  onVerified: (payload: VerifiedWalletPayload) => void;
  onLoginRequested?: () => void;
  onNoQualifyingAssets?: (reason: string) => void;
}) {
  const [hooks, setHooks] = useState<PrivyHooks | null>(null);
  type ConfigState =
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "wrong-secret-type" }
    | { kind: "invalid-format" }
    | { kind: "ok" };
  const [configState, setConfigState] = useState<ConfigState>({ kind: "loading" });
  const fetchConfig = useServerFn(getPrivyPublicConfig);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await fetchConfig();
        if (cancelled) return;
        const id = (cfg.appId ?? "").trim();
        if (!cfg.configured || !id) {
          setConfigState({ kind: "missing" });
          return;
        }
        // The user pasted a Privy *app secret* into the App ID slot.
        if (/^privy_app_secret/i.test(id)) {
          setConfigState({ kind: "wrong-secret-type" });
          return;
        }
        const valid = id.length >= 20 && id.length <= 40 && /^[a-z0-9]+$/i.test(id);
        if (!valid) {
          setConfigState({ kind: "invalid-format" });
          return;
        }
        setConfigState({ kind: "ok" });
        const mod = await import("@privy-io/react-auth");
        if (cancelled) return;
        setHooks({
          usePrivy: mod.usePrivy,
          useWallets: mod.useWallets,
          useCreateWallet: mod.useCreateWallet,
          useUser: mod.useUser,
          useSignMessage: mod.useSignMessage,
        });
      } catch {
        if (!cancelled) setConfigState({ kind: "missing" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  // Always render the card so users can see "Connect a wallet" as a
  // sign-in option even when Privy is not yet configured. We surface the
  // exact misconfiguration so the admin knows what to fix.
  if (configState.kind !== "ok" || !hooks) {
    const message =
      configState.kind === "wrong-secret-type"
        ? "Privy isn't quite configured: the PRIVY_APP_ID secret currently holds a Privy *app secret* (starts with `privy_app_secret_`). Paste the public App ID from your Privy dashboard instead."
        : configState.kind === "invalid-format"
          ? "Privy isn't quite configured: the PRIVY_APP_ID value doesn't look like a valid App ID. Copy it from your Privy dashboard."
          : configState.kind === "missing"
            ? "Wallet sign-in is being set up. Use Tokenproof above to enter for now."
            : null;

    return (
      <div className="rounded-xl border border-border bg-secondary/20 p-5">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gold" />
          <div className="text-lg font-semibold">Privy</div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Secure connection options.</p>
        {message ? (
          <div className="mt-4 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground">
            {message}
          </div>
        ) : (
          <div className="mt-4 h-10 animate-pulse rounded-md bg-muted/30" />
        )}
      </div>
    );
  }

  return (
    <PrivyVerifyCardInner
      hooks={hooks}
      onVerified={onVerified}
      onLoginRequested={onLoginRequested}
      onNoQualifyingAssets={onNoQualifyingAssets}
    />
  );
}

function PrivyVerifyCardInner({
  hooks,
  onVerified,
  onLoginRequested,
  onNoQualifyingAssets,
}: {
  hooks: PrivyHooks;
  onVerified: (payload: VerifiedWalletPayload) => void;
  onLoginRequested?: () => void;
  onNoQualifyingAssets?: (reason: string) => void;
}) {
  // ────────────────────────────────────────────────────────────────────
  // Privy embedded wallet lifecycle — strict, official pattern.
  //
  // PrivyProvider is configured with embeddedWallets.ethereum.createOnLogin
  // = 'all-users'. That means Privy provisions the embedded wallet itself
  // after login. We MUST NOT call createWallet() manually here — doing so
  // races Privy's internal provisioning and produces an infinite rerender
  // loop (authenticated → createWallet → state churn → effect refires).
  //
  // Readiness is derived ONLY from useWallets():
  //   ready === true  AND  embeddedWallet exists  →  app may proceed.
  // ────────────────────────────────────────────────────────────────────
  const { ready, authenticated, login, logout, user } = hooks.usePrivy();
  const { wallets, ready: walletsReady } = hooks.useWallets();
  const { refreshUser } = hooks.useUser();
  const { signMessage } = hooks.useSignMessage();
  const verifyFn = useServerFn(verifyPrivyOwnership);
  const auditProvisionFn = useServerFn(logEmbeddedWalletProvisioned);

  const isSecureContext = useMemo(
    () => (typeof window === "undefined" ? true : window.isSecureContext === true),
    [],
  );

  type VerificationResult = {
    collection: "BAYC" | "MAYC";
    verificationBasis: "direct" | "delegated";
    wallet: string;
    delegatedFrom: string | null;
    delegationDetailsUrl: string | null;
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [loginStartedHere, setLoginStartedHere] = useState(false);
  const autoVerifiedWalletRef = useRef<string | null>(null);
  const auditedWalletRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The single source of truth: the embedded Privy wallet, found via the
  // useWallets() collection that Privy itself hydrates.
  const embeddedWallet: WalletLike | null = useMemo(() => {
    return (
      wallets.find(
        (w) =>
          (w.walletClientType ?? w.wallet_client_type) === "privy" ||
          (w.walletClientType ?? w.wallet_client_type) === "privy-v2",
      ) ?? null
    );
  }, [wallets]);

  // Strict application gate per Privy embedded wallet docs:
  //   ready (privy) + authenticated + walletsReady + embeddedWallet present.
  const isWalletReady = ready && authenticated && walletsReady && !!embeddedWallet;

  // Single, bounded auth-state log — no reactive cascade.
  useEffect(() => {
    logEvent("auth", "info", "auth state", {
      ready,
      authenticated,
      walletsReady,
      userId: user?.id ?? null,
      walletCount: wallets.length,
      embeddedWalletAddress: embeddedWallet?.address ?? null,
    });
  }, [ready, authenticated, walletsReady, user?.id, wallets.length, embeddedWallet?.address]);

  // Reset transient state on logout / user change.
  useEffect(() => {
    if (!authenticated) {
      autoVerifiedWalletRef.current = null;
      auditedWalletRef.current = null;
      setVerificationResult(null);
      setError(null);
      setInitError(null);
    }
  }, [authenticated]);

  // Best-effort one-shot audit log when the embedded wallet first appears.
  useEffect(() => {
    if (!isWalletReady || !user?.id || !embeddedWallet?.address) return;
    if (auditedWalletRef.current === embeddedWallet.address) return;
    auditedWalletRef.current = embeddedWallet.address;
    void auditProvisionFn({
      data: {
        privyUserId: user.id,
        walletAddress: embeddedWallet.address,
        email: user.email?.address ?? null,
      },
    }).catch((e) => {
      console.warn("[PrivyVerifyCard] audit log call failed", e);
    });
  }, [isWalletReady, embeddedWallet?.address, user?.id, user?.email?.address, auditProvisionFn]);

  const verifyWallet = useCallback(
    async (targetWallet: WalletLike | null) => {
      if (!targetWallet) {
        setError("No wallet detected. Reconnect from the Privy modal.");
        return;
      }
      setBusy(true);
      setError(null);
      setVerificationResult(null);
      try {
        const address = targetWallet.address;
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

        let signature: string;
        try {
          const signed = await signMessage(
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
          signature = signed.signature;
        } catch (signError) {
          if (!targetWallet.getEthereumProvider) throw signError;
          const provider = await targetWallet.getEthereumProvider();
          signature = (await enqueueSign(
            provider,
            "personal_sign",
            [message, address],
            { label: "verify:personal_sign" },
          )) as string;
        }

        const result = (await verifyFn({
          data: { message, signature },
        })) as PrivyOwnershipResult;

        if (!result.verified) {
          const reason = result.reason ?? "No qualifying BAYC/MAYC assets found.";
          setError(reason);
          onNoQualifyingAssets?.(reason);
          return;
        }

        const { error: sessErr } = await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
        if (sessErr) {
          setError(sessErr.message);
          return;
        }

        setVerificationResult({
          collection: result.collection,
          verificationBasis:
            result.verificationBasis ?? (result.delegatedFrom ? "delegated" : "direct"),
          wallet: result.wallet,
          delegatedFrom: result.delegatedFrom ?? null,
          delegationDetailsUrl: result.delegationDetailsUrl ?? null,
        });

        toast.success(
          result.delegatedFrom
            ? `Verified — ${result.collection} delegated from ${shortAddress(result.delegatedFrom)}`
            : `Verified — ${result.collection} direct ownership confirmed`,
        );
        onVerified({
          address: result.wallet,
          collection: result.collection,
          signature,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.toLowerCase().includes("user rejected")) {
          setError("Signature request was cancelled. Try again when ready.");
        } else if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) {
          setError("Network error reaching Ethereum. Try again in a moment.");
        } else {
          setError(msg || "Something went wrong. Try again.");
        }
      } finally {
        setBusy(false);
      }
    },
    [onVerified, onNoQualifyingAssets, signMessage, verifyFn],
  );

  // Auto-verify once per wallet — no loop, just a single one-shot per address.
  useEffect(() => {
    if (!isWalletReady || !embeddedWallet || busy) return;
    if (autoVerifiedWalletRef.current === embeddedWallet.address) return;
    autoVerifiedWalletRef.current = embeddedWallet.address;
    void verifyWallet(embeddedWallet);
  }, [isWalletReady, embeddedWallet, busy, verifyWallet]);

  function handleSignAndVerify() {
    void verifyWallet(embeddedWallet);
  }

  function handleDisconnect() {
    autoVerifiedWalletRef.current = null;
    auditedWalletRef.current = null;
    setLoginStartedHere(false);
    setVerificationResult(null);
    setError(null);
    setInitError(null);
    logout();
  }

  // Bounded one-shot retry path: refresh the Privy session ONCE if init
  // appears stuck. We never recursively retry.
  function handleRetryInit() {
    setInitError(null);
    void refreshUser().catch((e) => {
      setInitError(e instanceof Error ? e.message : String(e));
    });
  }

  if (!isSecureContext) {
    return (
      <div
        data-testid="privy-status-insecure-context"
        className="rounded-xl border border-destructive/40 bg-destructive/10 p-5"
      >
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <div className="text-lg font-semibold">Insecure connection</div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Wallet sign-in requires HTTPS. Open this site over a secure connection to continue.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-border bg-secondary/20 p-5"
      data-wallet-ready={isWalletReady ? "true" : "false"}
    >
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-gold" />
        <div className="text-lg font-semibold">Privy</div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Secure connection options.</p>

      {error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {!ready ? (
        <div className="mt-4 h-10 animate-pulse rounded-md bg-muted/30" />
      ) : !authenticated ? (
        <button
          onClick={() => {
            setLoginStartedHere(true);
            onLoginRequested?.();
            setTimeout(() => login(), 0);
          }}
          className="mt-4 w-full rounded-md border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold cursor-pointer hover:bg-gold/20"
        >
          Connect wallet
        </button>
      ) : !isWalletReady ? (
        <div className="mt-4 space-y-2" data-testid="privy-status-initializing">
          <div className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground">
            Initializing secure wallet…
          </div>
          {initError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {initError}
            </div>
          )}
          <button
            onClick={handleRetryInit}
            className="w-full rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground cursor-pointer hover:bg-secondary"
          >
            Retry
          </button>
          <button
            onClick={handleDisconnect}
            className="w-full rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground cursor-pointer hover:bg-secondary"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2" data-testid="privy-post-login">
          {busy && (
            <div
              data-testid="privy-status-verifying"
              className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground"
            >
              Checking BAYC / MAYC ownership for {shortAddress(embeddedWallet!.address)}…
            </div>
          )}
          {verificationResult && (
            <div
              data-testid="privy-verification-basis"
              className="rounded-md border border-gold/30 bg-gold/5 px-3 py-3 text-xs text-muted-foreground"
            >
              <div className="flex items-center gap-2 font-semibold text-gold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Verified · {verificationResult.collection}
              </div>
              {verificationResult.verificationBasis === "delegated" &&
              verificationResult.delegatedFrom ? (
                <div className="mt-2 space-y-1">
                  <div>
                    Access granted by delegated vault: delegated from{" "}
                    <span className="font-mono text-foreground">
                      {shortAddress(verificationResult.delegatedFrom)}
                    </span>{" "}
                    to this Privy wallet.
                  </div>
                  {verificationResult.delegationDetailsUrl && (
                    <a
                      href={verificationResult.delegationDetailsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-gold underline cursor-pointer hover:opacity-80"
                    >
                      View delegation details
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="mt-2">Access granted by direct ownership in the Privy wallet.</div>
              )}
            </div>
          )}
          <button
            onClick={handleSignAndVerify}
            disabled={busy}
            className="w-full rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold cursor-pointer disabled:opacity-50 hover:opacity-90"
          >
            {busy ? "Verifying ownership…" : "Sign & verify holdings"}
          </button>
          <button
            onClick={handleDisconnect}
            className="w-full rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground cursor-pointer hover:bg-secondary"
          >
            Disconnect
          </button>
        </div>
      )}
      {/* loginStartedHere is retained for parent-orchestration parity */}
      {loginStartedHere ? null : null}
    </div>
  );
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isEmbeddedEthereumWallet(wallet: Partial<PrivyLinkedWalletLike> | null | undefined) {
  const chainType = wallet?.chainType ?? wallet?.chain_type;
  const walletClientType = wallet?.walletClientType ?? wallet?.wallet_client_type;
  const connectorType = wallet?.connectorType ?? wallet?.connector_type;

  return (
    typeof wallet?.address === "string" &&
    wallet.address.length > 0 &&
    (chainType ?? "ethereum") === "ethereum" &&
    (walletClientType === "privy" ||
      walletClientType === "privy-v2" ||
      connectorType === "embedded")
  );
}

function getUserWallet(user: PrivyUserLike | null | undefined): WalletLike | null {
  const linkedWallet = user?.linkedAccounts?.find(
    (account) => account.type === "wallet" && isEmbeddedEthereumWallet(account),
  );

  const candidate = linkedWallet ?? (isEmbeddedEthereumWallet(user?.wallet) ? user?.wallet : null);
  if (!candidate?.address) return null;
  return { address: candidate.address };
}
