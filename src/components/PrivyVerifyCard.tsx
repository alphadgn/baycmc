import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Wallet } from "lucide-react";
import { SiweMessage } from "siwe";
import { supabase } from "@/integrations/supabase/client";
import {
  verifyPrivyOwnership,
  getPrivyPublicConfig,
} from "@/server/privy.functions";
import { toast } from "sonner";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hooks, setHooks] = useState<{ usePrivy: any; useWallets: any } | null>(
    null,
  );
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
        const valid =
          id.length >= 20 &&
          id.length <= 40 &&
          /^[a-z0-9]+$/i.test(id);
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
        <p className="mt-1 text-sm text-muted-foreground">
          Secure connection options.
        </p>
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: { usePrivy: any; useWallets: any; useCreateWallet: any };
  onVerified: () => void;
  onLoginRequested?: () => void;
}) {
  const { ready, authenticated, login, logout, user } = hooks.usePrivy();
  const { wallets } = hooks.useWallets();
  const { createWallet } = hooks.useCreateWallet();
  const verifyFn = useServerFn(verifyPrivyOwnership);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [walletCreateState, setWalletCreateState] = useState<
    "idle" | "creating" | "failed"
  >("idle");

  const wallet = wallets[0];
  const hasLinkedWallet = Boolean(user?.wallet?.address || wallets.length > 0);
  // First-time sign-in state: user is authenticated but the embedded
  // wallet hasn't been provisioned by Privy yet. We surface this as an
  // explicit status step so the modal flow doesn't look frozen.
  const isCreatingWallet = authenticated && !wallet && walletCreateState !== "failed";
  const isVerifying = busy;

  useEffect(() => {
    if (!authenticated || wallet || hasLinkedWallet || walletCreateState !== "idle") {
      return;
    }

    let cancelled = false;
    setWalletCreateState("creating");
    setError(null);

    void createWallet()
      .then(() => {
        if (!cancelled) setWalletCreateState("idle");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("Privy embedded wallet creation failed", e);
        const msg = e instanceof Error ? e.message : "";
        setWalletCreateState("failed");
        setError(
          msg ||
            "We couldn't create your embedded wallet. Disconnect and try signing in again.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated, createWallet, hasLinkedWallet, wallet, walletCreateState]);

  async function handleSignAndVerify() {
    if (!wallet) {
      setError("No wallet detected. Reconnect from the Privy modal.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const provider = await wallet.getEthereumProvider();
      const address = wallet.address;
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

      const signature = (await provider.request({
        method: "personal_sign",
        params: [message, address],
      })) as string;

      const result = await verifyFn({ data: { message, signature } });

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

      toast.success(
        result.delegatedFrom
          ? `Verified — ${result.collection} delegated from ${result.delegatedFrom.slice(0, 6)}…${result.delegatedFrom.slice(-4)}`
          : `Verified — ${result.collection} ownership confirmed`,
      );
      onVerified();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.toLowerCase().includes("user rejected")) {
        setError("You declined the signature. Try again to enter.");
      } else if (
        msg.toLowerCase().includes("network") ||
        msg.toLowerCase().includes("fetch")
      ) {
        setError("Network error reaching Ethereum. Try again in a moment.");
      } else {
        setError(msg || "Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-5">
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-gold" />
        <div className="text-lg font-semibold">Privy</div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Secure connection options.
      </p>

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
              <span className="font-semibold text-gold">Step 1 / 2 ·</span>{" "}
              Creating your embedded wallet… this is a one-time setup for new
              emails.
            </div>
          )}
          {wallet && (
            <div
              data-testid="privy-status-wallet-ready"
              className="rounded-md border border-border bg-background/40 px-3 py-2 text-[11px] font-mono text-muted-foreground"
              data-wallet-address={wallet.address}
            >
              {`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}
            </div>
          )}
          {wallet && isVerifying && (
            <div
              data-testid="privy-status-verifying"
              className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="font-semibold text-gold">Step 2 / 2 ·</span>{" "}
              Checking BAYC / MAYC ownership and delegate.cash vaults for{" "}
              {`${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`}…
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
            <div className="text-[11px] text-muted-foreground font-mono">
              {user.wallet.address}
            </div>
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
