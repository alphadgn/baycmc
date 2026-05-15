import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { usePrivyAuthState } from "@/lib/auth/usePrivyBridge";
import { supabase } from "@/integrations/supabase/client";
import { EntranceDialog } from "@/components/EntranceDialog";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { WalletPill } from "@/components/WalletPill";

export function AppHeader() {
  const { isAuthenticated } = useAuth();
  const [entranceOpen, setEntranceOpen] = useState(false);
  const { isVerifiedHolder, isLifer } = useVerificationStatus();

  return (
    <>
      <header className="sticky top-0 z-50 glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="BAYCMC" className="inline-flex min-w-0 cursor-pointer items-center">
            <EmbroideredImage
              variant="baycmc"
              size="lg"
              alt="BAYCmc"
              clamp="clamp(1.67rem, 6vw, 3.33rem)"
            />
          </Link>

          <nav className="hidden items-center gap-5 text-sm md:flex font-sans-display">
            <Link to="/" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
              Home
            </Link>
            {isAuthenticated && !isVerifiedHolder && (
              <Link to="/lobby" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
                Lobby
              </Link>
            )}
            {isAuthenticated && isVerifiedHolder && (
              <>
                <Link to="/feed" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
                  Feed
                </Link>
                <Link to="/messages" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
                  Messages
                </Link>
                <Link to="/rooms" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
                  Rooms
                </Link>
                <Link to="/ape-rides" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
                  Ape Rides
                </Link>
              </>
            )}
            {isAuthenticated && (
              <Link to="/profile" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
                Profile
              </Link>
            )}
            {isLifer && (
              <>
                <Link
                  to="/lifers"
                  className="cursor-pointer text-gold hover:text-gold/80 transition font-semibold"
                >
                  Lifers
                </Link>
                <Link
                  to="/lifers/messages"
                  className="cursor-pointer text-gold hover:text-gold/80 transition font-semibold"
                >
                  Lifer Chat
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center gap-2">
            <EntranceControls onOpen={() => setEntranceOpen(true)} />
          </div>
        </div>
      </header>

      <EntranceDialog open={entranceOpen} onOpenChange={setEntranceOpen} />
    </>
  );
}

function sliceAddress(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function EntranceControls({ onOpen }: { onOpen: () => void }) {
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const { isVerifiedHolder, collection, loading: verifLoading } = useVerificationStatus();
  const privy = usePrivyAuthState();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [clicked, setClicked] = useState(false);
  const isBooting = clicked && !privy.ready;

  useEffect(() => {
    if (privy.ready) setClicked(false);
  }, [privy.ready]);

  // If Privy never finishes booting within 8s of a click, surface the
  // problem instead of spinning the button forever. Most common cause is
  // a missing/invalid PRIVY_APP_ID in .env.
  useEffect(() => {
    if (!clicked) return;
    if (privy.ready) return;
    const t = window.setTimeout(() => {
      toast.error("Wallet sign-in didn't load.", {
        description:
          "Check that PRIVY_APP_ID is set in .env and the dev server was restarted.",
        duration: 8000,
      });
      setClicked(false);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [clicked, privy.ready]);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setWalletAddress(null);
      setProfileLoaded(false);
      return;
    }
    let cancelled = false;
    setProfileLoaded(false);
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("wallet_address")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setWalletAddress(data?.wallet_address ?? null);
      setProfileLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  const verifying = privy.verifying;

  // Authenticated to Supabase: show wallet pill (and optional verify CTA
  // for Tier-1 lobby users).
  if (isAuthenticated) {
    if (walletAddress) {
      return (
        <div className="flex items-center gap-2">
          {!verifLoading && !isVerifiedHolder && (
            <button
              type="button"
              disabled={verifying}
              onClick={() => {
                window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70"
            >
              <Lock className="h-3 w-3" />
              {verifying ? "Verifying…" : "Verify holder access"}
            </button>
          )}
          <WalletPill
            address={walletAddress}
            collection={isVerifiedHolder ? collection ?? null : null}
          />
        </div>
      );
    }
    if (!profileLoaded || verifLoading) return <div className="h-9 w-24" aria-hidden />;
    return (
      <button
        type="button"
        disabled={verifying}
        onClick={() => {
          window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
          onOpen();
        }}
        className="cursor-pointer rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70"
      >
        {verifying ? "Verifying…" : "Finish sign-in"}
      </button>
    );
  }

  if (authLoading) return <div className="h-9 w-24" aria-hidden />;

  // Privy wallet is connected but the user hasn't completed the SIWE
  // signature yet → show "Click to verify". This replaces the old
  // auto-popping signature modal that was distorting the rest of the UI.
  if (privy.authenticated && privy.address) {
    return (
      <button
        type="button"
        disabled={verifying}
        onClick={() => {
          window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
        }}
        className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70"
        title={privy.address}
      >
        <Lock className="h-3.5 w-3.5" />
        {verifying ? "Verifying…" : "Click to verify"}
        <span className="font-mono text-xs text-gold/70">
          {sliceAddress(privy.address)}
        </span>
      </button>
    );
  }


  return (
    <button
      type="button"
      disabled={isBooting}
      onClick={() => {
        setClicked(true);
        onOpen();
      }}
      className="cursor-pointer rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
    >
      {isBooting ? "Loading sign-in…" : "Entrance"}
    </button>
  );
}
