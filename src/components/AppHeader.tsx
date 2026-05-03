import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useDisconnect } from "wagmi";
import { useAuth, signOut } from "@/lib/auth/useAuth";
import { useWeb3Ready } from "@/components/Web3Provider";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { EntranceDialog } from "@/components/EntranceDialog";
import { toast } from "sonner";


export function AppHeader() {
  const { isAuthenticated } = useAuth();
  const ready = useWeb3Ready();
  const [entranceOpen, setEntranceOpen] = useState(false);
  const { isLifer } = useVerificationStatus();

  return (
    <>
      <header className="sticky top-0 z-50 glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-gradient-gold"
          >
            BAYCMC
          </Link>

          <nav className="hidden items-center gap-5 text-sm md:flex font-sans-display">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition">
              Home
            </Link>
            {isAuthenticated && (
              <>
                <Link to="/feed" className="text-muted-foreground hover:text-foreground transition">
                  Feed
                </Link>
                <Link to="/messages" className="text-muted-foreground hover:text-foreground transition">
                  Messages
                </Link>
                <Link to="/rooms" className="text-muted-foreground hover:text-foreground transition">
                  Rooms
                </Link>
                <Link to="/ape-rides" className="text-muted-foreground hover:text-foreground transition">
                  Ape Rides
                </Link>
                <Link to="/profile" className="text-muted-foreground hover:text-foreground transition">
                  Profile
                </Link>
              </>
            )}
            {/* Lifer-only links — completely invisible to non-Lifers. */}
            {isLifer && (
              <>
                <Link
                  to="/lifers"
                  className="text-gold hover:text-gold/80 transition font-semibold"
                >
                  Lifers
                </Link>
                <Link
                  to="/lifers/messages"
                  className="text-gold hover:text-gold/80 transition font-semibold"
                >
                  Lifer Chat
                </Link>
              </>
            )}
          </nav>

          <div className="flex items-center gap-2">
            {ready ? (
              <EntranceControls
                onOpen={() => setEntranceOpen(true)}
              />
            ) : (
              <div className="h-9 w-32 animate-pulse rounded-md bg-secondary/40" aria-hidden />
            )}
          </div>
        </div>
      </header>

      <EntranceDialog open={entranceOpen} onOpenChange={setEntranceOpen} />
    </>
  );
}

function EntranceControls({ onOpen }: { onOpen: () => void }) {
  const { isAuthenticated, user } = useAuth();
  const { disconnectAsync } = useDisconnect();

  async function handleSignOut() {
    await signOut();
    await disconnectAsync().catch(() => {});
    toast.success("Signed out");
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={onOpen}
        className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
      >
        Entrance
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onOpen}
        className="hidden rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold hover:bg-gold/20 sm:inline-block"
      >
        Verify
      </button>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
        {user?.email ?? "member"}
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
