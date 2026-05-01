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

/**
 * Entrance modal — single Token Proof flow.
 * One button orchestrates wallet connect → SIWE sign-in → on-chain BAYC check.
 */
export function EntranceDialog({ open, onOpenChange }: EntranceDialogProps) {
  const ready = useWeb3Ready();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl text-gradient-gold">Entrance</DialogTitle>
          <DialogDescription className="font-sans-display">
            Verify BAYC ownership with a single signature. We'll connect your
            wallet, sign you in, and check your tokens on-chain.
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

type Phase = "idle" | "connecting" | "signing" | "verifying" | "done";

function EntranceBody({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { address, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { open: openAppKit } = useAppKit();
  const { isAuthenticated } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");

  const reqNonce = useServerFn(requestNonce);
  const verifySig = useServerFn(verifySignature);
  const verifyBaycFn = useServerFn(verifyBayc);

  const busy = phase !== "idle" && phase !== "done";

  async function handleEnter() {
    try {
      // 1) Connect wallet if needed
      let walletAddress = address;
      if (!isConnected || !walletAddress) {
        setPhase("connecting");
        await openAppKit();
        // Wait briefly for wagmi state to settle
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (window?.localStorage) {
            // re-read by triggering a tick — caller's state will refresh on next render
          }
          break;
        }
        toast.info("Wallet connection requested — tap Enter again once connected.");
        setPhase("idle");
        return;
      }

      // 2) SIWE sign-in if not yet authenticated
      if (!isAuthenticated) {
        setPhase("signing");
        const { message } = await reqNonce({
          data: {
            wallet: walletAddress,
            domain: window.location.host,
            uri: window.location.origin,
          },
        });
        const signature = await signMessageAsync({ message });
        const result = await verifySig({
          data: { wallet: walletAddress, message, signature },
        });
        const { error } = await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        if (error) throw error;
      }

      // 3) Token Proof
      setPhase("verifying");
      const res = await verifyBaycFn({ data: { wallet: walletAddress } });
      if (!res.verified) {
        toast.error(res.error || "No BAYC tokens found in this wallet");
        setPhase("idle");
        return;
      }
      toast.success(`Welcome — ${res.balance} BAYC verified`);
      setPhase("done");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Entrance failed");
      setPhase("idle");
    }
  }

  async function handleDisconnect() {
    await disconnectAsync().catch(() => {});
    await supabase.auth.signOut();
    toast.success("Disconnected");
  }

  const buttonLabel =
    phase === "connecting"
      ? "Connecting wallet…"
      : phase === "signing"
      ? "Sign in your wallet…"
      : phase === "verifying"
      ? "Checking BAYC on-chain…"
      : !isConnected
      ? "Connect Wallet & Verify"
      : !isAuthenticated
      ? "Sign In & Verify"
      : "Run Token Proof";

  return (
    <div className="space-y-4 pt-2">
      <div className="rounded-xl border border-gold/30 bg-gradient-to-br from-gold/10 via-transparent to-accent/5 p-5">
        <div className="font-display text-3xl text-gradient-gold">Token Proof</div>
        <p className="mt-2 text-sm text-muted-foreground font-sans-display">
          On-chain BAYC <code className="font-mono text-xs">balanceOf</code> check.
          Required to enter every area of BAYCMC.
        </p>
        <button
          onClick={handleEnter}
          disabled={busy}
          className="mt-4 w-full rounded-md bg-gradient-gold px-4 py-3 text-sm font-semibold text-gold-foreground shadow-gold transition disabled:opacity-50 hover:opacity-90 font-sans-display"
        >
          {buttonLabel}
        </button>
        {isConnected && address && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground font-mono">
            {address.slice(0, 6)}…{address.slice(-4)}
          </p>
        )}
      </div>

      {isConnected && (
        <button
          onClick={handleDisconnect}
          className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary font-sans-display"
        >
          Disconnect wallet
        </button>
      )}
    </div>
  );
}
