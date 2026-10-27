import { useCallback, useState, type KeyboardEvent, type RefObject } from "react";
import { Loader2, Search, X } from "lucide-react";
import { avatarShapeClass } from "@/lib/profile-avatar";
import {
  applyMention,
  mentionAtCaret,
  rememberMember,
  splitMentions,
  useMemberDirectory,
  useMemberSearch,
  type MemberHit,
} from "@/lib/members/memberSearch";

/**
 * Username lookup UI shared by every chat:
 *  - useMentionComposer: "@" in a composer opens member suggestions from
 *    the database; ↑/↓ to move, Enter/Tab to pick, Esc to close.
 *  - MentionText: renders @mentions of real members as gold, tappable names.
 *  - MemberSearchBox: a search bar that finds members by username.
 */

export function MemberAvatar({
  m,
  size = 28,
}: {
  m: Pick<MemberHit, "username" | "avatar_url">;
  size?: number;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-gradient-gold text-[10px] font-semibold text-gold-foreground ${avatarShapeClass(m.avatar_url)}`}
      style={{ width: size, height: size }}
    >
      {m.avatar_url ? (
        <img src={m.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        m.username.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}

function SuggestionList({
  hits,
  active,
  loading,
  onPick,
  className = "",
  emptyText,
}: {
  hits: MemberHit[];
  active: number;
  loading: boolean;
  onPick: (m: MemberHit) => void;
  className?: string;
  emptyText?: string;
}) {
  return (
    <div
      role="listbox"
      className={`overflow-hidden rounded-xl border border-gold/30 bg-popover shadow-xl ${className}`}
    >
      {loading && hits.length === 0 ? (
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching members…
        </p>
      ) : hits.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {emptyText ?? "No member with that username."}
        </p>
      ) : (
        <ul className="max-h-60 overflow-y-auto py-1">
          {hits.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                // Keep focus (and the phone keyboard) in the composer.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onPick(m)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
                  i === active ? "bg-secondary" : "hover:bg-secondary/60"
                }`}
              >
                <MemberAvatar m={m} />
                <span className="min-w-0 flex-1 truncate font-medium">{m.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "@" autocomplete for a text input or textarea. */
export function useMentionComposer({
  value,
  setValue,
  inputRef,
  placement = "above",
}: {
  value: string;
  setValue: (v: string) => void;
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** Where the suggestions open relative to the composer. */
  placement?: "above" | "below";
}) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const ctx = mentionAtCaret(value, caret);
  const open = !!ctx && dismissed !== ctx.start;
  const { hits, loading } = useMemberSearch(ctx?.query ?? "", open, 8, true);

  const syncCaret = useCallback(() => {
    const el = inputRef.current;
    if (el) setCaret(el.selectionStart ?? el.value.length);
  }, [inputRef]);

  const pick = useCallback(
    (m: MemberHit) => {
      if (!ctx) return;
      rememberMember(m);
      const next = applyMention(value, ctx.start, caret, m.username);
      setValue(next.text);
      setCaret(next.caret);
      setActive(0);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(next.caret, next.caret);
        }
      });
    },
    [ctx, value, caret, setValue, inputRef],
  );

  /** Call first in onKeyDown; returns true when it handled the key. */
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open || hits.length === 0) {
        if (open && e.key === "Escape" && ctx) {
          e.preventDefault();
          setDismissed(ctx.start);
          return true;
        }
        return false;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % hits.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + hits.length) % hits.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(hits[Math.min(active, hits.length - 1)]!);
        return true;
      }
      if (e.key === "Escape" && ctx) {
        e.preventDefault();
        setDismissed(ctx.start);
        return true;
      }
      return false;
    },
    [open, hits, active, pick, ctx],
  );

  const inputProps = {
    onSelect: syncCaret,
    onKeyUp: syncCaret,
    onClick: syncCaret,
    onInput: syncCaret,
  };

  const popup = open ? (
    <SuggestionList
      hits={hits}
      active={Math.min(active, Math.max(0, hits.length - 1))}
      loading={loading}
      onPick={pick}
      className={`absolute left-2 right-2 z-30 sm:right-auto sm:w-72 ${
        placement === "above" ? "bottom-full mb-2 sm:left-12" : "top-full mt-1 sm:left-0"
      }`}
    />
  ) : null;

  /** Insert "@username " at the caret (e.g. from a member list). */
  const insertMention = useCallback(
    (m: MemberHit) => {
      rememberMember(m);
      const el = inputRef.current;
      const at = el?.selectionStart ?? value.length;
      const pre = value.slice(0, at);
      const sep = pre && !/\s$/.test(pre) ? " " : "";
      const insert = `${sep}@${m.username} `;
      const next = pre + insert + value.slice(at);
      setValue(next);
      const c = at + insert.length;
      setCaret(c);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(c, c);
      });
    },
    [inputRef, value, setValue],
  );

  return { popup, onKeyDown, inputProps, insertMention };
}

/** Message text with @mentions of real members highlighted and tappable. */
export function MentionText({
  body,
  onMention,
  mineHighlight,
}: {
  body: string;
  onMention?: (m: MemberHit) => void;
  /** Members to emphasise (e.g. the viewer) */
  mineHighlight?: string | null;
}) {
  const members = useMemberDirectory();
  const parts = splitMentions(body, members);
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMention?.(p.member);
            }}
            className={`rounded px-0.5 font-semibold text-gold underline-offset-2 hover:underline ${
              mineHighlight && p.member.id === mineHighlight ? "bg-gold/15" : ""
            }`}
            title={`@${p.member.username}`}
          >
            {p.text}
          </button>
        ),
      )}
    </>
  );
}

/** A search bar that finds members by username. */
export function MemberSearchBox({
  onSelect,
  placeholder = "Find a member by username",
  autoFocus,
}: {
  onSelect: (m: MemberHit) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const term = q.replace(/^@/, "");
  const { hits, loading } = useMemberSearch(term, true, 12);
  const choose = (m: MemberHit) => {
    rememberMember(m);
    onSelect(m);
    setQ("");
  };
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (!hits.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(hits[Math.min(active, hits.length - 1)]!);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base focus:outline-none placeholder:text-muted-foreground/70 sm:text-sm"
          style={{ fontSize: 16 }}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {term.trim() && (
        <SuggestionList
          hits={hits}
          active={Math.min(active, Math.max(0, hits.length - 1))}
          loading={loading}
          onPick={choose}
          className="mt-1"
        />
      )}
    </div>
  );
}
