import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Wallet } from "lucide-react";
import { SiweMessage } from "siwe";
import { supabase } from "@/integrations/supabase/client";
import { verifyPrivyOwnership } from "@/server/privy.functions";
import { toast } from "sonner";

/**
 * Privy verification card. The Privy SDK touches `window`/`localStorage` at
 * module-evaluation time and crashes the Worker SSR runtime, so we
 * dynamic-import its hooks inside an effect and render a skeleton until
 * they're available. This component must NOT statically import
 * `@privy-io/react-auth` anywhere reachable from SSR.
 */
export function PrivyVerifyCard({ onVerified }: { onVerified: () => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [hooks, setHooks] = useState<{ usePrivy: any; useWallets: any } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("@privy-io/react-auth");
        if (cancelled) return;
        setHooks({ usePrivy: mod.usePrivy, useWallets: mod.useWallets });
      } catch {
        // Privy not available — leave the card in its loading shell.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!hooks) {
    return (
      <div className="rounded-xl border border-border bg-secondary/20 p-5">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gold" />
          <div className="text-lg font-semibold">Connect a wallet</div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Or connect any EVM wallet via Privy. We'll verify BAYC/MAYC ownership
          on-chain — no Tokenproof required.
        </p>
        <div className="mt-4 h-10 animate-pulse rounded-md bg-muted/30" />
      </div>
    );
  }

  return <PrivyVerifyCardInner hooks={hooks} onVerified={onVerified} />;
}

function PrivyVerifyCardInner({
  hooks,
  onVerified,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hooks: { usePrivy: any; useWallets: any };
  onVerified: () => void;
}) {
  const { ready, authenticated, login, logout, user } = hooks.usePrivy();
  const { wallets } = hooks.useWallets();
  const verifyFn = useServerFn(verifyPrivyOwnership);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wallet = wallets[0];

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

      toast.success(`Verified — ${result.collection} ownership confirmed`);
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
        <div className="text-lg font-semibold">Connect a wallet</div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Or connect any EVM wallet via Privy. We'll verify BAYC/MAYC ownership
        on-chain — no Tokenproof required.
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
          onClick={() => login()}
          className="mt-4 w-full rounded-md border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold hover:bg-gold/20"
        >
          Connect wallet
        </button>
      ) : (
        <div className="mt-4 space-y-2">
          <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-[11px] font-mono text-muted-foreground">
            {wallet?.address
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : (user?.wallet?.address ?? "No wallet")}
          </div>
          <button
            onClick={handleSignAndVerify}
            disabled={busy || !wallet}
            className="w-full rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50 hover:opacity-90"
          >
            {busy ? "Verifying ownership…" : "Sign & verify holdings"}
          </button>
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
