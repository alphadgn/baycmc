import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { useAuth, signOut } from "@/lib/auth/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { requestNonce, verifySignature } from "@/server/siwe.functions";
import { useWeb3Ready } from "@/components/Web3Provider";
import { toast } from "sonner";

export function AppHeader() {
  const { isAuthenticated } = useAuth();
  const ready = useWeb3Ready();

  return (
    <header className="sticky top-0 z-50 glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-gradient-gold shadow-gold" />
          <span className="font-display text-lg font-bold tracking-tight">
            The <span className="text-gradient-gold">Clubhouse</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          <Link to="/" className="text-muted-foreground hover:text-foreground transition">
            Home
          </Link>
          {isAuthenticated && (
            <Link to="/profile" className="text-muted-foreground hover:text-foreground transition">
              Profile
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {ready ? <WalletControls /> : <WalletPlaceholder />}
        </div>
      </div>
    </header>
  );
}

function WalletPlaceholder() {
  return <div className="h-9 w-32 animate-pulse rounded-md bg-secondary/40" aria-hidden />;
}

function WalletControls() {
  const { address, isConnected } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { open } = useAppKit();
  const { isAuthenticated } = useAuth();
  const [signing, setSigning] = useState(false);

  const reqNonce = useServerFn(requestNonce);
  const verifySig = useServerFn(verifySignature);

  async function handleSignIn() {
    if (!address) return;
    setSigning(true);
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
      toast.success("Signed in to The Clubhouse");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sign-in failed";
      toast.error(msg);
    } finally {
      setSigning(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    await disconnectAsync().catch(() => {});
    toast.success("Signed out");
  }

  if (!isConnected) {
    return (
      <button
        onClick={() => open()}
        className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
      >
        Connect Wallet
      </button>
    );
  }
  if (!isAuthenticated) {
    return (
      <button
        onClick={handleSignIn}
        disabled={signing}
        className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:opacity-50"
      >
        {signing ? "Signing…" : "Sign In"}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {address?.slice(0, 6)}…{address?.slice(-4)}
      </span>
      <button
        onClick={handleSignOut}
        className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm hover:bg-secondary"
      >
        Sign out
      </button>
    </div>
  );
}
