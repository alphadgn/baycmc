import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Menu, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { usePrivyAuthState } from "@/lib/auth/usePrivyBridge";
import { supabase } from "@/integrations/supabase/client";
import { EntranceDialog } from "@/components/EntranceDialog";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { WalletPill } from "@/components/WalletPill";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

interface NavItem {
  to:
    | "/"
    | "/lobby"
    | "/feed"
    | "/rooms"
    | "/ape-rides"
    | "/profile"
    | "/activity"
    | "/lifers"
    | "/lifers/messages"
    | "/admin"
    | "/super-admin";
  label: string;
  tier: "all" | "verified" | "lifer" | "admin" | "super_admin";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/lobby", label: "Lobby", tier: "all" },
  { to: "/feed", label: "Feed", tier: "verified" },
  { to: "/rooms", label: "Conference Rooms", tier: "verified" },
  { to: "/ape-rides", label: "Ape Rides", tier: "verified" },
  { to: "/lifers/messages", label: "Lifer Chat", tier: "lifer" },
  { to: "/activity", label: "My Activity", tier: "all" },
  { to: "/profile", label: "Profile", tier: "all" },
  { to: "/admin", label: "Administrator", tier: "admin" },
  { to: "/super-admin", label: "Super Admin", tier: "super_admin" },
];

// Routes treated as "home" — no back arrow shown here.
const HOME_ROUTES = new Set<string>(["/", "/lobby"]);

