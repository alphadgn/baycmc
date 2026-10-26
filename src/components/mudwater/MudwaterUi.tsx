import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock, Coins } from "lucide-react";
import { getCard } from "@/lib/mudwater/catalog";
import { roman } from "@/lib/mudwater/rules";
import type { PublicGame, PublicSquare } from "@/lib/mudwater/projections";
import type { Family, Seat } from "@/lib/mudwater/types";
import { EntranceDialog } from "@/components/EntranceDialog";
import boardArt from "@/assets/mudwater/board.webp";

/**
 * Shared Mudwater visuals: styled text cards (artwork comes later), the
 * 3×3 board, and the side-bet placeholder. Every card shows its four
 * strengths around the edge — top = north — in one fixed orientation for
 * both seats.
 */

const FAMILY_STYLE: Record<Family, { label: string; chip: string }> = {
  CLUB: { label: "Club", chip: "bg-amber-500/20 text-amber-300" },
  MUTANT: { label: "Mutant", chip: "bg-lime-500/20 text-lime-300" },
  COSMIC: { label: "Cosmic", chip: "bg-violet-500/20 text-violet-300" },
  ARCANA: { label: "Arcana", chip: "bg-sky-500/20 text-sky-300" },
};

/** Seat tint: seat 0 gold, seat 1 teal — consistent for players and spectators. */
export const SEAT_RING: Record<Seat, string> = {
  0: "ring-2 ring-gold",
  1: "ring-2 ring-teal-400",
};
export const SEAT_TEXT: Record<Seat, string> = { 0: "text-gold", 1: "text-teal-300" };

export function familyLabel(f: Family) {
  return FAMILY_STYLE[f].label;
}

export function CardFace({
  number,
  size = "md",
  selected,
  dim,
  onClick,
  title,
}: {
  number: number;
  size?: "sm" | "md";
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const c = getCard(number);
  const fam = FAMILY_STYLE[c.family];
  const small = size === "sm";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={
        title ??
        `${c.name} — ${fam.label}, Level ${roman(c.level)}. N ${c.north} · E ${c.east} · S ${c.south} · W ${c.west}`
      }
      className={`relative flex shrink-0 flex-col rounded-lg border bg-card text-left transition ${
        small ? "h-[86px] w-[64px] p-1" : "h-[112px] w-[84px] p-1.5"
      } ${selected ? "border-gold shadow-gold -translate-y-1" : "border-border/70"} ${
        dim ? "opacity-40" : ""
      } ${onClick ? "cursor-pointer hover:border-gold/60" : ""}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`rounded px-1 text-[9px] font-semibold uppercase ${fam.chip}`}>
          {fam.label}
        </span>
        <span className="text-[9px] font-bold text-muted-foreground">{roman(c.level)}</span>
      </div>
      <Strengths n={c.north} e={c.east} s={c.south} w={c.west} small={small} />
      <p
        className={`mt-auto line-clamp-2 leading-tight text-foreground ${small ? "text-[8px]" : "text-[9.5px]"}`}
      >
        {c.name}
      </p>
      <span className="absolute bottom-0.5 right-1 text-[7px] text-muted-foreground/70">
        #{c.number}
      </span>
    </Tag>
  );
}

function Strengths({
  n,
  e,
  s,
  w,
  small,
}: {
  n: number;
  e: number;
  s: number;
  w: number;
  small: boolean;
}) {
  const cls = `font-display font-bold tabular-nums text-foreground ${small ? "text-[11px]" : "text-[13px]"}`;
  return (
    <div
      className="my-0.5 grid grid-cols-3 grid-rows-3 place-items-center leading-none"
      aria-label={`North ${n}, east ${e}, south ${s}, west ${w}`}
    >
      <span />
      <span className={cls}>{n}</span>
      <span />
      <span className={cls}>{w}</span>
      <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
      <span className={cls}>{e}</span>
      <span />
      <span className={cls}>{s}</span>
      <span />
    </div>
  );
}

function RockFace({ known, small }: { known?: number; small?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-stone-500/60 bg-gradient-to-br from-stone-700 to-stone-900 text-center ${
        small ? "h-[86px] w-[64px]" : "h-[112px] w-[84px]"
      }`}
      title={known ? `Your rock: ${getCard(known).name}` : "A rock (face down)"}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-200">
        Rock
      </span>
      <span className="text-[9px] text-stone-300/80">counts as Level I</span>
      {known && (
        <span className="mt-1 px-1 text-[8px] leading-tight text-stone-300/90">
          {getCard(known).name}
        </span>
      )}
    </div>
  );
}

