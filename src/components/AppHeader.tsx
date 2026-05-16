import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Lock, Menu, X } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { usePrivyAuthState } from "@/lib/auth/usePrivyBridge";
import { supabase } from "@/integrations/supabase/client";
import { revalidateOwnership } from "@/server/verification.functions";
import { EntranceDialog } from "@/components/EntranceDialog";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { WalletPill } from "@/components/WalletPill";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface NavItem {
  to:
    | "/"
    | "/lobby"
    | "/feed"
    | "/messages"
    | "/rooms"
    | "/ape-rides"
    | "/profile"
    | "/activity"
    | "/lifers"
    | "/lifers/messages";
  label: string;
  tier: "all" | "verified" | "lifer";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/lobby", label: "Lobby", tier: "all" },
  { to: "/feed", label: "Feed", tier: "verified" },
  { to: "/rooms", label: "Conference Rooms", tier: "verified" },
  { to: "/messages", label: "Commons", tier: "verified" },
  { to: "/ape-rides", label: "Ape Rides", tier: "verified" },
  { to: "/lifers", label: "Lifer Lounge", tier: "lifer" },
  { to: "/lifers/messages", label: "Lifer Chat", tier: "lifer" },
  { to: "/activity", label: "My Activity", tier: "all" },
  { to: "/profile", label: "Profile", tier: "all" },
];

// Routes treated as "home" — no back arrow shown here.
const HOME_ROUTES = new Set<string>(["/", "/lobby"]);

export function AppHeader() {
  const { isAuthenticated } = useAuth();
  const { isVerifiedHolder, isLifer } = useVerificationStatus();
  const [entranceOpen, setEntranceOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const router = useRouter();
  const location = useLocation();

  // Hamburger is hidden until the user has at least verified holder status —
  // unverified lobby visitors don't see the gated rooms list at all.
  const showHamburger = isAuthenticated && isVerifiedHolder;
  const showBack = isAuthenticated && !HOME_ROUTES.has(location.pathname);

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
                <SheetContent side="right" className="w-[88vw] max-w-sm border-l border-gold/20 bg-popover p-0">
                  <SheetHeader className="border-b border-border/60 p-5">
                    <SheetTitle className="font-display text-lg text-gradient-gold">
                      Clubhouse
                    </SheetTitle>
                  </SheetHeader>
                  <nav className="flex flex-col p-3">
                    {NAV_ITEMS.filter((item) => {
                      if (item.tier === "all") return true;
                      if (item.tier === "verified") return isVerifiedHolder;
                      if (item.tier === "lifer") return isLifer;
                      return false;
                    }).map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setNavOpen(false)}
                        className={`flex items-center justify-between rounded-md px-3 py-3 text-sm font-medium transition hover:bg-secondary/60 ${
                          item.tier === "lifer" ? "text-gold" : "text-foreground"
                        }`}
                      >
                        <span>{item.label}</span>
                        {item.tier === "lifer" && (
                          <span className="rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                            Lifer
                          </span>
                        )}
                      </Link>
                    ))}
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
  const {
    isVerifiedHolder,
    collection,
    loading: verifLoading,
    refresh: refreshVerification,
  } = useVerificationStatus();
  const privy = usePrivyAuthState();
  const recheck = useServerFn(revalidateOwnership);
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [recheckBusy, setRecheckBusy] = useState(false);
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

  // Real on-chain re-check for the wallet already linked to this profile.
  // Doesn't re-open Privy; just hits `revalidateOwnership` which runs a
  // fresh balanceOf + delegate.cash lookup, persists the result, and we
  // tell the user exactly what came back.
  async function runRecheck() {
    if (recheckBusy) return;
    setRecheckBusy(true);
    const toastId = "recheck-ownership";
    toast.loading("Checking BAYC / MAYC ownership on-chain…", {
      id: toastId,
      position: "top-center",
    });
    try {
      const snap = await recheck();
      if (snap.tokenProof) {
        toast.success(
          snap.delegationVault
            ? `Verified — ${snap.collection} via delegate.cash vault ${snap.delegationVault.slice(0, 6)}…${snap.delegationVault.slice(-4)}.`
            : `Verified — ${snap.collection} ownership confirmed.`,
          { id: toastId, duration: 5000 },
        );
      } else {
        toast.message("No BAYC/MAYC found yet", {
          id: toastId,
          description:
            snap.reason === "rpc-unavailable-prior-state-preserved"
              ? "Ethereum RPC was unreachable — we kept your previous status. Try again in a moment."
              : "Neither this wallet nor any delegate.cash vault holds a BAYC/MAYC right now.",
          duration: 7000,
        });
      }
      await refreshVerification();
      void router.navigate({ to: "/lobby" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't run the ownership check.", {
        id: toastId,
        duration: 7000,
      });
      void router.navigate({ to: "/lobby" });
    } finally {
      setRecheckBusy(false);
    }
  }

  if (isAuthenticated) {
    if (walletAddress) {
      // Single control that swaps state:
      //   • Not verified  → "Verify" button (icon + label). Clicking it
      //     runs a fresh on-chain check of the linked wallet — no Privy
      //     re-prompt, since the user is already signed in.
      //   • Verified      → sliced wallet pill (with the collection badge).
      if (!verifLoading && !isVerifiedHolder) {
        return (
          <button
            type="button"
            disabled={recheckBusy || verifying}
            onClick={() => void runRecheck()}
            title="Check on-chain BAYC/MAYC ownership"
            aria-label="Verify holder access"
            className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70 sm:text-sm"
          >
            {recheckBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            {recheckBusy ? "Checking…" : verifying ? "Verifying…" : "Verify"}
          </button>
        );
      }
      return (
        <WalletPill
          address={walletAddress}
          collection={isVerifiedHolder ? collection ?? null : null}
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
    return (
      <button
        type="button"
        disabled={verifying}
        onClick={() => {
          window.dispatchEvent(new Event("baycmc:privy-bridge-retry"));
        }}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-2 py-2 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70 sm:gap-2 sm:px-3 sm:text-sm"
        title={privy.address}
        aria-label={`Click to verify ${privy.address}`}
      >
        <Lock className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">
          {verifying ? "Verifying…" : "Click to verify"}
        </span>
        <span className="font-mono text-[10px] text-gold/70 sm:text-xs">
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
      className="shrink-0 cursor-pointer rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70 sm:px-4 sm:text-sm"
    >
      {isBooting ? "Loading…" : "Entrance"}
    </button>
  );
}

// Suppress unused-import warning when X isn't directly referenced; the
// shadcn Sheet component uses it via its own close button.
void X;