export function AppHeader() {
  const { isAuthenticated, user } = useAuth();
  const { isVerifiedHolder, isLifer } = useVerificationStatus();
  const [entranceOpen, setEntranceOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  // pendingGatedRoute removed: gated nav entries are now hidden entirely
  // until verification completes, so there's no in-menu retry flow.

  const router = useRouter();
  const location = useLocation();

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setIsSuperAdmin(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      if (cancelled) return;
      const roles = (data ?? []).map((r) => r.role);
      setIsSuperAdmin(roles.includes("super_admin"));
      setIsAdmin(roles.includes("admin") || roles.includes("super_admin"));
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Show the hamburger to every authenticated user — lobby visitors get to
  // browse the full clubhouse menu and see exactly what unlocks once they
  // verify a BAYC/MAYC. Gated items render with a lock icon and pop the
  // Privy signing modal on click.
  const showHamburger = isAuthenticated;
  const showBack = isAuthenticated && !HOME_ROUTES.has(location.pathname);

  // The /rooms* and /calendar routes ship their own app-shell (sidebar +
  // top welcome strip + right rail + bottom bar) that matches the conf.png
  // mockup, so the global hamburger header would double up. Suppress it
  // there — the RoomsShell sidebar already covers navigation + sign-out.
  const usesRoomsShell =
    location.pathname === "/rooms" ||
    location.pathname.startsWith("/rooms/") ||
    location.pathname === "/calendar";
  if (usesRoomsShell) return null;

  return (
    <>
      <header className="sticky top-0 z-50 glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
          <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-3">
            {showBack && (
              <button
                type="button"
                onClick={() => {
                  // history.back if there's something to go back to inside
                  // this app; otherwise route to the lobby (the tier-1 home).
                  if (window.history.length > 1) {
                    router.history.back();
                  } else {
                    void router.navigate({ to: "/lobby" });
                  }
                }}
                aria-label="Go back"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <Link
              to="/"
              aria-label="BAYCMC"
              className="inline-flex min-w-0 shrink cursor-pointer items-center"
            >
              <EmbroideredImage
                variant="baycmc"
                size="lg"
                alt="BAYCmc"
                clamp="clamp(1.4rem, 5vw, 3rem)"
              />
            </Link>
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <EntranceControls onOpen={() => setEntranceOpen(true)} />
            {showHamburger && (
              <Sheet open={navOpen} onOpenChange={setNavOpen}>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    aria-label="Open navigation"
                    className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-secondary/40 text-foreground transition hover:bg-secondary"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="right"
                  className="w-[88vw] max-w-sm border-l border-gold/20 bg-popover p-0"
                >
                  <SheetHeader className="border-b border-border/60 p-5">
                    <SheetTitle className="font-display text-lg text-gradient-gold">
                      Clubhouse
                    </SheetTitle>
                  </SheetHeader>
                  <nav className="flex flex-col p-3">
                    {NAV_ITEMS.filter((item) => {
                      // Hide gated items entirely from users without access.
                      if (item.tier === "verified") return isVerifiedHolder;
                      if (item.tier === "lifer") return isLifer;
                      if (item.tier === "super_admin") return isSuperAdmin;
                      if (item.tier === "admin") return isAdmin;
                      return true;
                    }).map((item) => {
                      const isAdminTier = item.tier === "admin" || item.tier === "super_admin";
                      const sharedClass = `flex items-center justify-between rounded-md px-3 py-3 text-sm font-medium transition hover:bg-secondary/60 ${
                        item.tier === "lifer" || isAdminTier ? "text-gold" : "text-foreground"
                      }`;
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setNavOpen(false)}
                          className={sharedClass}
                        >
                          <span>{item.label}</span>
                          {item.tier === "lifer" && (
                            <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                              Lifer
                            </span>
                          )}
                          {isAdminTier && (
                            <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                              {item.tier === "super_admin" ? "Super" : "Admin"}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </nav>
                  <div className="border-t border-border/60 p-3 text-[11px] text-muted-foreground">
                    {isLifer
                      ? "Lifer access — every door is open."
                      : isVerifiedHolder
                        ? "Verified holder access."
                        : ""}
                  </div>
                </SheetContent>
              </Sheet>
            )}
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

  useEffect(() => {
    if (!clicked) return;
    if (privy.ready) return;
    const t = window.setTimeout(() => {
      toast.error("Wallet sign-in didn't load.", {
        description: "Check that PRIVY_APP_ID is set in .env and the dev server was restarted.",
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

  // Re-verification (lobby → holder): hands off to the Privy bridge,
  // which pops a fresh SIWE signature and re-runs the on-chain check.
  // The bridge dispatches "baycmc:verification-refresh" on success so
  // useVerificationStatus reloads — no manual refresh needed here.
  function requestReverify() {
    window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
  }

  if (isAuthenticated) {
    if (walletAddress) {
      // Always render the sliced-address pill once authenticated. Lobby
      // users (Tier 1) get a "Verify holder access" action inside the
      // pill's dropdown which triggers a fresh signature + on-chain check.
      return (
        <WalletPill
          address={walletAddress}
          collection={isVerifiedHolder ? (collection ?? null) : null}
          isVerifiedHolder={isVerifiedHolder}
          onVerify={requestReverify}
          verifying={verifying || verifLoading}
        />
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
        className="shrink-0 cursor-pointer rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70 sm:text-sm"
      >
        {verifying ? "Verifying…" : "Finish sign-in"}
      </button>
    );
  }

  if (authLoading) return <div className="h-9 w-24" aria-hidden />;

  if (privy.authenticated && privy.address) {
    // Privy connected; the bridge auto-pops SIWE now, so we don't need a
    // standalone "Verify" CTA here. Render the calm sliced-address pill —
    // matches the look users see in the lobby. The whole pill stays
    // clickable so a user who rejected the Privy signing modal can retry.
    return (
      <button
        type="button"
        disabled={verifying}
        onClick={() => {
          window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
        }}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-gold/30 bg-secondary/40 px-2.5 pr-3 font-mono text-xs text-foreground transition hover:border-gold/60 hover:bg-secondary/70 disabled:cursor-wait disabled:opacity-70"
        title={verifying ? "Signing in…" : privy.address}
        aria-label={`Wallet ${privy.address}${verifying ? " — signing in" : ""}`}
      >
        {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gold/70" /> : null}
        <span className="tabular-nums">{sliceAddress(privy.address)}</span>
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
      className="shrink-0 cursor-pointer rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70 sm:px-4 sm:text-sm"
    >
      {isBooting ? "Loading…" : "Entrance"}
    </button>
  );
}

// Suppress unused-import warning when X isn't directly referenced; the
// shadcn Sheet component uses it via its own close button.
void X;
