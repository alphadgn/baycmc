import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Menu, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { useGlyphAuthState } from "@/lib/auth/useGlyphBridge";
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
    | "/karaoke"
    | "/profile"
    | "/activity"
    | "/lifers"
    | "/lifers/messages"
    | "/support"
    | "/admin"
    | "/super-admin";
  label: string;
  // "lobby_only" = visible only to signed-in users who are NOT verified
  // holders. Holders already reach the karaoke room from the Conference
  // Rooms hall (it lives there as a karaoke-kind tile), so a duplicate
  // top-level entry would be redundant for them. Lobby visitors still
  // need a direct way in since Conference Rooms is gated.
  tier: "all" | "lobby_only" | "verified" | "lifer" | "admin" | "super_admin";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/lobby", label: "Public Lobby", tier: "all" },
  { to: "/feed", label: "Holders Chat", tier: "verified" },
  { to: "/rooms", label: "Conference Rooms", tier: "verified" },
  { to: "/ape-rides", label: "Ape Rides", tier: "verified" },
  { to: "/lifers/messages", label: "Lifer Chat", tier: "lifer" },
  { to: "/karaoke", label: "Karaoke Room", tier: "lobby_only" },
  { to: "/profile", label: "Profile", tier: "all" },
  { to: "/support", label: "Support", tier: "all" },
  { to: "/admin", label: "Administrator", tier: "admin" },
  { to: "/super-admin", label: "Super Admin", tier: "super_admin" },
];

// Routes treated as "home" — no back arrow shown here.
const HOME_ROUTES = new Set<string>(["/", "/lobby"]);

// Tracks how many in-app navigations have happened since the tab opened.
// `window.history.length` is unreliable (counts entries from before the SPA
// loaded — e.g. the new-tab page), so a bare `history.back()` could land on
// a blank page or an external site. We only call `history.back()` when we
// know there's an internal entry to return to.
let internalNavCount = 0;

export function AppHeader() {
  const { isAuthenticated, user } = useAuth();
  const { isVerifiedHolder, isLifer } = useVerificationStatus();
  const [entranceOpen, setEntranceOpen] = useState(false);
  // eslint-disable-next-line no-console
  console.log("[AppHeader] render entranceOpen=", entranceOpen);
  const [navOpen, setNavOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [karaokeRoomId, setKaraokeRoomId] = useState<string | null>(null);
  // pendingGatedRoute removed: gated nav entries are now hidden entirely
  // until verification completes, so there's no in-menu retry flow.

  const router = useRouter();
  const location = useLocation();

  // Count internal navigations so the back button never lands on a blank/
  // external page. The first effect run is the route the user landed on;
  // every subsequent change counts as a navigation we can rewind to.
  useEffect(() => {
    internalNavCount += 1;
  }, [location.pathname]);

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

  // Resolve the active karaoke room id once so the menu entry can link
  // straight into the room — avoids relying on a server-side beforeLoad
  // redirect from /karaoke that intermittently no-ops for lobby users.
  useEffect(() => {
    if (!isAuthenticated) {
      setKaraokeRoomId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("rooms")
        .select("id")
        .eq("kind", "karaoke")
        .eq("active", true)
        .order("display_order", { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setKaraokeRoomId((data?.id as string | undefined) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // Show the hamburger to every authenticated user — lobby visitors get to
  // browse the full clubhouse menu and see exactly what unlocks once they
  // verify a BAYC/MAYC. Gated items render with a lock icon and pop the
  // Glyph signing modal on click.
  const showHamburger = isAuthenticated;
  // Normalize trailing slash so /lobby/ also counts as a home route, and
  // hide the back chevron entirely on the lobby / landing pages so lobby
  // visitors never see a back arrow when they have nowhere meaningful to
  // go back to.
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/";
  const showBack = isAuthenticated && !HOME_ROUTES.has(normalizedPath);

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
      <header
        className="sticky top-0 z-50 glass pl-safe pr-safe"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
          <div className="flex min-w-0 shrink items-center gap-1.5 sm:gap-3">
            {showBack && (
              <button
                type="button"
                onClick={() => {
                  // Only rewind when we know there's an in-app entry to
                  // return to; otherwise fall back to the lobby so the user
                  // never lands on a blank tab or an external page.
                  if (internalNavCount > 1) {
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
              to={isAuthenticated ? "/lobby" : "/"}
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
                      // Karaoke Room shortcut only for lobby visitors;
                      // holders reach it via Conference Rooms.
                      if (item.tier === "lobby_only") return !isVerifiedHolder;
                      return true;
                    }).map((item) => {
                      const isAdminTier = item.tier === "admin" || item.tier === "super_admin";
                      const sharedClass = `flex items-center justify-between rounded-md px-3 py-3 text-sm font-medium transition hover:bg-secondary/60 ${
                        item.tier === "lifer" || isAdminTier ? "text-gold" : "text-foreground"
                      }`;
                      return (
                        <Link
                          key={item.to}
                          {...(item.to === "/karaoke" && karaokeRoomId
                            ? { to: "/karaoke/$roomId", params: { roomId: karaokeRoomId } }
                            : { to: item.to })}
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
  const glyph = useGlyphAuthState();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [clicked, setClicked] = useState(false);
  const isBooting = clicked && !glyph.ready;

  useEffect(() => {
    if (glyph.ready) setClicked(false);
  }, [glyph.ready]);

  useEffect(() => {
    if (!clicked) return;
    if (glyph.ready) return;
    const t = window.setTimeout(() => {
      toast.error("Wallet sign-in didn't load.", {
        description: "Please refresh the page and try again.",
        duration: 8000,
      });
      setClicked(false);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [clicked, glyph.ready]);

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

  const verifying = glyph.verifying;

  // Re-verification (lobby → holder): hands off to the Glyph bridge,
  // which pops a fresh SIWE signature and re-runs the on-chain check.
  // The bridge dispatches "baycmc:verification-refresh" on success so
  // useVerificationStatus reloads — no manual refresh needed here.
  function requestReverify() {
    window.dispatchEvent(new Event("baycmc:wallet-verify"));
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
    // Email-authenticated user with no wallet linked yet — render nothing
    // in the header. They can manage their account from the profile page.
    return null;
  }

  // Don't gate the VIP button on authLoading — render it immediately so
  // the landing-page top-right always has a visible sign-in entry point.


  if (glyph.authenticated && glyph.address) {
    // Wallet connected but not yet signed in to Supabase. The signing popup
    // can only open from a user gesture, so this is a deliberate "Sign to
    // enter" tap: clicking dispatches the verify event, whose listener calls
    // signMessage synchronously inside this click.
    return (
      <button
        type="button"
        disabled={verifying}
        onClick={() => {
          window.dispatchEvent(new Event("baycmc:wallet-verify"));
        }}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 text-xs font-semibold text-gold transition hover:border-gold/70 hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70"
        title={verifying ? "Signing in…" : `Sign to enter (${sliceAddress(glyph.address)})`}
        aria-label={
          verifying
            ? `Signing in with wallet ${sliceAddress(glyph.address)}`
            : `Sign to enter with wallet ${sliceAddress(glyph.address)}`
        }
      >
        {verifying ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gold/70" /> Signing…
          </>
        ) : (
          "Sign to enter"
        )}
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
      {isBooting ? "Loading…" : "VIP"}
    </button>
  );
}

// Suppress unused-import warning when X isn't directly referenced; the
// shadcn Sheet component uses it via its own close button.
void X;
