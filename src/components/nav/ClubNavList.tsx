import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown, Lock } from "lucide-react";
import { toast } from "sonner";
import { onDisabledNav, useClubNav, type NavLeaf } from "@/lib/nav/useClubNav";

/**
 * Renders the clubhouse menu (see useClubNav). Used by the header menu and
 * the rooms sidebar so both always show the same entries in the same order.
 */
export function ClubNavList({
  onNavigate,
  compact = false,
}: {
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const entries = useClubNav();
  const location = useLocation();
  const inConference =
    location.pathname.startsWith("/rooms") || location.pathname.startsWith("/punks-brunch");
  const inChapters = location.pathname.startsWith("/chapters");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const pad = compact ? "px-3 py-2" : "px-3 py-3";

  const leaf = (l: NavLeaf, nested = false) => {
    const cls = `flex w-full items-center justify-between rounded-md ${pad} text-sm font-medium transition ${
      nested ? "pl-6" : ""
    } ${l.disabled ? "cursor-pointer text-muted-foreground/60 hover:bg-secondary/30" : "hover:bg-secondary/60"} ${
      !l.disabled && l.tone === "gold" ? "text-gold" : !l.disabled ? "text-foreground" : ""
    }`;
    if (l.disabled) {
      return (
        <button
          key={l.key}
          type="button"
          aria-disabled="true"
          onClick={() => {
            onDisabledNav(l, (m, o) => toast(m, o));
            if (l.disabled === "wallet") onNavigate?.();
          }}
          className={cls}
          title={
            l.disabled === "wallet"
              ? "Sign in with a wallet to play"
              : l.disabled === "lifer"
                ? "Lifer access only"
                : "Coming soon"
          }
        >
          <span>{l.label}</span>
          {l.disabled === "wallet" || l.disabled === "lifer" ? (
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <span className="text-[10px] uppercase tracking-wider">Soon</span>
          )}
        </button>
      );
    }
    return (
      <Link
        key={l.key}
        {...({ to: l.to, params: l.params } as { to: "/lobby" })}
        onClick={() => onNavigate?.()}
        className={cls}
      >
        <span>{l.label}</span>
      </Link>
    );
  };

  return (
    <nav className="flex flex-col" aria-label="Clubhouse">
      {entries.map((e) => {
        if (e.kind === "link") return leaf(e);
        const isOpen = open[e.key] ?? (e.key === "chapters" ? inChapters : inConference);
        return (
          <div key={e.key}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [e.key]: !isOpen }))}
              className={`flex w-full items-center justify-between rounded-md ${pad} text-sm font-medium text-foreground transition hover:bg-secondary/60`}
            >
              <span>{e.label}</span>
              <ChevronDown
                className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>
            {isOpen && <div className="flex flex-col">{e.children.map((c) => leaf(c, true))}</div>}
          </div>
        );
      })}
    </nav>
  );
}
