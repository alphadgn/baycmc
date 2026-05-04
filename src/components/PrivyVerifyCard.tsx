import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ExternalLink, Wallet } from "lucide-react";
import { SiweMessage } from "siwe";
import { supabase } from "@/integrations/supabase/client";
import { verifyPrivyOwnership, getPrivyPublicConfig } from "@/server/privy.functions";
import { toast } from "sonner";

type EthereumProviderLike = {
  request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
};

type WalletLike = {
  address: string;
  getEthereumProvider?: () => Promise<EthereumProviderLike>;
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

type PrivyHooks = {
  usePrivy: () => {
    ready: boolean;
    authenticated: boolean;
    login: () => void;
    logout: () => void;
    user?: { wallet?: { address?: string } } | null;
  };
  useWallets: () => { wallets: WalletLike[] };
  useCreateWallet: () => {
    createWallet: (options?: { createAdditional?: boolean }) => Promise<WalletLike>;
  };
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
}: {
  onVerified: () => void;
  onLoginRequested?: () => void;
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
    />
  );
}

function PrivyVerifyCardInner({
  hooks,
  onVerified,
  onLoginRequested,
}: {
  hooks: PrivyHooks;
  onVerified: () => void;
  onLoginRequested?: () => void;
}) {
  const { ready, authenticated, login, logout, user } = hooks.usePrivy();
  const { wallets } = hooks.useWallets();
  const { createWallet } = hooks.useCreateWallet();
  const { signMessage } = hooks.useSignMessage();
  const verifyFn = useServerFn(verifyPrivyOwnership);
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
  const [walletCreateState, setWalletCreateState] = useState<
    "idle" | "creating" | "created" | "failed"
  >("idle");
  const [createdWallet, setCreatedWallet] = useState<WalletLike | null>(null);
  const autoVerifiedWalletRef = useRef<string | null>(null);

  const wallet = wallets[0] ?? createdWallet;
  const hasKnownWallet = Boolean(wallets.length > 0 || createdWallet);
  // First-time sign-in state: user is authenticated but the embedded
  // wallet hasn't been provisioned by Privy yet. We surface this as an
  // explicit status step so the modal flow doesn't look frozen.
  const isCreatingWallet = authenticated && !wallet && walletCreateState === "creating";
  const isVerifying = busy;

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
        });
        const message = siwe.prepareMessage();

        let signature: string;
        try {
          const signed = await signMessage(
            { message },
            {
              address,
              uiOptions: {
                showWalletUIs: false,
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
          signature = (await provider.request({
            method: "personal_sign",
            params: [message, address],
          })) as string;
        }

        const result = (await verifyFn({
          data: { message, signature },
        })) as PrivyOwnershipResult;

        if (!result.verified) {
          setError(result.reason ?? "Verification failed.");
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
        onVerified();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.toLowerCase().includes("user rejected")) {
          setError("You declined the signature. Try again to enter.");
        } else if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) {
          setError("Network error reaching Ethereum. Try again in a moment.");
        } else {
          setError(msg || "Something went wrong. Try again.");
        }
      } finally {
        setBusy(false);
      }
    },
    [onVerified, signMessage, verifyFn],
  );

  useEffect(() => {
    if (!authenticated || wallet || hasKnownWallet || walletCreateState !== "idle") {
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setWalletCreateState("failed");
      setError(
        "Privy wallet creation is taking too long. Disconnect and sign in again to start a fresh wallet session.",
      );
    }, 25_000);

    setWalletCreateState("creating");
    setError(null);

    void createWallet({ createAdditional: false })
      .then((newWallet: WalletLike) => {
        window.clearTimeout(timeout);
        if (cancelled) return;
        setCreatedWallet(newWallet);
        setWalletCreateState("created");
      })
      .catch((e: unknown) => {
        window.clearTimeout(timeout);
        if (cancelled) return;
        console.error("Privy embedded wallet creation failed", e);
        const msg = e instanceof Error ? e.message : "";
        setWalletCreateState("failed");
        setError(
          msg || "We couldn't create your embedded wallet. Disconnect and try signing in again.",
        );
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [authenticated, createWallet, hasKnownWallet, wallet, walletCreateState]);

  useEffect(() => {
    if (walletCreateState !== "created" || !createdWallet?.address || busy) return;
    if (autoVerifiedWalletRef.current === createdWallet.address) return;
    autoVerifiedWalletRef.current = createdWallet.address;
    void verifyWallet(createdWallet);
  }, [busy, createdWallet, verifyWallet, walletCreateState]);

  function handleSignAndVerify() {
    void verifyWallet(wallet);
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-5">
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
            // Close any wrapping Radix Dialog first — its focus trap
            // prevents Privy's email input (rendered in a separate portal)
            // from receiving focus, which blocks the iOS/Android keyboard.
            onLoginRequested?.();
            // Defer login one tick so the parent dialog can unmount its
            // focus guard before Privy's modal opens.
            setTimeout(() => login(), 0);
          }}
          className="mt-4 w-full rounded-md border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold hover:bg-gold/20"
        >
          Connect wallet
        </button>
      ) : (
        <div className="mt-4 space-y-2" data-testid="privy-post-login">
          {isCreatingWallet && (
            <div
              data-testid="privy-status-creating-wallet"
              className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="font-semibold text-gold">Step 1 / 2 ·</span> Creating your embedded
              wallet… this is a one-time setup for new emails.
            </div>
          )}
          {wallet && (
            <div
              data-testid="privy-status-wallet-ready"
              className="rounded-md border border-border bg-background/40 px-3 py-2 text-[11px] text-muted-foreground"
              data-wallet-address={wallet.address}
            >
              <div className="font-semibold text-foreground">Embedded wallet ready</div>
              <div className="font-mono">{shortAddress(wallet.address)}</div>
            </div>
          )}
          {wallet && isVerifying && (
            <div
              data-testid="privy-status-verifying"
              className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="font-semibold text-gold">Step 2 / 2 ·</span> Checking BAYC / MAYC
              ownership and delegate.cash vaults for {shortAddress(wallet.address)}…
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
                      className="inline-flex items-center gap-1 text-gold underline hover:opacity-80"
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
            disabled={busy || !wallet}
            className="w-full rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50 hover:opacity-90"
          >
            {isCreatingWallet
              ? "Waiting for wallet…"
              : busy
                ? "Verifying ownership…"
                : "Sign & verify holdings"}
          </button>
          {!wallet && !isCreatingWallet && user?.wallet?.address && (
            <div className="text-[11px] text-muted-foreground font-mono">{user.wallet.address}</div>
          )}
          <button
            onClick={() => logout()}
            className="w-full rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-secondary"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
