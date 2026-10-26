/**
 * A Mudwater table. Every rule is enforced on the server; this screen only
 * shows what the member may see (their own hand and rocks, the public
 * board) and sends their choices.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Bot, Eye, Flag, Loader2, RotateCcw, Sparkles, Users } from "lucide-react";
import { RoomsShell } from "@/components/RoomsShell";
import { supabase } from "@/integrations/supabase/client";
import {
  mudwaterClaimSeat,
  mudwaterGetRoom,
  mudwaterLeave,
  mudwaterPlay,
  mudwaterRematch,
  mudwaterResign,
  mudwaterSetDeck,
  mudwaterTick,
} from "@/server/mudwater.functions";
import {
  BetLink,
  Board,
  CardFace,
  Countdown,
  SEAT_TEXT,
  reasonText,
  useInterval,
} from "@/components/mudwater/MudwaterUi";
import { CARDS, DECK_SIZE, getCard, recommendedDeck, validateDeck } from "@/lib/mudwater/catalog";
import { stateForSeat } from "@/lib/mudwater/projections";
import { roman, validateAction } from "@/lib/mudwater/rules";
import type { Action, Seat } from "@/lib/mudwater/types";

export const Route = createFileRoute("/_authenticated/mudwater/$roomId")({
  head: () => ({ meta: [{ title: "Mudwater table — BAYCmc" }] }),
  component: MudwaterRoom,
});

type RoomData = Extract<Awaited<ReturnType<typeof mudwaterGetRoom>>, { ok: true }>["data"];

function newActionId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function MudwaterRoom() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const getRoom = useServerFn(mudwaterGetRoom);
  const tick = useServerFn(mudwaterTick);
  const [data, setData] = useState<RoomData | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const againRef = useRef(false);

  const load = useCallback(async () => {
    if (loadingRef.current) {
      againRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      const res = await getRoom({ data: { roomId } });
      if (!res.ok) setDenied(res.error);
      else {
        setDenied(null);
        setData(res.data);
      }
    } finally {
      loadingRef.current = false;
      if (againRef.current) {
        againRef.current = false;
        void load();
      }
    }
  }, [getRoom, roomId]);

  const matchId = data?.match?.id ?? null;
  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`mudwater-room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mudwater_matches", filter: `room_id=eq.${roomId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load, roomId]);
  useEffect(() => {
    if (!matchId) return;
    const ch = supabase
      .channel(`mudwater-seats-${matchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mudwater_seats", filter: `match_id=eq.${matchId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load, matchId]);

  const live =
    data?.match && (data.match.status === "waiting" || data.match.status === "playing") && data.me;
  // Presence + keeps the game moving (agent turns, expired clocks).
  useInterval(
    () => {
      if (matchId) void tick({ data: { matchId } });
    },
    live ? 5000 : null,
  );
  // Fallback refresh in case a realtime event is missed.
  useInterval(() => void load(), live ? 15000 : null);

  if (denied) {
    return (
      <RoomsShell title="Mudwater" subtitle="">
        <div className="mx-auto max-w-md rounded-2xl border border-border/60 bg-card/40 p-6 text-center">
          <p className="text-sm text-foreground">{denied}</p>
          <Link
            to="/mudwater"
            className="mt-4 inline-flex items-center gap-1 text-sm text-gold hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> All tables
          </Link>
        </div>
      </RoomsShell>
    );
  }
  if (!data) {
    return (
      <RoomsShell title="Mudwater" subtitle="">
        <div className="flex justify-center p-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </RoomsShell>
    );
  }

  const { room, match, me } = data;
  const gateNote = room.requiredCollection
    ? `${room.requiredCollection === "PUNKS" ? "CryptoPunks" : room.requiredCollection} holders`
    : "Open to every member";

  return (
    <RoomsShell title={room.name} subtitle={gateNote}>
      <div className="mx-auto max-w-4xl pb-24">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => void navigate({ to: "/mudwater" })}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All tables
          </button>
          {data.canWatch ? (
            <Link
              to="/mudwater/watch"
              className="inline-flex items-center gap-1 text-xs text-gold hover:underline"
            >
              <Eye className="h-3.5 w-3.5" /> Watch Matches
            </Link>
          ) : (
            <BetLink canWatch={false}>Watch & bet</BetLink>
          )}
        </div>

        {!match || ((match.status === "finished" || match.status === "aborted") && !me) ? (
          <Setup roomId={room.id} onDone={load} />
        ) : match.status === "waiting" ? (
          me ? (
            <Waiting data={data} onChange={load} />
          ) : (
            <JoinOrBusy data={data} onDone={load} />
          )
        ) : match.status === "playing" ? (
          me ? (
            <Playing data={data} onChange={load} />
          ) : (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm">
              A game is in progress at this table.
              {data.canWatch && (
                <Link
                  to="/mudwater/watch/$matchId"
                  params={{ matchId: match.id }}
                  className="ml-2 text-gold hover:underline"
                >
                  Watch it
                </Link>
              )}
            </div>
          )
        ) : (
          <Finished data={data} onChange={load} />
        )}
      </div>
    </RoomsShell>
  );
}

// ── Setup ──────────────────────────────────────────────────────────────────

function Setup({ roomId, onDone }: { roomId: string; onDone: () => Promise<void> }) {
  const claim = useServerFn(mudwaterClaimSeat);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<"agent" | "pvp" | null>(null);
  async function start(mode: "agent" | "pvp") {
    setBusy(mode);
    const res = await claim({ data: { roomId, mode, advanced } });
    setBusy(null);
    if (!res.ok) toast.error(res.error);
    await onDone();
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <h2 className="font-display text-lg text-gradient-gold">Start a game</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose an opponent. You'll then pick 14 cards from the catalogue — free practice cards,
        nothing is staked.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void start("agent")}
          className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-4 text-left transition hover:border-gold/50"
        >
          <Bot className="mt-0.5 h-5 w-5 text-gold" />
          <span>
            <span className="block text-sm font-semibold text-foreground">
              Play the BAYCmc agent
            </span>
            <span className="block text-xs text-muted-foreground">
              Starts as soon as your cards are picked.
            </span>
          </span>
          {busy === "agent" && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void start("pvp")}
          className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-4 text-left transition hover:border-gold/50"
        >
          <Users className="mt-0.5 h-5 w-5 text-gold" />
          <span>
            <span className="block text-sm font-semibold text-foreground">Play another member</span>
            <span className="block text-xs text-muted-foreground">
              Take a seat and wait for someone to join.
            </span>
          </span>
          {busy === "pvp" && <Loader2 className="ml-auto h-4 w-4 animate-spin" />}
        </button>
      </div>
      <label className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={advanced}
          onChange={(e) => setAdvanced(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="text-foreground">Advanced rules — family advantage.</span> When edges are
          equal, Club beats Mutant, Mutant beats Cosmic, Cosmic beats Arcana, Arcana beats Club.
          Your opponent sees this before joining.
        </span>
      </label>
      <RulesSummary />
    </div>
  );
}

function RulesSummary() {
  return (
    <details className="mt-4 rounded-lg border border-border/50 bg-background/30 p-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer text-foreground">How to play</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>
          Pick 14 different cards with at least one Level I. One is drawn at random as your hidden
          ante; you play the other 13.
        </li>
        <li>
          On your turn: place a Level I card on an empty square, play any card face down as a rock,
          or upgrade a square you control with a card exactly one level higher.
        </li>
        <li>
          A rock counts as Level I, can't be captured, and you may have only one uncovered rock at a
          time.
        </li>
        <li>
          A face-up card attacks each enemy neighbour (no diagonals): if its edge is higher than the
          touching edge, that square becomes yours. Captures don't chain.
        </li>
        <li>
          The game ends when the board is full or both players pass in a row. Most squares wins;
          equal is a draw.
        </li>
        <li>Each turn has a 2-minute clock — running out forfeits the game.</li>
      </ul>
    </details>
  );
}

function JoinOrBusy({ data, onDone }: { data: RoomData; onDone: () => Promise<void> }) {
  const claim = useServerFn(mudwaterClaimSeat);
  const m = data.match!;
  const host = m.seats.find((s) => !s.isAgent);
  const open = m.mode === "pvp" && m.seats.length < 2;
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm">
        This table is being set up. Try again in a moment, or pick another table.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <h2 className="font-display text-lg text-gradient-gold">
        {host?.displayName ?? "A member"} is looking for an opponent
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Rules: {m.advanced ? "advanced (family advantage breaks equal edges)" : "standard"}.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await claim({
            data: { roomId: data.room.id, mode: "pvp", advanced: m.advanced },
          });
          setBusy(false);
          if (!res.ok) toast.error(res.error);
          await onDone();
        }}
        className="mt-4 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-gold-foreground hover:opacity-90"
      >
        {busy ? "Joining…" : "Join the game"}
      </button>
      <RulesSummary />
    </div>
  );
}

// ── Waiting room: deck picker + ready ──────────────────────────────────────

function Waiting({ data, onChange }: { data: RoomData; onChange: () => Promise<void> }) {
  const m = data.match!;
  const me = data.me!;
  const setDeck = useServerFn(mudwaterSetDeck);
  const leave = useServerFn(mudwaterLeave);
  const mySeat = m.seats.find((s) => s.isMe);
  const opp = m.seats.find((s) => !s.isMe);
  const ready = !!mySeat?.ready;
  const [deck, setLocalDeck] = useState<number[]>(me.deck.length ? me.deck : []);
  const [busy, setBusy] = useState(false);
  const problem = validateDeck(deck);

  async function submit(nextReady: boolean) {
    setBusy(true);
    const res = await setDeck({ data: { matchId: m.id, deck, ready: nextReady } });
    setBusy(false);
    if (!res.ok) toast.error(res.error);
    await onChange();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/40 p-4 text-sm">
        <div>
          <p className="text-foreground">
            {opp ? (
              <>
                Opponent: <span className="font-semibold">{opp.displayName}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {opp.ready ? "· ready" : "· picking cards"}
                </span>
              </>
            ) : (
              "Waiting for another member to join…"
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Rules: {m.advanced ? "advanced (family advantage)" : "standard"}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            const res = await leave({ data: { matchId: m.id } });
            if (!res.ok) toast.error(res.error);
            await onChange();
          }}
          className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Leave table
        </button>
      </div>

      {ready ? (
        <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4 text-sm">
          <p className="text-foreground">
            Your 14 cards are locked in. {opp?.ready ? "Starting…" : "Waiting for your opponent."}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {deck.map((n) => (
              <CardFace key={n} number={n} size="sm" />
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(false)}
            className="mt-3 rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Change cards
          </button>
        </div>
      ) : (
        <DeckPicker deck={deck} setDeck={setLocalDeck}>
          <button
            type="button"
            disabled={busy || !!problem}
            onClick={() => void submit(true)}
            className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-gold-foreground disabled:opacity-50"
          >
            {busy ? "Locking in…" : "Ready"}
          </button>
          {problem && deck.length > 0 && (
            <span className="text-xs text-muted-foreground">{problem}</span>
          )}
        </DeckPicker>
      )}
    </div>
  );
}

function DeckPicker({
  deck,
  setDeck,
  children,
}: {
  deck: number[];
  setDeck: (d: number[]) => void;
  children: React.ReactNode;
}) {
  const [level, setLevel] = useState<number | null>(1);
  const [variant, setVariant] = useState(0);
  const chosen = new Set(deck);
  const counts = [1, 2, 3, 4, 5].map((l) => deck.filter((n) => getCard(n).level === l).length);
  const shown = CARDS.filter((c) => level === null || c.level === level);
  const toggle = (n: number) => {
    if (chosen.has(n)) setDeck(deck.filter((x) => x !== n));
    else if (deck.length < DECK_SIZE) setDeck([...deck, n]);
    else toast.message(`You already have ${DECK_SIZE} cards — remove one first.`);
  };
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base text-gradient-gold">
          Pick your cards{" "}
          <span className="text-sm text-muted-foreground">
            ({deck.length}/{DECK_SIZE})
          </span>
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDeck(recommendedDeck(variant));
              setVariant((v) => v + 1);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-gold/40 px-3 py-1.5 text-xs text-gold hover:bg-gold/10"
          >
            <Sparkles className="h-3.5 w-3.5" /> Recommended
          </button>
          <button
            type="button"
            onClick={() => setDeck([])}
            className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-muted-foreground"
          >
            Clear
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        14 different cards, at least one Level I. Selected by level:{" "}
        {counts.map((c, i) => `${roman(i + 1)}·${c}`).join("  ")}
      </p>
      {deck.length > 0 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-2">
          {deck.map((n) => (
            <CardFace
              key={n}
              number={n}
              size="sm"
              selected
              onClick={() => toggle(n)}
              title="Tap to remove"
            />
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[1, 2, 3, 4, 5].map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLevel(l)}
            className={`rounded-full px-3 py-1 text-xs ${level === l ? "bg-gold text-gold-foreground" : "bg-secondary text-muted-foreground"}`}
          >
            Level {roman(l)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLevel(null)}
          className={`rounded-full px-3 py-1 text-xs ${level === null ? "bg-gold text-gold-foreground" : "bg-secondary text-muted-foreground"}`}
        >
          All
        </button>
      </div>
      <div className="mt-3 grid max-h-[360px] grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 overflow-y-auto pr-1">
        {shown.map((c) => (
          <CardFace
            key={c.number}
            number={c.number}
            selected={chosen.has(c.number)}
            onClick={() => toggle(c.number)}
          />
        ))}
      </div>
      <div className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-3 bg-card/90 py-2">
        {children}
      </div>
    </div>
  );
}

// ── Playing ────────────────────────────────────────────────────────────────

function SeatBadge({
  name,
  seat,
  isAgent,
  active,
  count,
}: {
  name: string;
  seat: Seat;
  isAgent: boolean;
  active: boolean;
  count?: number;
}) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 ${active ? "bg-secondary" : ""}`}
    >
      {isAgent ? (
        <Bot className={`h-4 w-4 ${SEAT_TEXT[seat]}`} />
      ) : (
        <span className={`h-2.5 w-2.5 rounded-full ${seat === 0 ? "bg-gold" : "bg-teal-400"}`} />
      )}
      <span className={`truncate text-sm font-semibold ${SEAT_TEXT[seat]}`}>{name}</span>
      {count !== undefined && (
        <span className="text-[11px] text-muted-foreground">{count} in hand</span>
      )}
    </div>
  );
}

function Playing({ data, onChange }: { data: RoomData; onChange: () => Promise<void> }) {
  const m = data.match!;
  const me = data.me!;
  const game = m.game!;
  const play = useServerFn(mudwaterPlay);
  const resign = useServerFn(mudwaterResign);
  const [selected, setSelected] = useState<number | null>(null);
  const [rockMode, setRockMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [captured, setCaptured] = useState<number[]>([]);
  const myTurn = game.turn === me.seat && !game.result;
  const opp = m.seats.find((s) => s.seat !== me.seat);
  const mine = m.seats.find((s) => s.seat === me.seat);

  useEffect(() => {
    setSelected((s) => (s !== null && me.hand.includes(s) ? s : null));
  }, [me.hand]);

  const targets = useMemo(() => {
    if (selected === null || !myTurn) return new Set<number>();
    return new Set(
      me.legal
        .filter(
          (a) =>
            a.type !== "pass" &&
            a.card === selected &&
            (rockMode ? a.type === "rock" : a.type !== "rock"),
        )
        .map((a) => (a as { square: number }).square),
    );
  }, [me.legal, selected, rockMode, myTurn]);

  const playableCards = useMemo(() => {
    const s = new Set<number>();
    for (const a of me.legal) if (a.type !== "pass") s.add(a.card);
    return s;
  }, [me.legal]);

  async function onSquare(i: number) {
    if (!myTurn) return setHint("Wait for your turn.");
    if (selected === null) return setHint("Pick a card from your hand first.");
    const sq = game.board[i];
    const action: Action = rockMode
      ? { type: "rock", card: selected, square: i }
      : sq
        ? { type: "upgrade", card: selected, square: i }
        : { type: "place", card: selected, square: i };
    const why = validateAction(stateForSeat(game, me.seat, me.hand, me.rocks), me.seat, action);
    if (why) return setHint(why);
    setHint(null);
    setBusy(true);
    const res = await play({
      data: { matchId: m.id, action, actionId: newActionId(), expectedVersion: m.version },
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
    } else {
      setSelected(null);
      setRockMode(false);
      setCaptured(res.data.captured);
      setTimeout(() => setCaptured([]), 1800);
    }
    await onChange();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/40 p-3">
        <SeatBadge
          name={opp?.displayName ?? "Opponent"}
          seat={(opp?.seat ?? 1) as Seat}
          isAgent={!!opp?.isAgent}
          active={game.turn !== me.seat}
          count={game.handCounts[(opp?.seat ?? 1) as Seat]}
        />
        <div className="text-center text-xs">
          <p className="font-display text-base">
            <span className={SEAT_TEXT[me.seat]}>{game.scores[me.seat]}</span>
            <span className="text-muted-foreground"> – </span>
            <span className={SEAT_TEXT[(1 - me.seat) as Seat]}>
              {game.scores[(1 - me.seat) as Seat]}
            </span>
          </p>
          <p className="text-muted-foreground">
            {myTurn ? "Your turn" : `${opp?.displayName ?? "Opponent"}'s turn`} ·{" "}
            <Countdown deadline={m.turnDeadline} />
          </p>
        </div>
        <SeatBadge
          name={`${mine?.displayName ?? "You"} (you)`}
          seat={me.seat}
          isAgent={false}
          active={myTurn}
        />
      </div>

      <Board
        game={game}
        myRocks={me.rocks}
        targets={targets}
        captured={captured}
        onSquare={busy ? undefined : (i) => void onSquare(i)}
      />

      <div className="min-h-[20px] text-center text-xs">
        {hint ? (
          <span className="text-amber-300">{hint}</span>
        ) : myTurn ? (
          me.legal.length === 0 ? (
            <span className="text-muted-foreground">No legal move — you pass automatically.</span>
          ) : selected === null ? (
            <span className="text-muted-foreground">Pick a card, then a highlighted square.</span>
          ) : (
            <span className="text-muted-foreground">
              {getCard(selected).name}:{" "}
              {targets.size
                ? "tap a highlighted square."
                : rockMode
                  ? "no square for a rock."
                  : "no square for this card face up — try it as a rock."}
            </span>
          )
        ) : (
          <span className="text-muted-foreground">
            Waiting for {opp?.displayName ?? "your opponent"}…
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-border/60 bg-card/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Your hand ({me.hand.length})</p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={rockMode}
                onChange={(e) => setRockMode(e.target.checked)}
              />
              Play face down (rock)
            </label>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm("Resign this game? Your opponent wins.")) return;
                const res = await resign({ data: { matchId: m.id } });
                if (!res.ok) toast.error(res.error);
                await onChange();
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <Flag className="h-3 w-3" /> Resign
            </button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[...me.hand]
            .sort((a, b) => getCard(a).level - getCard(b).level || a - b)
            .map((n) => (
              <CardFace
                key={n}
                number={n}
                selected={selected === n}
                dim={myTurn && !playableCards.has(n)}
                onClick={() => {
                  setHint(null);
                  setSelected(selected === n ? null : n);
                }}
              />
            ))}
        </div>
        {me.rocks.length > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Your rocks:{" "}
            {me.rocks
              .map(
                (r) =>
                  `${getCard(r.card).name} (square ${r.square + 1}${r.covered ? ", covered" : ""})`,
              )
              .join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Finished ───────────────────────────────────────────────────────────────

function Finished({ data, onChange }: { data: RoomData; onChange: () => Promise<void> }) {
  const m = data.match!;
  const me = data.me!;
  const game = m.game;
  const rematch = useServerFn(mudwaterRematch);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const result = game?.result;
  if (fresh) return <Setup roomId={data.room.id} onDone={onChange} />;
  const headline =
    m.status === "aborted"
      ? "No result"
      : !result || result.winner === null
        ? "Draw"
        : result.winner === me.seat
          ? "You win!"
          : "You lost";
  const opp = m.seats.find((s) => s.seat !== me.seat);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4 text-center">
        <p className="font-display text-2xl text-gradient-gold">{headline}</p>
        {game && (
          <p className="mt-1 text-sm text-foreground">
            {game.scores[me.seat]} – {game.scores[(1 - me.seat) as Seat]}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{reasonText(result?.reason ?? m.endReason)}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const res = await rematch({ data: { matchId: m.id } });
              setBusy(false);
              if (!res.ok) toast.error(res.error);
              await onChange();
            }}
            className="inline-flex items-center gap-1 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-gold-foreground"
          >
            <RotateCcw className="h-4 w-4" /> {opp?.isAgent ? "Rematch" : "Ask for a rematch"}
          </button>
          <button
            type="button"
            onClick={() => setFresh(true)}
            className="rounded-md border border-border/60 px-4 py-2 text-sm text-foreground hover:border-gold/50"
          >
            New game
          </button>
          <Link
            to="/mudwater"
            className="rounded-md border border-border/60 px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Leave
          </Link>
        </div>
      </div>
      {game && (
        <>
          <Board game={game} />
          {game.antes && (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                Antes (revealed after the game; nothing changes hands in free play)
              </p>
              <div className="flex flex-wrap gap-4">
                {([0, 1] as const).map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <span className={`text-xs ${SEAT_TEXT[s]}`}>
                      {m.seats.find((x) => x.seat === s)?.displayName}
                    </span>
                    <CardFace number={game.antes![s]} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
