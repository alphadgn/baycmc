import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Mic, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { KaraokeMusicBoard } from "@/components/KaraokeMusicBoard";

interface KaraokeStageProps {
  roomId: string;
  /**
   * The user_id of the active booking holder, if any. When set, that user
   * is the sole performer for the duration of the booking — the queue is
   * bypassed entirely. When null, the room is "open mic" and the front of
   * the queue gets the stage one song at a time.
   */
  bookingHostUserId: string | null;
}

interface KaraokeSession {
  performer_user_id: string | null;
  video_id: string | null;
  search_query: string | null;
}

interface QueueRow {
  id: string;
  user_id: string;
  joined_at: string;
}

type Profile = { id: string; username: string | null; wallet_address: string };

function short(addr: string | undefined | null) {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Coordinates the Karaoke Room's shared "now playing" state and turn-taking.
 *
 * - Subscribes to `karaoke_sessions` (one row per room) so every viewer
 *   renders the same iframe / search query in real time.
 * - Subscribes to `karaoke_queue` so the waiting list refreshes for everyone
 *   instantly as users join, leave, or rotate.
 * - When a booking is active, the booking holder is the sole performer.
 *   Otherwise the front of the queue becomes the performer; ending a song
 *   pops that user off the queue and promotes the next one.
 */
export function KaraokeStage({ roomId, bookingHostUserId }: KaraokeStageProps) {
  const { user } = useAuth();
  const [session, setSession] = useState<KaraokeSession>({
    performer_user_id: null,
    video_id: null,
    search_query: null,
  });
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});

  // ---- Initial load + realtime subscriptions ----
  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const { data } = await supabase
        .from("karaoke_sessions")
        .select("performer_user_id,video_id,search_query")
        .eq("room_id", roomId)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setSession({
          performer_user_id: data.performer_user_id,
          video_id: data.video_id,
          search_query: data.search_query,
        });
      }
    }
    async function loadQueue() {
      const { data } = await supabase
        .from("karaoke_queue")
        .select("id,user_id,joined_at")
        .eq("room_id", roomId)
        .order("joined_at", { ascending: true });
      if (cancelled) return;
      setQueue(data ?? []);
    }
    void loadSession();
    void loadQueue();

    const ch = supabase
      .channel(`karaoke:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "karaoke_sessions", filter: `room_id=eq.${roomId}` },
        () => void loadSession(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "karaoke_queue", filter: `room_id=eq.${roomId}` },
        () => void loadQueue(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [roomId]);

  // ---- Resolve display names for performer + queue ----
  useEffect(() => {
    const ids = new Set<string>();
    if (session.performer_user_id) ids.add(session.performer_user_id);
    if (bookingHostUserId) ids.add(bookingHostUserId);
    queue.forEach((q) => ids.add(q.user_id));
    const missing = [...ids].filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,username,wallet_address")
        .in("id", missing);
      if (cancelled || !data) return;
      setProfiles((prev) => {
        const next = { ...prev };
        data.forEach((p) => {
          next[p.id] = p as Profile;
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [session.performer_user_id, bookingHostUserId, queue, profiles]);

  // ---- Determine the effective performer ----
  // Booking always wins. Otherwise: stored performer, or front of queue.
  const effectivePerformerId = useMemo(() => {
    if (bookingHostUserId) return bookingHostUserId;
    if (session.performer_user_id) return session.performer_user_id;
    return queue[0]?.user_id ?? null;
  }, [bookingHostUserId, session.performer_user_id, queue]);

  // If nobody is the recorded performer but the queue has someone, promote
  // the front of the queue (open-mic auto-start). Anyone in the room can
  // perform this promotion — RLS permits any verified user to update.
  useEffect(() => {
    if (bookingHostUserId) return;
    if (session.performer_user_id) return;
    const next = queue[0];
    if (!next) return;
    void supabase
      .from("karaoke_sessions")
      .upsert(
        {
          room_id: roomId,
          performer_user_id: next.user_id,
          video_id: null,
          search_query: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      )
      .then(({ error }) => {
        if (error) console.warn("[karaoke] auto-promote failed", error);
      });
  }, [bookingHostUserId, session.performer_user_id, queue, roomId]);

  const isMyTurn = !!user && !!effectivePerformerId && user.id === effectivePerformerId;
  const meInQueue = !!user && queue.some((q) => q.user_id === user.id);

  // ---- Performer actions: change track, end song ----
  // If the stage is free (no booking, no performer), the user auto-claims it
  // when they hit play. Otherwise only the active performer can mutate.
  const onChangeTrack = useCallback(
    async (next: { videoId: string | null; activeQuery: string | null }) => {
      if (!user) return;
      const stageFree = !bookingHostUserId && !effectivePerformerId;
      if (!isMyTurn && !stageFree) {
        toast.message("Someone else is on stage", {
          description: "Join the line to take your turn.",
        });
        return;
      }
      const performerId = isMyTurn ? effectivePerformerId : user.id;
      const { error } = await supabase.from("karaoke_sessions").upsert(
        {
          room_id: roomId,
          performer_user_id: performerId,
          video_id: next.videoId,
          search_query: next.activeQuery,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      );
      if (error) toast.error("Could not sync track", { description: error.message });
    },
    [isMyTurn, user, roomId, effectivePerformerId, bookingHostUserId],
  );

  const onEndSong = useCallback(async () => {
    if (!isMyTurn || !user) return;
    // Open-mic mode only: pop self from queue and promote next user.
    // During a booking the performer keeps the stage so this is a no-op.
    if (bookingHostUserId) return;
    const myRow = queue.find((q) => q.user_id === user.id);
    if (myRow) {
      await supabase.from("karaoke_queue").delete().eq("id", myRow.id);
    }
    const next = queue.find((q) => q.user_id !== user.id);
    await supabase.from("karaoke_sessions").upsert(
      {
        room_id: roomId,
        performer_user_id: next?.user_id ?? null,
        video_id: null,
        search_query: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "room_id" },
    );
  }, [isMyTurn, user, bookingHostUserId, queue, roomId]);

  // ---- Queue actions ----
  async function joinLine() {
    if (!user) return;
    const { error } = await supabase
      .from("karaoke_queue")
      .insert({ room_id: roomId, user_id: user.id });
    if (error && !/duplicate/i.test(error.message)) {
      toast.error("Could not join the line", { description: error.message });
    }
  }
  async function leaveLine() {
    if (!user) return;
    await supabase.from("karaoke_queue").delete().eq("room_id", roomId).eq("user_id", user.id);
  }

  const performerProfile = effectivePerformerId ? profiles[effectivePerformerId] : null;
  const performerName =
    performerProfile?.username ?? short(performerProfile?.wallet_address) ?? "—";

  // Drag state — anchored top-left, offsets in CSS pixels.
  const [pos, setPos] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseDx: number; baseDy: number } | null>(
    null,
  );
  function onDragPointerDown(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseDx: pos.dx, baseDy: pos.dy };
  }
  function onDragPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const { startX, startY, baseDx, baseDy } = dragRef.current;
    setPos({ dx: baseDx + (e.clientX - startX), dy: baseDy + (e.clientY - startY) });
  }
  function onDragPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    dragRef.current = null;
  }

  return (
    <>
      {/* Queue + status strip — draggable from the top handle */}
      <div
        className="fixed left-4 top-20 z-40 w-[min(90vw,18rem)] overflow-hidden rounded-xl border border-gold/30 bg-background/85 text-xs shadow-gold backdrop-blur"
        style={{ transform: `translate(${pos.dx}px, ${pos.dy}px)` }}
      >
        <div
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          className="flex cursor-grab touch-none select-none items-center gap-1.5 border-b border-gold/15 bg-gradient-to-b from-[#1a1a1a]/60 to-transparent px-3 py-1.5 text-gold active:cursor-grabbing"
        >
          <GripVertical className="h-3 w-3 text-gold/60" />
          <Mic className="h-3.5 w-3.5" />
          <span className="font-display text-[10px] uppercase tracking-[0.25em]">On stage</span>
        </div>
        <div className="p-3 pt-2">
        <div className="mt-1 truncate text-sm font-semibold text-foreground">
          {effectivePerformerId ? performerName : "Nobody — first in line goes up"}
          {bookingHostUserId && (
            <span className="ml-1 rounded-sm bg-gold/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-gold">
              Booked
            </span>
          )}
        </div>


        {!bookingHostUserId && (
          <>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-1 text-gold/80">
                <Users className="h-3 w-3" />
                <span className="text-[10px] uppercase tracking-wider">
                  Waiting · {queue.length}
                </span>
              </div>
              {meInQueue ? (
                <button
                  type="button"
                  onClick={leaveLine}
                  className="rounded-sm border border-rose-400/40 bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-400/20"
                >
                  Leave line
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!user || isMyTurn}
                  onClick={joinLine}
                  className="rounded-sm bg-gradient-gold px-2 py-0.5 text-[10px] font-semibold text-gold-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Join line
                </button>
              )}
            </div>
            {queue.length > 0 && (
              <ol className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                {queue.slice(0, 6).map((q, i) => {
                  const p = profiles[q.user_id];
                  const name = p?.username ?? short(p?.wallet_address) ?? q.user_id.slice(0, 6);
                  return (
                    <li key={q.id} className="flex justify-between">
                      <span>
                        {i + 1}. {name}
                      </span>
                      {user?.id === q.user_id && (
                        <span className="text-gold/70">you</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              One song per turn. The line auto-advances when the performer ends their song.
            </p>
          </>
        )}
        </div>
      </div>


      <KaraokeMusicBoard
        isMyTurn={isMyTurn}
        videoId={session.video_id}
        activeQuery={session.search_query}
        onChangeTrack={onChangeTrack}
        onEndSong={bookingHostUserId ? undefined : onEndSong}
      />
    </>
  );
}
