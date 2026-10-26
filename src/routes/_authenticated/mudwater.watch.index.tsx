/**
 * Watch Matches — live and recent Mudwater games across all five tables.
 * Open to members with a wallet proven in this sign-in session, and to
 * admins / verified-role members. Spectators only ever see public state.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bot, Eye, Loader2 } from "lucide-react";
import { RoomsShell } from "@/components/RoomsShell";
import { supabase } from "@/integrations/supabase/client";
import { mudwaterListWatchable } from "@/server/mudwater.functions";
import { BetLink, SEAT_TEXT, reasonText, useInterval } from "@/components/mudwater/MudwaterUi";
import type { Seat } from "@/lib/mudwater/types";

export const Route = createFileRoute("/_authenticated/mudwater/watch/")({
  head: () => ({ meta: [{ title: "Watch Matches — Mudwater" }] }),
  component: WatchList,
});

type ListData = Extract<Awaited<ReturnType<typeof mudwaterListWatchable>>, { ok: true }>["data"];
type MatchView = ListData["live"][number];

function WatchList() {
  const list = useServerFn(mudwaterListWatchable);
  const [data, setData] = useState<ListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await list();
    if (!res.ok) setError(res.error);
    else setData(res.data);
  }, [list]);
  useEffect(() => {
    void load();
    const ch = supabase
      .channel("mudwater-watch-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mudwater_matches" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [load]);
  useInterval(() => void load(), 30000);

  return (
    <RoomsShell title="Watch Matches" subtitle="Live Mudwater games across every table.">
      <div className="mx-auto max-w-4xl pb-24">
        <Link
          to="/mudwater"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All tables
        </Link>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data ? (
          <div className="flex justify-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data.allowed ? (
          <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-center text-sm">
            <p className="text-foreground">
              Watching matches needs a wallet connected and signed in this session.
            </p>
            <div className="mt-3 flex justify-center">
              <BetLink canWatch={false}>Connect a wallet</BetLink>
            </div>
          </div>
        ) : (
          <>
            <h2 className="mb-2 font-display text-base text-gradient-gold">Live now</h2>
            {data.live.length === 0 ? (
              <p className="mb-6 rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
                No games in progress right now.
              </p>
            ) : (
              <div className="mb-6 grid gap-3 sm:grid-cols-2">
                {data.live.map((m) => (
                  <MatchCard key={m.id} m={m} />
                ))}
              </div>
            )}
            <h2 className="mb-2 font-display text-base text-gradient-gold">Recently finished</h2>
            {data.recent.length === 0 ? (
              <p className="rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
                Nothing yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {data.recent.map((m) => (
                  <MatchCard key={m.id} m={m} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </RoomsShell>
  );
}

function MatchCard({ m }: { m: MatchView }) {
  const g = m.game;
  return (
    <Link
      to="/mudwater/watch/$matchId"
      params={{ matchId: m.id }}
      className="block rounded-2xl border border-border/60 bg-card/40 p-4 transition hover:border-gold/40"
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-sm text-gradient-gold">{m.roomName}</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Eye className="h-3 w-3" /> {m.status === "playing" ? "Live" : "Replay"}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        {([0, 1] as const).map((s: Seat) => {
          const seat = m.seats.find((x) => x.seat === s);
          return (
            <span key={s} className={`flex min-w-0 items-center gap-1 ${SEAT_TEXT[s]}`}>
              {seat?.isAgent && <Bot className="h-3.5 w-3.5" />}
              <span className="truncate">{seat?.displayName ?? "—"}</span>
              {g && <span className="font-display text-foreground">{g.scores[s]}</span>}
            </span>
          );
        })}
      </div>
      {m.status !== "playing" && (
        <p className="mt-1 text-[11px] text-muted-foreground">{reasonText(m.endReason)}</p>
      )}
    </Link>
  );
}
