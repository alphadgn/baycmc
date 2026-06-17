import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Bell,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Home,
  HelpCircle,
  LifeBuoy,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  Shield,
  Sparkles,
  User,
  Users,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { signOut, useAuth } from "@/lib/auth/useAuth";
import { useAuthGate } from "@/state/authGate";
import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";
import { useNotificationPrefs } from "@/lib/baycmc/useNotificationPrefs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";

type NavTarget =
  | "/"
  | "/lobby"
  | "/feed"
  | "/rooms"
  | "/karaoke"
  | "/calendar"
  | "/profile"
  | "/admin"
  | "/activity"
  | "/lifers"
  | "/support";

interface NavItem {
  to: NavTarget;
  label: string;
  icon: ReactNode;
  tier: "all" | "verified" | "lifer" | "admin";
  match?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/lobby", label: "Home", tier: "all", icon: <Home className="h-4 w-4" /> },
  { to: "/lobby", label: "Public Lobby", tier: "all", icon: <Users className="h-4 w-4" /> },
  { to: "/feed", label: "Holders Chat", tier: "verified", icon: <Sparkles className="h-4 w-4" /> },
  {
    to: "/rooms",
    label: "Conference Rooms",
    tier: "verified",
    icon: <Video className="h-4 w-4" />,
    match: "/rooms",
  },
  // Karaoke is accessed via the Conference Rooms list (kind=karaoke). No
  // separate sidebar entry — the single public Karaoke Room shows up there.
  {
    to: "/calendar",
    label: "Calendar",
    tier: "verified",
    icon: <CalendarIcon className="h-4 w-4" />,
  },
  { to: "/activity", label: "My Activity", tier: "all", icon: <Sparkles className="h-4 w-4" /> },
  { to: "/profile", label: "Profile", tier: "all", icon: <User className="h-4 w-4" /> },
  { to: "/admin", label: "Admin", tier: "admin", icon: <Shield className="h-4 w-4" /> },
  { to: "/support", label: "Support", tier: "all", icon: <LifeBuoy className="h-4 w-4" /> },
];

interface RoomsShellProps {
  /** Big title on the welcome strip / main heading. */
  title: string;
  /** Subtitle below the heading. */
  subtitle?: string;
  /** Main grid / video area. */
  children: ReactNode;
  /** Right-rail panels — Preferences, Host Controls, etc. */
  rightRail?: ReactNode;
  /** Persistent bottom control bar (Room Settings · controls · Leave Room). */
  bottomBar?: ReactNode;
  /**
   * Faded backdrop painted behind the main content area (not the sidebar).
   * Pass the room/lobby image; renders at ~10% opacity beneath a dark gradient.
   */
  backgroundImage?: string | null;
}

/**
 * App-shell layout used by every /rooms* page. Replaces the global AppHeader
 * here so the layout matches the conf.png mockup pixel-for-pixel: vertical
 * left nav with an "AI Assistant: online" footer, top welcome strip with the
 * 24/7 badge, central content, a right rail of panels, and a persistent
 * bottom control bar.
 *
 * On screens below lg the sidebar collapses into a slide-in drawer so the
 * grid stays usable on mobile.
 */
