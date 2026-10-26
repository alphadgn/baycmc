/**
 * Mudwater — the five game tables.
 *
 * MWroom1/2: any signed-in member (email-only included), playing with free
 * digital practice cards from the app's catalogue. MWroom3/4/5: playing
 * seats need the exact collection (BAYC / CryptoPunks / MAYC) verified in
 * this sign-in session. Watching needs a wallet proven this session (or an
 * admin / verified-role member).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { Eye, Lock, Swords, Bot, Users } from "lucide-react";
import { RoomsShell } from "@/components/RoomsShell";
import { supabase } from "@/integrations/supabase/client";
import { mudwaterListRooms } from "@/server/mudwater.functions";
import { BetLink, useInterval } from "@/components/mudwater/MudwaterUi";

export const Route = createFileRoute("/_authenticated/mudwater/")({
  head: () => ({ meta: [{ title: "Mudwater — BAYCmc" }] }),
  component: MudwaterLobby,
});

type RoomRow = {
  id: string;
  name: string;
  description: string | null;
  requiredCollection: string | null;
  canPlay: boolean;
  status: "empty" | "waiting" | "playing";
  mode: "agent" | "pvp" | null;
  seatsTaken: number;
  openSeat: boolean;
  matchId: string | null;
};

const COLLECTION_NAME: Record<string, string> = {
  BAYC: "BAYC",
  MAYC: "MAYC",
  PUNKS: "CryptoPunks",
};

function MudwaterLobby() {
  const list = useServerFn(mudwaterListRooms);
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [canWatch, setCanWatch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await list();
    if (!res.ok) return setError(res.error);
    setRooms(res.data.rooms);
    setCanWatch(res.data.canWatch);
  }, [list]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel("mudwater-lobby")
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
  useInterval(() => void load(), 20000);

  return (
    <RoomsShell
      title="Mudwater"
      subtitle="Swamp Origins card battles — play a member or the BAYCmc agent."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-muted-foreground">
          Pick 14 cards, one is set aside as your hidden ante, and take turns claiming the 3×3
          swamp. Phase 1 games are free — no cards or APE change hands.
        </p>
        {canWatch ? (
          <Link
            to="/mudwater/watch"
            className="inline-flex items-center gap-1.5 rounded-md border border-gold/40 px-3 py-1.5 text-xs text-gold hover:bg-gold/10"
          >
            <Eye className="h-3.5 w-3.5" /> Watch Matches
          </Link>
        ) : (
          <BetLink canWatch={false}>Watch Matches</BetLink>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      {rooms === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted/20" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <RoomCard key={r.id} room={r} canWatch={canWatch} />
          ))}
        </div>
      )}
    </RoomsShell>
  );
}

function RoomCard({ room, canWatch }: { room: RoomRow; canWatch: boolean }) {
  const gate = room.requiredCollection
    ? (COLLECTION_NAME[room.requiredCollection] ?? room.requiredCollection)
    : null;
  const status =
    room.status === "playing"
      ? room.mode === "agent"
        ? "Game in progress vs the agent"
        : "Game in progress"
      : room.status === "waiting"
        ? room.openSeat
          ? "A member is waiting for an opponent"
          : "Setting up"
        : "Table open";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg text-gradient-gold">{room.name}</h3>
        {gate ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
            {!room.canPlay && <Lock className="h-3 w-3" />} {gate}
          </span>
        ) : (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Open
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{room.description}</p>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-foreground">
        {room.status === "playing" ? (
          room.mode === "agent" ? (
            <Bot className="h-3.5 w-3.5" />
          ) : (
            <Swords className="h-3.5 w-3.5" />
          )
        ) : (
          <Users className="h-3.5 w-3.5" />
        )}
        {status}
      </p>
      {!room.canPlay && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Playing here needs a {gate} verified in this sign-in.{" "}
          {canWatch ? "You can still watch." : ""}
        </p>
      )}
    </>
  );
  const cls = "block rounded-2xl border border-border/60 bg-card/40 p-4 shadow-card transition";
  if (room.canPlay) {
    return (
      <Link
        to="/mudwater/$roomId"
        params={{ roomId: room.id }}
        className={`${cls} hover:border-gold/40 hover:shadow-gold`}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={`${cls} opacity-80`}>
      {body}
      {room.status === "playing" && room.matchId && canWatch && (
        <Link
          to="/mudwater/watch/$matchId"
          params={{ matchId: room.matchId }}
          className="mt-3 inline-flex items-center gap-1 text-xs text-gold hover:underline"
        >
          <Eye className="h-3.5 w-3.5" /> Watch this game
        </Link>
      )}
    </div>
  );
}
