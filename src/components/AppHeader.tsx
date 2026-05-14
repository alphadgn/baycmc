import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { supabase } from "@/integrations/supabase/client";
import { EntranceDialog } from "@/components/EntranceDialog";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { WalletPill } from "@/components/WalletPill";
import {
  onVerifiedSessionChange,
  readVerifiedSession,
  writeVerifiedSession,
} from "@/lib/baycmc/verifiedSession";

export function AppHeader() {
  const { isAuthenticated } = useAuth();
  const [entranceOpen, setEntranceOpen] = useState(false);
  const { isLifer } = useVerificationStatus();

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
            {isAuthenticated && (
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
                <Link to="/profile" className="cursor-pointer text-muted-foreground hover:text-foreground transition">
                  Profile
                </Link>
              </>
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
  const { tokenProof, collection, loading: verifLoading } = useVerificationStatus();
  const [cachedSession, setCachedSession] = useState(() => readVerifiedSession());
  const [walletAddress, setWalletAddress] = useState<string | null>(() => cachedSession?.address ?? null);

  useEffect(
    () => onVerifiedSessionChange(() => setCachedSession(readVerifiedSession())),
    [],
  );

  // Load wallet address from profile once authenticated.
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setWalletAddress(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("wallet_address")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setWalletAddress(data?.wallet_address ?? readVerifiedSession()?.address ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  // Persist verified session to localStorage when DB confirms verification.
  useEffect(() => {
    if (tokenProof && walletAddress) {
      writeVerifiedSession({
        address: walletAddress,
        collection: collection ?? null,
        verifiedAt: Date.now(),
        signature: readVerifiedSession()?.signature ?? "server-verified",
      });
    }
  }, [tokenProof, walletAddress, collection]);

  // Show the pill if either the live state is verified, OR the cached
  // session is fresh and matches the connected wallet (avoids button flash).
  const showPill =
    walletAddress &&
    (tokenProof ||
      (cachedSession &&
        cachedSession.address.toLowerCase() === walletAddress.toLowerCase()));

  if (showPill && walletAddress) {
    return (
      <WalletPill
        address={walletAddress}
        collection={collection ?? cachedSession?.collection ?? null}
      />
    );
  }

  // Hide button briefly while still loading auth/verification to avoid flash.
  if (authLoading || (isAuthenticated && verifLoading)) {
    return <div className="h-9 w-24" aria-hidden />;
  }

  return (
    <button
      onClick={onOpen}
      className="cursor-pointer rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
    >
      Entrance
    </button>
  );
}
