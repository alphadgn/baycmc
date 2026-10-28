import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, LogOut, Menu, User as UserIcon, Wallet, X } from "lucide-react";
import { signOut, useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { useAuthGate } from "@/state/authGate";
import { useGlyphAuthState } from "@/lib/auth/useGlyphBridge";
import { supabase } from "@/integrations/supabase/client";
import { EntranceDialog } from "@/components/EntranceDialog";
import { ClubNavList } from "@/components/nav/ClubNavList";
import { EmbroideredImage } from "@/components/EmbroideredImage";
import { WalletPill } from "@/components/WalletPill";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Routes treated as "home" — no back arrow shown here.
const HOME_ROUTES = new Set<string>(["/", "/lobby"]);

/**
 * Publishes the header's real rendered height (safe-area padding + bar +
 * border) as the `--app-header-h` CSS variable, so full-screen pages size
 * themselves to exactly the space left below it instead of guessing.
 */
function usePublishedHeaderHeight() {
  const observerRef = useRef<ResizeObserver | null>(null);
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      document.documentElement.style.setProperty("--app-header-h", "0px");
    },
    [],
  );
  return useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    const root = document.documentElement;
    if (!node) {
      root.style.setProperty("--app-header-h", "0px");
      return;
    }
    const publish = () =>
      root.style.setProperty("--app-header-h", `${node.getBoundingClientRect().height}px`);
    publish();
    if (typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(publish);
      observerRef.current.observe(node);
    }
  }, []);
}

// Tracks how many in-app navigations have happened since the tab opened.
// `window.history.length` is unreliable (counts entries from before the SPA
// loaded — e.g. the new-tab page), so a bare `history.back()` could land on
// a blank page or an external site. We only call `history.back()` when we
// know there's an internal entry to return to.
let internalNavCount = 0;

export function AppHeader() {
  const { isAuthenticated } = useAuth();
  const gate = useAuthGate();
  const isVerifiedHolder = gate.ownsRequiredAsset;
  const isLifer = gate.showLifers;
  const [entranceOpen, setEntranceOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  useEffect(() => {
    const open = () => setLinkOpen(true);
    window.addEventListener("baycmc:link-wallet-open", open);
    return () => window.removeEventListener("baycmc:link-wallet-open", open);
  }, []);
  const [navOpen, setNavOpen] = useState(false);
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

  // Show the hamburger to every authenticated user — lobby visitors get to
  // browse the full clubhouse menu and see exactly what unlocks once they
  // verify a BAYC/MAYC. Gated items render with a lock icon and pop the
  // Glyph signing modal on click.
  const showHamburger = isAuthenticated;
  const headerHeightRef = usePublishedHeaderHeight();
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
  // The rooms shell has its own sidebar; keep only the dialogs mounted so
  // its menu can still open wallet sign-in.
  if (usesRoomsShell) {
    return (
      <>
        <EntranceDialog open={entranceOpen} onOpenChange={setEntranceOpen} />
        <EntranceDialog open={linkOpen} onOpenChange={setLinkOpen} mode="link" />
      </>
    );
  }

  return (
    <>
      <header
        ref={headerHeightRef}
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
                  <div className="p-3">
                    <ClubNavList onNavigate={() => setNavOpen(false)} />
                  </div>
                  <div className="border-t border-border/60 p-3 text-[11px] text-muted-foreground">
                    {isLifer
                      ? "Lifer access granted."
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
    void supabase.rpc("get_my_wallet").then(({ data }) => {
      if (!cancelled) setWalletAddress((data as string | null) ?? null);
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
          collections={collections}
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

  // Signed out → always the VIP button. (A wallet that is still connected
  // from an earlier visit used to replace it with "Sign to enter"; the VIP
  // Entrance window now handles that case itself.)
  void glyph;
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
