import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, LogOut, Menu, User as UserIcon, Wallet, X } from "lucide-react";
import { signOut, useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { useAuthGate } from "@/state/authGate";
import { useGlyphAuthState } from "@/lib/auth/useGlyphBridge";
import { supabase } from "@/integrations/supabase/client";
import { EntranceDialog } from "@/components/EntranceDialog";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { WalletPill } from "@/components/WalletPill";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
    | "/punks-brunch"
    | "/admin"
    | "/super-admin";
  label: string;
  // "lobby_only" = visible only to signed-in users who are NOT verified
  // holders. Holders already reach the karaoke room from the Conference
  // Rooms hall (it lives there as a karaoke-kind tile), so a duplicate
  // top-level entry would be redundant for them. Lobby visitors still
  // need a direct way in since Conference Rooms is gated.
  tier: "all" | "lobby_only" | "verified" | "punks" | "lifer" | "admin" | "super_admin";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/lobby", label: "Public Lobby", tier: "all" },
  { to: "/feed", label: "Holders Chat", tier: "verified" },
  { to: "/punks-brunch", label: "Punks Brunch", tier: "punks" },
  { to: "/rooms", label: "Conference Rooms", tier: "verified" },
  { to: "/ape-rides", label: "Ape Rides", tier: "verified" },
  { to: "/lifers/messages", label: "Lifer Chat", tier: "lifer" },
  { to: "/karaoke", label: "Karaoke Room", tier: "all" },
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
  const gate = useAuthGate();
  const isVerifiedHolder = gate.ownsRequiredAsset;
  const isLifer = gate.showLifers;
  const { collections } = useVerificationStatus();
  const [entranceOpen, setEntranceOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  useEffect(() => {
    const open = () => setLinkOpen(true);
    window.addEventListener("baycmc:link-wallet-open", open);
    return () => window.removeEventListener("baycmc:link-wallet-open", open);
  }, []);
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
              aria-label="BAYCmc"
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
                      if (item.tier === "punks") return isAdmin || collections.includes("PUNKS");
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
      <EntranceDialog open={linkOpen} onOpenChange={setLinkOpen} mode="link" />
    </>
  );
}

function sliceAddress(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// VIP button → opens the EntranceDialog, which owns the Glyph / wallet
// choice and the single SIWE signature. (The old button ALSO fired Glyph's
// connect() on the same click, so users never got to choose and the
// promise rejection was unhandled.)
function EntranceControls({ onOpen }: { onOpen: () => void }) {
  const { isAuthenticated, user } = useAuth();
  const {
    isVerifiedHolder,
    collection,
    collections,
    loading: verifLoading,
  } = useVerificationStatus();
  const glyph = useGlyphAuthState();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  useEffect(() => {
    window.addEventListener("baycmc:vip-click", onOpen);
    return () => window.removeEventListener("baycmc:vip-click", onOpen);
  }, [onOpen]);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setWalletAddress(null);
      return;
    }
    let cancelled = false;
    void supabase
      .from("profiles")
      .select("wallet_address")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setWalletAddress(data?.wallet_address ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user]);

  if (isAuthenticated) {
    if (walletAddress) {
      return (
        <WalletPill
          address={walletAddress}
          collection={isVerifiedHolder ? (collection ?? null) : null}
          collections={isVerifiedHolder ? collections : []}
          isVerifiedHolder={isVerifiedHolder}
          onVerify={() => window.dispatchEvent(new Event("baycmc:wallet-verify"))}
          verifying={glyph.verifying || verifLoading}
        />
      );
    }
    // Email account: previously rendered NOTHING, so email members had no
    // way to reach their account or sign out from the header.
    return <EmailAccountPill email={user?.email ?? ""} onLinkWallet={onOpen} />;
  }

  if (glyph.authenticated && glyph.address) {
    return (
      <button
        type="button"
        disabled={glyph.verifying}
        onClick={() => window.dispatchEvent(new Event("baycmc:wallet-verify"))}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 text-xs font-semibold text-gold transition hover:border-gold/70 hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70"
        title={`Sign to enter (${sliceAddress(glyph.address)})`}
      >
        {glyph.verifying ? (
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
      data-vip-trigger="true"
      onClick={(e) => {
        e.preventDefault();
        onOpen();
      }}
      style={{
        backgroundImage:
          "linear-gradient(135deg, oklch(0.85 0.16 82) 0%, oklch(0.68 0.18 50) 100%)",
        color: "oklch(0.14 0.01 80)",
        boxShadow: "0 10px 40px -10px oklch(0.78 0.14 78 / 35%)",
      }}
      className="shrink-0 cursor-pointer rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 sm:px-4 sm:text-sm"
    >
      VIP
    </button>
  );
}

function EmailAccountPill({ email, onLinkWallet }: { email: string; onLinkWallet: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 max-w-[11rem] items-center gap-2 rounded-full border border-gold/30 bg-secondary/40 px-3 text-xs text-foreground hover:border-gold/60"
          aria-label="Account menu"
        >
          <UserIcon className="h-3.5 w-3.5 text-gold" />
          <span className="truncate">{email.split("@")[0] || "Account"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-60 border-gold/20 p-2">
        <p className="truncate px-3 py-2 text-xs text-muted-foreground">{email}</p>
        <Link
          to="/profile"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary"
        >
          <UserIcon className="h-4 w-4 text-muted-foreground" /> Profile
        </Link>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onLinkWallet();
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-secondary"
        >
          <Wallet className="h-4 w-4 text-muted-foreground" /> Link a wallet (holders)
        </button>
        <button
          type="button"
          onClick={async () => {
            setOpen(false);
            await signOut();
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </PopoverContent>
    </Popover>
  );
}

// Suppress unused-import warning when X isn't directly referenced; the
// shadcn Sheet component uses it via its own close button.
void X;