/** One square: shows the top layer, with a depth badge when stacked. */
function SquareView({
  sq,
  index,
  myRocks,
  highlight,
  lastCaptured,
  onClick,
}: {
  sq: PublicSquare | null;
  index: number;
  myRocks?: Map<number, number>;
  highlight?: boolean;
  lastCaptured?: boolean;
  onClick?: () => void;
}) {
  const top = sq?.layers[sq.layers.length - 1];
  const buried = sq ? sq.layers.slice(0, -1) : [];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={`Square ${index + 1}`}
      className={`relative flex h-full w-full items-center justify-center p-[6%] transition ${
        highlight ? "bg-gold/15 shadow-[inset_0_0_0_2px_rgba(234,179,8,0.85)]" : ""
      } ${onClick ? "cursor-pointer hover:bg-gold/10" : "cursor-default"}`}
    >
      {sq && top && (
        <div
          className={`relative rounded-lg shadow-[0_6px_18px_rgba(0,0,0,0.6)] ${SEAT_RING[sq.controller]} ${
            lastCaptured ? "animate-pulse" : ""
          }`}
        >
          {top.faceDown ? (
            top.card ? (
              // Revealed after the match.
              <div className="relative">
                <CardFace number={top.card} size="sm" />
                <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-stone-700 px-1 text-[8px] uppercase text-stone-100">
                  rock
                </span>
              </div>
            ) : (
              <RockFace small known={myRocks?.get(index)} />
            )
          ) : (
            <CardFace number={top.card!} size="sm" />
          )}
          {buried.length > 0 && (
            <span
              className="absolute -right-1.5 -top-1.5 rounded-full bg-secondary px-1.5 text-[9px] font-semibold text-foreground"
              title={buried
                .map((l) =>
                  l.card ? `${getCard(l.card).name}${l.faceDown ? " (rock)" : ""}` : "hidden rock",
                )
                .join(" · ")}
            >
              ×{sq.layers.length}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * The Mudwater mat: black felt with gold stitching and the club emblem in
 * the centre. The nine squares sit exactly on the mat's gold grid (the
 * artwork's inner frame spans 1%–99% and is divided into equal thirds).
 */
export function Board({
  game,
  myRocks,
  targets,
  captured,
  onSquare,
}: {
  game: PublicGame;
  myRocks?: { square: number; card: number; covered: boolean }[];
  targets?: Set<number>;
  captured?: number[];
  onSquare?: (i: number) => void;
}) {
  const rockMap = new Map((myRocks ?? []).map((r) => [r.square, r.card]));
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[360px] overflow-hidden rounded-xl bg-black bg-cover bg-center shadow-[0_18px_40px_rgba(0,0,0,0.55)] sm:max-w-[420px]"
      style={{ backgroundImage: `url(${boardArt})` }}
    >
      <div className="absolute inset-[1%] grid grid-cols-3 grid-rows-3">
        {game.board.map((sq, i) => (
          <SquareView
            key={i}
            sq={sq}
            index={i}
            myRocks={rockMap}
            highlight={targets?.has(i)}
            lastCaptured={captured?.includes(i)}
            onClick={onSquare ? () => onSquare(i) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export function Countdown({ deadline }: { deadline: string | null }) {
  const [, force] = useState(0);
  useInterval(() => force((x) => x + 1), deadline ? 1000 : null);
  if (!deadline) return null;
  const left = Math.max(0, Math.round((Date.parse(deadline) - Date.now()) / 1000));
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return (
    <span className={`tabular-nums ${left <= 20 ? "text-destructive" : "text-muted-foreground"}`}>
      {m}:{s}
    </span>
  );
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function reasonText(reason: string | null | undefined): string {
  switch (reason) {
    case "board_full":
      return "The board is full.";
    case "double_pass":
      return "Both players passed.";
    case "resign":
      return "A player resigned.";
    case "timeout":
      return "A player ran out of time.";
    case "abandoned":
      return "The game was abandoned — no result.";
    case "expired":
    case "left":
      return "The table closed before the game started.";
    default:
      return "";
  }
}

/**
 * Side-bet entry point. Betting is a later phase, so this only shows the
 * shape: greyed links for members who can't bet (an email-only session),
 * which open wallet sign-in; a "coming later" notice for everyone else.
 */
export function BetLink({ canWatch, children }: { canWatch: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!canWatch) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground opacity-60 hover:opacity-80"
          title="Connect a wallet to watch and bet"
        >
          <Lock className="h-3.5 w-3.5" /> {children ?? "Watch & bet"}
        </button>
        <EntranceDialog open={open} onOpenChange={setOpen} mode="link" />
      </>
    );
  }
  return <>{children ? children : null}</>;
}

export function BetPanel({ canWatch }: { canWatch: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-3">
      <p className="flex items-center gap-1.5 font-display text-[11px] uppercase tracking-wider text-gold">
        <Coins className="h-3.5 w-3.5" /> Side bets
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Betting in APE opens in a later phase. Bets will close before the first move — the game
        never waits.
      </p>
      <div className="mt-2 flex gap-2">
        {(["Seat 1", "Seat 2"] as const).map((l) =>
          canWatch ? (
            <button
              key={l}
              type="button"
              disabled
              className="flex-1 cursor-not-allowed rounded-md border border-border/50 px-3 py-1.5 text-xs text-muted-foreground opacity-60"
            >
              Back {l}
            </button>
          ) : (
            <button
              key={l}
              type="button"
              onClick={() => setOpen(true)}
              className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground opacity-60 hover:opacity-80"
              title="Connect a wallet to bet"
            >
              <Lock className="h-3 w-3" /> Back {l}
            </button>
          ),
        )}
      </div>
      {!canWatch && <EntranceDialog open={open} onOpenChange={setOpen} mode="link" />}
    </div>
  );
}