export function RoomsShell({
  title,
  subtitle,
  children,
  rightRail,
  bottomBar,
  backgroundImage,
}: RoomsShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Right-rail starts collapsed below xl so the room/lobby content isn't
  // pushed off-screen by the inline-below panel. xl+ ignores this flag.
  const [railOpen, setRailOpen] = useState(false);

  // Lock body scroll while the shell is mounted. Combined with the `fixed`
  // outer wrapper this guarantees the sidebar and right rail can't move,
  // even if the rest of the document grows taller than the viewport.
  useEffect(() => {
    const prevHtml = document.documentElement.style.overflow;
    const prevBody = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0 flex bg-background">
      {/* Sidebar (lg+) */}
      <Sidebar className="hidden w-56 shrink-0 border-r border-border/60 bg-card/60 lg:flex" />

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="flex-1 bg-background/70 backdrop-blur"
            onClick={() => setMobileNavOpen(false)}
          />
          <Sidebar
            className="flex w-64 shrink-0 border-l border-border/60 bg-card"
            onNavigate={() => setMobileNavOpen(false)}
            onClose={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      {/* Right side: top welcome strip, then content row, then bottom bar.
          The faded backdrop is painted here so it only covers the main area
          (the sidebar keeps its solid glass look). `min-h-0` at every level
          of this flex column is required so the inner <main> can become a
          real scroll container instead of growing to fit its content. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {backgroundImage && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <img src={backgroundImage} alt="" aria-hidden className="h-full w-full object-cover" />
            {/* Subtle vignette so welcome strip + bottom bar text stay legible,
                but the room scene itself reads through clearly. */}
            <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/30 to-background/80" />
          </div>
        )}

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <WelcomeStrip title={title} onOpenMobileNav={() => setMobileNavOpen(true)} />

          <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
            <main className="scrollbar-modern min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
              <div className="mb-5">
                <h1 className="font-display text-2xl text-gradient-gold sm:text-4xl">{title}</h1>
                {subtitle && (
                  <p className="mt-1 text-xs text-muted-foreground font-sans-display sm:text-sm">
                    {subtitle}
                  </p>
                )}
              </div>
              {children}
            </main>

            {rightRail && (
              <aside
                className="scrollbar-modern hidden w-72 shrink-0 overflow-x-hidden overflow-y-auto border-l border-border/60 bg-card/40 px-3 pb-28 pt-4 xl:block"
                aria-label="Room panels"
              >
                {rightRail}
              </aside>
            )}
          </div>

          {/* Below xl the right rail collapses to an inline section under the
              main grid. Starts hidden so the video / hero isn't obscured;
              the chevron tab toggles it. */}
          {rightRail && (
            <div className="xl:hidden border-t border-border/60 bg-card/40">
              <button
                type="button"
                onClick={() => setRailOpen((v) => !v)}
                aria-expanded={railOpen}
                aria-controls="rooms-shell-mobile-rail"
                className="flex w-full items-center justify-between gap-2 px-4 py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition hover:bg-secondary/40 sm:px-6"
              >
                <span>Room panels</span>
                {railOpen ? (
                  <ChevronLeft className="h-3.5 w-3.5 rotate-90" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                )}
              </button>
              {railOpen && (
                <div id="rooms-shell-mobile-rail" className="px-4 pb-4 sm:px-6">
                  {rightRail}
                </div>
              )}
            </div>
          )}

          {bottomBar && (
            <div
              className="sticky bottom-0 left-0 right-0 border-t border-border/60 bg-background/95 backdrop-blur"
              role="toolbar"
              aria-label="Room controls"
            >
              {bottomBar}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  className,
  onNavigate,
  onClose,
}: {
  className?: string;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { isVerifiedHolder, isLifer, isAdmin } = useVerificationStatus();

  async function handleSignOut() {
    await signOut();
    toast.success("Signed out");
    onNavigate?.();
    void navigate({ to: "/" });
  }

  // Filter nav by access. Admins see every item; Lifer-only items hide for
  // non-Lifers (admins are treated as Lifers by useVerificationStatus).
  const items = NAV_ITEMS.filter((item) => {
    if (item.tier === "all") return true;
    if (item.tier === "admin") return isAdmin;
    if (item.tier === "lifer") return isLifer;
    if (item.tier === "verified") return isVerifiedHolder;
    return false;
  });

  return (
    <nav className={`flex flex-col ${className ?? ""}`} aria-label="Primary">
      <div className="flex h-16 items-center justify-between border-b border-border/60 px-4">
        <Link
          to="/lobby"
          onClick={onNavigate}
          className="flex items-center gap-2 font-display text-sm"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-gold font-display text-base font-bold text-gold-foreground shadow-gold">
            B
          </span>
          <span className="font-display tracking-wide text-foreground">
            <span className="text-gradient-gold">BAYC</span>
            <span className="text-gold/80">mc</span>
            <span className="ml-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Clubhouse
            </span>
          </span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <ul className="scrollbar-modern flex min-h-0 flex-1 flex-col space-y-1 overflow-x-hidden overflow-y-auto p-3">
        {items.map((item) => {
          const active = item.match
            ? location.pathname.startsWith(item.match)
            : location.pathname === item.to;
          return (
            <li key={item.to + item.label}>
              <Link
                to={item.to}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition font-sans-display ${
                  active
                    ? "bg-gold/10 text-gold ring-1 ring-gold/30"
                    : "text-foreground/80 hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                <span className={active ? "text-gold" : "text-muted-foreground"}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {isAuthenticated && (
        <div className="border-t border-border/60 p-3">
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-destructive transition hover:bg-destructive/10 font-sans-display"
          >
            <LogOut className="h-4 w-4" />
            <span className="truncate">Sign out</span>
          </button>
        </div>
      )}

      <div className="mt-auto border-t border-border/60 p-3">
        <div className="flex items-center gap-2 rounded-md bg-background/50 px-3 py-2">
          <span className={`relative inline-flex h-2 w-2 ${isAuthenticated ? "" : "opacity-40"}`}>
            <span
              className={`absolute inset-0 rounded-full ${
                isAuthenticated ? "animate-ping bg-emerald-400" : "bg-muted-foreground"
              }`}
            />
            <span
              className={`relative inline-block h-2 w-2 rounded-full ${
                isAuthenticated ? "bg-emerald-500" : "bg-muted-foreground"
              }`}
            />
          </span>
          <span className="text-[11px] text-muted-foreground">
            AI Assistant:{" "}
            <span className={isAuthenticated ? "text-emerald-400" : "text-muted-foreground"}>
              {isAuthenticated ? "online" : "offline"}
            </span>
          </span>
        </div>
      </div>
    </nav>
  );
}

function sliceWallet(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function WelcomeStrip({ title, onOpenMobileNav }: { title: string; onOpenMobileNav: () => void }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<{
    username: string | null;
    wallet_address: string | null;
  } | null>(null);

  // Pull profile.username (the canonical source set on the Profile page) so
  // the welcome shows the user's chosen handle. Falls back to a truncated
  // wallet address — the same identity treatment used by the WalletPill.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username,wallet_address")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setProfile(
        data
          ? { username: data.username ?? null, wallet_address: data.wallet_address ?? null }
          : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const userLabel =
    profile?.username?.trim() ||
    (profile?.wallet_address ? sliceWallet(profile.wallet_address) : null);

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-4 backdrop-blur pl-safe pr-safe sm:px-6"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)",
        minHeight: "calc(3.5rem + max(env(safe-area-inset-top, 0px), 0.75rem))",
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary/40 text-foreground transition hover:bg-secondary lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>
        <span className="hidden truncate text-xs uppercase tracking-widest text-muted-foreground sm:inline">
          {title}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden text-[12px] text-muted-foreground sm:inline">
          {userLabel ? `Welcome, ${userLabel}` : "Welcome"}
        </span>
        <NotificationSettingsButton />
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-destructive"
          title="24/7 live clubhouse"
        >
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
          24/7
        </span>
      </div>
    </header>
  );
}

/**
 * Bell button in the welcome strip → opens a small popover with the
 * user's notification preferences. The prefs are persisted per user via
 * useNotificationPrefs so the choices survive logout/login.
 */
function NotificationSettingsButton() {
  const { prefs, setPrefs } = useNotificationPrefs();
  const allOff = !prefs.toastsEnabled;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notification settings"
          title="Notification settings"
          className={`relative inline-flex h-9 w-9 items-center justify-center rounded-md border bg-secondary/40 transition hover:bg-secondary ${
            allOff ? "border-destructive/40 text-destructive" : "border-border text-foreground"
          }`}
        >
          <Bell className="h-4 w-4" />
          {allOff && (
            <span
              className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-destructive"
              aria-hidden
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72 border-gold/20 bg-popover p-4">
        <p className="font-display text-sm uppercase tracking-wider text-gold">
          Notification settings
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Saved to this device for your account. Survives sign-out.
        </p>
        <div className="mt-3 space-y-2 text-xs">
          <NotifToggleRow
            label="Toast notifications"
            description="In-app alerts in the bottom-right."
            checked={prefs.toastsEnabled}
            onChange={(v) => setPrefs({ toastsEnabled: v })}
          />
          <NotifToggleRow
            label="Room activity"
            description="Join / leave hints when you're in a room."
            checked={prefs.roomActivityEnabled}
            onChange={(v) => setPrefs({ roomActivityEnabled: v })}
          />
          <NotifToggleRow
            label="Sound"
            description="Audible chirp on new toasts."
            checked={prefs.soundEnabled}
            onChange={(v) => setPrefs({ soundEnabled: v })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotifToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-foreground">{label}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${
          checked ? "bg-gradient-gold" : "bg-secondary"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

/**
 * Bottom bar used on the rooms LIST page. Mic / Cam toggle the persisted
 * preference live so the next room a user enters honours their choice;
 * Screen / Chat / Participants surface a friendly hint that they activate
 * inside a room. The in-room page composes its own LiveKit-wired version.
 */
export function RoomsIdleBottomBar() {
  const { prefs, setPrefs } = useRoomPreferences();

  function hintNotJoined(feature: string) {
    toast.message(`${feature} activates inside a room`, {
      description:
        "Click a room above to join — your camera and mic settings will be applied automatically.",
      duration: 4500,
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
      <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> Room Settings
      </span>

      <div className="flex flex-1 items-center justify-center gap-3 sm:gap-5">
        <BottomIcon
          label="Mic"
          icon={prefs.micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          tone={prefs.micEnabled ? "active" : "off"}
          onClick={() => setPrefs({ micEnabled: !prefs.micEnabled })}
        />
        <BottomIcon
          label="Cam"
          icon={
            prefs.cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />
          }
          tone={prefs.cameraEnabled ? "active" : "off"}
          onClick={() => setPrefs({ cameraEnabled: !prefs.cameraEnabled })}
        />
        <BottomIcon
          label="Screen"
          icon={<Monitor className="h-4 w-4" />}
          tone="neutral"
          onClick={() => hintNotJoined("Screen share")}
        />
        <BottomIcon
          label="Chat"
          icon={<MessageCircle className="h-4 w-4" />}
          tone="neutral"
          onClick={() => hintNotJoined("Chat")}
        />
        <BottomIcon
          label="Participants"
          icon={<Users className="h-4 w-4" />}
          tone="neutral"
          onClick={() => hintNotJoined("Participants list")}
        />
      </div>

      <span className="hidden text-[11px] text-muted-foreground sm:inline">
        Pick a room to start your audio / video
      </span>
    </div>
  );
}

function BottomIcon({
  label,
  icon,
  disabled,
  tone = "neutral",
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  tone?: "active" | "off" | "neutral";
  onClick?: () => void;
}) {
  const toneClass = disabled
    ? "cursor-not-allowed border-border/40 bg-secondary/20 text-muted-foreground/60"
    : tone === "active"
      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_18px_-6px_rgba(16,185,129,0.7)]"
      : tone === "off"
        ? "border-destructive/60 bg-destructive/10 text-destructive"
        : "border-border bg-secondary/50 text-foreground hover:bg-secondary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={tone === "active"}
      className={`flex h-12 w-14 flex-col items-center justify-center rounded-md border text-[10px] font-medium transition ${toneClass}`}
    >
      <span aria-hidden>{icon}</span>
      <span className="mt-0.5 truncate">{label}</span>
    </button>
  );
}

export { BottomIcon };

// Silence "unused import" warnings for icons we exposed as Sidebar items
// but might be tree-shaken in some chunks.
void HelpCircle;
