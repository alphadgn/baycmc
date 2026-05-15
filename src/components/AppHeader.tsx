import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
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

function EntranceControls({ onOpen }: { onOpen: () => void }) {
  const { isAuthenticated, user, loading: authLoading } = useAuth();
  const { isVerifiedHolder, collection, loading: verifLoading } = useVerificationStatus();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

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

  // Tier 1 (Lobby): show "Verify holder access" CTA next to the wallet pill.
  // Tier 2/3: WalletPill alone (with verified collection badge).
  if (isAuthenticated) {
    if (walletAddress) {
      return (
        <div className="flex items-center gap-2">
          {!verifLoading && !isVerifiedHolder && (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/20"
            >
              <Lock className="h-3 w-3" />
              Verify holder access
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
        onClick={() => {
          window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
          onOpen();
        }}
        className="cursor-pointer rounded-md border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition hover:bg-gold/20"
      >
        Finish sign-in
      </button>
    );
  }

  if (authLoading) return <div className="h-9 w-24" aria-hidden />;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="cursor-pointer rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
    >
      Entrance
    </button>
  );
}
