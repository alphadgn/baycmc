/**
 * Spectator view of one Mudwater match: public board, scores, clock and
 * move log only. Hand contents, antes and rock identities stay hidden
 * until the match ends; then antes and buried rocks are shown in the replay.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bot, Loader2 } from "lucide-react";
import { RoomsShell } from "@/components/RoomsShell";
import { supabase } from "@/integrations/supabase/client";
import { mudwaterTick, mudwaterWatchMatch } from "@/server/mudwater.functions";
import {
  BetPanel,
  Board,
  CardFace,
  Countdown,
  SEAT_TEXT,
  reasonText,
  useInterval,
} from "@/components/mudwater/MudwaterUi";
import { getCard } from "@/lib/mudwater/catalog";
import type { Seat } from "@/lib/mudwater/types";

export const Route = createFileRoute("/_authenticated/mudwater/watch/$matchId")({
  head: () => ({ meta: [{ title: "Watching — Mudwater" }] }),
  component: WatchMatch,
});

type Data = Extract<Awaited<ReturnType<typeof mudwaterWatchMatch>>, { ok: true }>["data"];

function WatchMatch() {
  const { matchId } = Route.useParams();
  const fetchMatch = useServerFn(mudwaterWatchMatch);
  const tick = useServerFn(mudwaterTick);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetchMatch({ data: { matchId } });
    if (!res.ok) setError(res.error);
    else {
      setError(null);
      setData(res.data);
    }
  }, [fetchMatch, matchId]);
  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`mudwater-watch-${matchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mudwater_matches", filter: `id=eq.${matchId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load, matchId]);
  const live = data?.match.status === "playing";
  // Spectators also help settle expired clocks so a game never hangs.
  useInterval(() => void tick({ data: { matchId } }), live ? 10000 : null);
  useInterval(() => void load(), live ? 15000 : null);

  return (
    <RoomsShell title={data?.match.roomName ?? "Watching"} subtitle="Spectator view">
      <div className="mx-auto max-w-4xl pb-24">
        <Link
          to="/mudwater/watch"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All matches
        </Link>
        {error ? (
          <p className="rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm">
            {error}
          </p>
        ) : !data ? (
          <div className="flex justify-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Spectate data={data} />
        )}
      </div>
    </RoomsShell>
  );
}

function Spectate({ data }: { data: Data }) {
  const m = data.match;
  const g = m.game;
  const name = (s: Seat) => m.seats.find((x) => x.seat === s)?.displayName ?? `Seat ${s + 1}`;
  const isAgent = (s: Seat) => !!m.seats.find((x) => x.seat === s)?.isAgent;
  if (!g) return <p className="text-sm text-muted-foreground">This match hasn't started yet.</p>;
  const result = g.result;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/40 p-3">
          {([0, 1] as const).map((s) => (
            <div
              key={s}
              className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 ${g.turn === s && !result ? "bg-secondary" : ""}`}
            >
              {isAgent(s) && <Bot className={`h-4 w-4 ${SEAT_TEXT[s]}`} />}
              <span className={`truncate text-sm font-semibold ${SEAT_TEXT[s]}`}>{name(s)}</span>
              <span className="font-display text-base text-foreground">{g.scores[s]}</span>
              <span className="text-[11px] text-muted-foreground">· {g.handCounts[s]} in hand</span>
            </div>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          {result ? (
            <>
              {m.status === "aborted" || result.winner === null
                ? m.status === "aborted"
                  ? "No result"
                  : "Draw"
                : `${name(result.winner)} wins`}{" "}
              — {reasonText(result.reason)}
            </>
          ) : (
            <>
              {name(g.turn)} to play · <Countdown deadline={m.turnDeadline} />
              {m.advanced && " · advanced rules"}
            </>
          )}
        </p>
        <Board game={g} />
        {g.antes && (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-3">
            <p className="mb-2 text-xs text-muted-foreground">Antes</p>
            <div className="flex flex-wrap gap-4">
              {([0, 1] as const).map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <span className={`text-xs ${SEAT_TEXT[s]}`}>{name(s)}</span>
                  <CardFace number={g.antes![s]} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-4">
        <BetPanel canWatch />
        <div className="rounded-xl border border-border/60 bg-card/40 p-3">
          <p className="mb-2 text-xs text-muted-foreground">Moves</p>
          <ol className="max-h-[320px] space-y-1 overflow-y-auto text-xs">
            {data.actions.length === 0 && <li className="text-muted-foreground">No moves yet.</li>}
            {data.actions.map((a) => (
              <li key={a.move_number} className="flex gap-1.5">
                <span className="w-5 shrink-0 text-right text-muted-foreground">
                  {a.move_number}.
                </span>
                <span className={SEAT_TEXT[a.seat as Seat]}>{name(a.seat as Seat)}</span>
                <span className="text-foreground">
                  {a.kind === "pass"
                    ? "passed"
                    : a.kind === "rock"
                      ? `played a rock on ${a.square! + 1}`
                      : `${a.kind === "upgrade" ? "upgraded" : "placed"} ${a.card ? getCard(a.card).name : "?"} on ${a.square! + 1}`}
                  {a.captured.length > 0 && (
                    <span className="text-gold">
                      {" "}
                      · captured {a.captured.map((c) => c + 1).join(", ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
