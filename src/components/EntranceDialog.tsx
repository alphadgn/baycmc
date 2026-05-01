import { useState } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { requestNonce, verifySignature } from "@/server/siwe.functions";
import { verifyBayc } from "@/server/verification.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useWeb3Ready } from "@/components/Web3Provider";

interface EntranceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "choose" | "wallet" | "siwe" | "tokenproof";

/**
 * Entrance modal — chooser for the two sign-in / verification options.
 * Wagmi hooks must NOT run until WagmiProvider has mounted on the client,
 * so the body that uses them is split into a child component gated on
 * `useWeb3Ready()`.
 */
export function EntranceDialog({ open, onOpenChange }: EntranceDialogProps) {
  const ready = useWeb3Ready();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Entrance</DialogTitle>
          <DialogDescription>
            Pick a verification option. Wallet sign-in opens the main areas; Token Proof
            confirms BAYC ownership for gated access.
          </DialogDescription>
        </DialogHeader>
        {ready ? (
          <EntranceBody onOpenChange={onOpenChange} />
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Initializing wallet provider…
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntranceBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<Step>("choose");
  const { address, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { open: openAppKit } = useAppKit();
  const { isAuthenticated, user } = useAuth();
  const [busy, setBusy] = useState(false);

  const reqNonce = useServerFn(requestNonce);
  const verifySig = useServerFn(verifySignature);
  const verifyBaycFn = useServerFn(verifyBayc);

  async function handleConnectWallet() {
    setStep("wallet");
    await openAppKit();
  }

  async function handleSiwe() {
    if (!isConnected || !address) {
      toast.error("Connect your wallet first");
      return;
    }
    setStep("siwe");
    setBusy(true);
    try {
      const { message } = await reqNonce({
        data: {
          wallet: address,
          domain: window.location.host,
          uri: window.location.origin,
        },
      });
      const signature = await signMessageAsync({ message });
      const result = await verifySig({
        data: { wallet: address, message, signature },
      });
      const { error } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (error) throw error;
      toast.success("Signed in to BAYCMC");
      setStep("choose");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  }

  async function handleTokenProof() {
    if (!isAuthenticated || !user) {
      toast.error("Sign in first to run Token Proof");
      return;
    }
    if (!address) {
      toast.error("Connect your wallet");
      return;
    }
    setStep("tokenproof");
    setBusy(true);
    try {
      const res = await verifyBaycFn({ data: { wallet: address } });
      if (res.verified) {
        toast.success(`Token Proof verified — ${res.balance} BAYC`);
        onOpenChange(false);
      } else {
        toast.error(res.error || "No BAYC found in this wallet");
      }
      setStep("choose");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Token Proof failed");
      setStep("choose");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    await disconnectAsync().catch(() => {});
    toast.success("Wallet disconnected");
  }

  return (
    <div className="space-y-3 pt-2">
      <EntranceOption
        n="01"
        title={isConnected ? `Wallet connected · ${address?.slice(0, 6)}…${address?.slice(-4)}` : "Connect Wallet"}
        description="Use any supported wallet via Reown AppKit."
        cta={isConnected ? "Reopen" : "Connect"}
        onClick={handleConnectWallet}
        done={isConnected}
        disabled={busy}
      />
      <EntranceOption
        n="02"
        title="Sign In (SIWE)"
        description="Prove wallet ownership with a single off-chain signature."
        cta={isAuthenticated ? "Signed in ✓" : busy && step === "siwe" ? "Signing…" : "Sign"}
        onClick={handleSiwe}
        done={isAuthenticated}
        disabled={busy || !isConnected || isAuthenticated}
      />
      <EntranceOption
        n="03"
        title="Token Proof"
        description="On-chain BAYC balanceOf check. Required for main areas."
        cta={busy && step === "tokenproof" ? "Checking…" : "Verify"}
        onClick={handleTokenProof}
        disabled={busy || !isAuthenticated}
      />

      {isConnected && (
        <button
          onClick={handleDisconnect}
          className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary"
        >
          Disconnect wallet
        </button>
      )}
    </div>
  );
}

function EntranceOption({
  n,
  title,
  description,
  cta,
  onClick,
  done,
  disabled,
}: {
  n: string;
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  done?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 transition ${
        done
          ? "border-success/40 bg-success/5"
          : "border-border bg-secondary/20 hover:border-gold/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="font-display text-[10px] tracking-widest text-gold">{n}</div>
          <h4 className="mt-1 font-display text-sm font-semibold">{title}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <button
          onClick={onClick}
          disabled={disabled}
          className="rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground shadow-gold disabled:opacity-50"
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
