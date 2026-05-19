import { Link, useLocation } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Bell,
  Calendar as CalendarIcon,
  Home,
  HelpCircle,
  LifeBuoy,
  Lock,
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
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";

type NavTarget =
  | "/"
  | "/lobby"
  | "/feed"
  | "/rooms"
  | "/messages"
  | "/profile"
  | "/admin"
  | "/activity"
  | "/lifers";

interface NavItem {
  to: NavTarget;
  label: string;
  icon: ReactNode;
  tier: "all" | "verified" | "lifer" | "admin";
  match?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", tier: "all", icon: <Home className="h-4 w-4" /> },
  { to: "/lobby", label: "Lobby", tier: "all", icon: <Users className="h-4 w-4" /> },
  { to: "/feed", label: "Feed", tier: "verified", icon: <Sparkles className="h-4 w-4" /> },
  {
    to: "/rooms",
    label: "Conference Rooms",
    tier: "verified",
    icon: <Video className="h-4 w-4" />,
    match: "/rooms",
  },
  { to: "/activity", label: "Calendar", tier: "all", icon: <CalendarIcon className="h-4 w-4" /> },
  {
    to: "/messages",
    label: "Messages",
    tier: "verified",
    icon: <MessageCircle className="h-4 w-4" />,
  },
  { to: "/profile", label: "Profile", tier: "all", icon: <User className="h-4 w-4" /> },
  { to: "/admin", label: "Admin", tier: "admin", icon: <Shield className="h-4 w-4" /> },
  { to: "/lifers", label: "Support", tier: "lifer", icon: <LifeBuoy className="h-4 w-4" /> },
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
}

/**
 * App-shell layout used by every /rooms* page. Replaces the global AppHeader
 * here so the layout matches the conf.png mockup pixel-for-pixel: vertical
 * left nav with a "Bot Status: online" footer, top welcome strip with the
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
}: RoomsShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] bg-background">
      {/* Sidebar (lg+) */}
      <Sidebar
        className="hidden w-56 shrink-0 border-r border-border/60 bg-card/60 lg:flex"
      />

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex lg:hidden"
        >
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

      {/* Right side: top welcome strip, then content row, then bottom bar */}
      <div className="flex min-w-0 flex-1 flex-col">
        <WelcomeStrip
          title={title}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        <div className="flex min-h-0 flex-1 gap-0 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
            <div className="mb-5">
              <h1 className="font-display text-2xl text-gradient-gold sm:text-4xl">
                {title}
              </h1>
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
              className="hidden w-72 shrink-0 overflow-y-auto border-l border-border/60 bg-card/40 px-3 pb-28 pt-4 xl:block"
              aria-label="Room panels"
            >
              {rightRail}
            </aside>
          )}
        </div>

        {/* Right rail collapsed to inline below sm when xl breakpoint is off.
            Renders below the main grid so all panels remain accessible. */}
        {rightRail && (
          <div className="xl:hidden border-t border-border/60 bg-card/40 px-4 py-4 sm:px-6">
            {rightRail}
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
  const { isAuthenticated } = useAuth();
  const { isVerifiedHolder, isLifer, isAdmin } = useVerificationStatus();

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
          to="/"
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

      <ul className="flex-1 space-y-1 p-3">
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
                <span className={active ? "text-gold" : "text-muted-foreground"}>
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto border-t border-border/60 p-3">
        <div className="flex items-center gap-2 rounded-md bg-background/50 px-3 py-2">
          <span
            className={`relative inline-flex h-2 w-2 ${
              isAuthenticated ? "" : "opacity-40"
            }`}
          >
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
            Bot Status:{" "}
            <span className={isAuthenticated ? "text-emerald-400" : "text-muted-foreground"}>
              {isAuthenticated ? "online" : "offline"}
            </span>
          </span>
        </div>
      </div>
    </nav>
  );
}

function WelcomeStrip({
  title,
  onOpenMobileNav,
}: {
  title: string;
  onOpenMobileNav: () => void;
}) {
  const { user } = useAuth();
  // Pull a short display label — username/email/wallet truncation handled
  // gracefully; falls back to "Welcome".
  const userLabel =
    (user?.user_metadata as { username?: string } | undefined)?.username ||
    (user?.email ? user.email.split("@")[0] : null);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border/60 bg-background/95 px-4 backdrop-blur sm:px-6">
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
        <button
          type="button"
          aria-label="Notifications"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-secondary/40 text-foreground transition hover:bg-secondary"
        >
          <Bell className="h-4 w-4" />
        </button>
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
 * Bottom bar used on the rooms LIST page. Mic / Cam toggle the persisted
 * preference live so the next room a user enters honours their choice;
 * Screen / Chat / Participants surface a friendly hint that they activate
 * inside a room. The in-room page composes its own LiveKit-wired version.
 */
export function RoomsIdleBottomBar() {
  const { prefs, setPrefs } = useRoomPreferences();

  function hintNotJoined(feature: string) {
    toast.message(`${feature} activates inside a room`, {
      description: "Click a room above to join — your camera and mic settings will be applied automatically.",
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
          icon={prefs.cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
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
