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

  // Track which user IDs are currently present on the karaoke page (via
  // Supabase Realtime presence). Used to auto-advance the turn queue when
  // the active performer (or a queued user) disconnects, navigates away,
  // or otherwise drops out without explicitly leaving the line.
  const [presentIds, setPresentIds] = useState<Set<string>>(() => new Set());
  const lastSeenRef = useRef<Map<string, number>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

    const presenceKey = user?.id ?? `anon-${Math.random().toString(36).slice(2)}`;
    const ch = supabase
      .channel(`karaoke:${roomId}`, { config: { presence: { key: presenceKey } } })
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
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, Array<{ user_id?: string }>>;
        const ids = new Set<string>();
        const now = Date.now();
        Object.entries(state).forEach(([key, metas]) => {
          const uid = metas?.[0]?.user_id ?? key;
          if (uid && !uid.startsWith("anon-")) {
            ids.add(uid);
            lastSeenRef.current.set(uid, now);
          }
        });
        setPresentIds(ids);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && user?.id) {
          void ch.track({ user_id: user.id, at: new Date().toISOString() });
        }
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(ch);
    };
  }, [roomId, user?.id]);

  // ---- Auto-advance: prune absent performer / queued users ----
  // Any client can run the prune; the writes are idempotent (deletes are
  // no-ops if the row is already gone, upserts converge on the same state)
  // and we add a tiny per-client jitter to avoid thundering-herd writes.
  useEffect(() => {
    const GRACE_MS = 15_000;
    const jitter = Math.floor(Math.random() * 2000);
    const timer = window.setInterval(() => {
      const now = Date.now();
      const isAbsent = (uid: string) => {
        if (presentIds.has(uid)) return false;
        const seen = lastSeenRef.current.get(uid) ?? 0;
        return now - seen > GRACE_MS;
      };
      const stale = queue.filter((q) => isAbsent(q.user_id));
      stale.forEach((row) => {
        void supabase.from("karaoke_queue").delete().eq("id", row.id);
      });
      if (!bookingHostUserId && session.performer_user_id && isAbsent(session.performer_user_id)) {
        void supabase.from("karaoke_sessions").upsert(
          {
            room_id: roomId,
            performer_user_id: null,
            video_id: null,
            search_query: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "room_id" },
        );
      }
    }, 5_000 + jitter);
    return () => window.clearInterval(timer);
  }, [presentIds, queue, session.performer_user_id, bookingHostUserId, roomId]);

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

  // ---- Visible queue ----
  // The waitlist must only show users who satisfy ALL three rules:
  //   (1) signed in, (2) present in the room, (3) signed up for the line.
  // Presence (realtime) covers (1)+(2): anonymous viewers use `anon-*` keys
  // and are filtered out of `presentIds` at sync time. Intersecting with
  // the persisted queue covers (3). Stale rows from force-killed tabs are
  // hidden immediately — no DB write needed, and no one else can mutate
  // another user's row (RLS unchanged).
  const visibleQueue = useMemo(
    () => queue.filter((q) => presentIds.has(q.user_id)),
    [queue, presentIds],
  );

  // ---- Determine the effective performer ----
  // Booking always wins. Otherwise: stored performer (only if still present),
  // or front of the visible queue.
  const effectivePerformerId = useMemo(() => {
    if (bookingHostUserId) return bookingHostUserId;
    if (session.performer_user_id && presentIds.has(session.performer_user_id)) {
      return session.performer_user_id;
    }
    return visibleQueue[0]?.user_id ?? null;
  }, [bookingHostUserId, session.performer_user_id, visibleQueue, presentIds]);

  // If nobody is the recorded performer but the queue has someone, promote
  // the front of the queue (open-mic auto-start). Anyone in the room can
  // perform this promotion — RLS permits any verified user to update.
  useEffect(() => {
    if (bookingHostUserId) return;
    if (session.performer_user_id) return;
    const next = visibleQueue[0];
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
  }, [bookingHostUserId, session.performer_user_id, visibleQueue, roomId]);

  const isMyTurn = !!user && !!effectivePerformerId && user.id === effectivePerformerId;
  const meInQueue = !!user && visibleQueue.some((q) => q.user_id === user.id);

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

  // ---- Host / super-admin force-skip ----
  // The booking holder always counts as the room host. Outside of bookings,
  // anyone with `admin` / `super_admin` role can advance the queue when it
  // stalls (e.g. a performer's tab froze before presence prune kicked in).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (cancelled) return;
        setIsAdmin(!!data?.some((r) => r.role === "admin" || r.role === "super_admin"));
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  const canForceSkip =
    !!user &&
    !!effectivePerformerId &&
    effectivePerformerId !== user.id &&
    (isAdmin || (bookingHostUserId ? bookingHostUserId === user.id : false));

  const forceSkip = useCallback(async () => {
    if (!canForceSkip || !effectivePerformerId) return;
    const skipped = effectivePerformerId;
    // Pull the current performer out of the line and promote the next
    // eligible user. The auto-promote effect will fill in if `next` is
    // also absent for any reason.
    await supabase.from("karaoke_queue").delete().eq("room_id", roomId).eq("user_id", skipped);
    const next = queue.find((q) => q.user_id !== skipped);
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
    toast.success("Skipped current performer");
  }, [canForceSkip, effectivePerformerId, queue, roomId]);

  // ---- Queue actions ----
  // The waiting list is room-presence only. We intentionally do not persist a
  // "join intent" in localStorage: if a user leaves, logs out, times out, or
  // drops from the room, they must be removed from the live line.
  async function joinLine() {
    if (!user) return;
    const { error } = await supabase
      .from("karaoke_queue")
      .insert({ room_id: roomId, user_id: user.id });
    if (error && !/duplicate/i.test(error.message)) {
      toast.error("Could not join the line", { description: error.message });
      return;
    }
  }
  async function leaveLine() {
    if (!user) return;
    await supabase.from("karaoke_queue").delete().eq("room_id", roomId).eq("user_id", user.id);
  }

  // Presence: drop the user from the waiting list AND release the stage
  // if they're the active performer the moment they leave the room — whether
  // by navigating away (component unmounts) or closing/hiding the tab
  // (pagehide). Without this, the room would stall on a departed performer
  // until the presence-based prune timer (above) catches up.
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;
  const performerIdRef = useRef<string | null>(session.performer_user_id);
  performerIdRef.current = session.performer_user_id;
  const bookingRef = useRef<string | null>(bookingHostUserId);
  bookingRef.current = bookingHostUserId;
  useEffect(() => {
    function cleanupSelf() {
      const uid = userIdRef.current;
      if (!uid) return;
      void supabase.from("karaoke_queue").delete().eq("room_id", roomId).eq("user_id", uid);
      // If I was the performer, clear the stage so the next person in line
      // can be promoted automatically by other clients' auto-promote effect.
      if (!bookingRef.current && performerIdRef.current === uid) {
        void supabase.from("karaoke_sessions").upsert(
          {
            room_id: roomId,
            performer_user_id: null,
            video_id: null,
            search_query: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "room_id" },
        );
      }
    }
    window.addEventListener("pagehide", cleanupSelf);
    window.addEventListener("baycmc:karaoke-cleanup-self", cleanupSelf);
    return () => {
      window.removeEventListener("pagehide", cleanupSelf);
      window.removeEventListener("baycmc:karaoke-cleanup-self", cleanupSelf);
      cleanupSelf();
    };
  }, [roomId]);

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

  // Pause is a local UI signal — when the performer pauses, restore the
  // waiting-list panel and expand the music machine. Reset whenever the
  // track changes so the next song starts cleanly.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    setPaused(false);
  }, [session.video_id]);
  const isPlaying = !!session.video_id && !paused;
  // Slide the waiting list off to the left edge while playing, leaving
  // ~32px peeking out as a tap-target. Clicking it brings it back without
  // disturbing the pause state.
  const [forceWaitlistVisible, setForceWaitlistVisible] = useState(false);
  useEffect(() => {
    if (!isPlaying) setForceWaitlistVisible(false);
  }, [isPlaying]);
  const waitlistHidden = isPlaying && !forceWaitlistVisible;

  const resetAllPanels = useCallback(() => {
    setPos({ dx: 0, dy: 0 });
    setForceWaitlistVisible(true);
    setPaused(false);
    // Tell the music machine to reopen + expand.
    window.dispatchEvent(new CustomEvent("karaoke:reset-panels"));
  }, []);
  // Expose so any other panel (or a future affordance) can request a reset
  // now that the dedicated "Show all panels" button has been removed in
  // favour of the Participants pill.
  useEffect(() => {
    function onReq() {
      resetAllPanels();
    }
    window.addEventListener("karaoke:request-reset-panels", onReq);
    return () => window.removeEventListener("karaoke:request-reset-panels", onReq);
  }, [resetAllPanels]);

  return (
    <>
      {/* "Show all panels" was previously here. Per design update IMG_2966
          it has been replaced by the room Participants pill, which now
          lives in the same bottom-right slot (rendered from LiveBottomBar
          since it needs LiveKit room context). Panel-reset is still
          available via the waiting-list "On stage" handle.
          We expose resetAllPanels on window so any panel that needs an
          escape hatch can still call it. */}

      {/* Queue + status strip — draggable from the top handle.
          Slides off to the left edge while the song is playing. */}
      <div
        className="fixed left-4 top-20 z-40 w-[min(90vw,18rem)] overflow-hidden rounded-xl border border-gold/30 bg-background/85 text-xs shadow-gold backdrop-blur transition-transform duration-500 ease-out"
        style={{
          transform: waitlistHidden
            ? `translate(calc(-100% + 28px), ${pos.dy}px)`
            : `translate(${pos.dx}px, ${pos.dy}px)`,
        }}
      >
        {waitlistHidden && (
          <button
            type="button"
            aria-label="Show waiting list"
            onClick={() => setForceWaitlistVisible(true)}
            className="absolute right-0 top-0 h-full w-[28px] cursor-pointer bg-gradient-to-l from-gold/30 to-transparent"
          />
        )}
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
          {canForceSkip && (
            <button
              type="button"
              onClick={forceSkip}
              className="mt-2 w-full rounded-sm border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-400/20"
              title={
                isAdmin
                  ? "Admin override: skip the current performer"
                  : "Host override: skip the current performer"
              }
            >
              Skip performer →
            </button>
          )}

          {!bookingHostUserId && (
            <>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-1 text-gold/80">
                  <Users className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider">
                    Waiting · {visibleQueue.length}
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
              {visibleQueue.length > 0 && (
                <ol className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                  {visibleQueue.slice(0, 6).map((q, i) => {
                    const p = profiles[q.user_id];
                    const name = p?.username ?? short(p?.wallet_address) ?? q.user_id.slice(0, 6);
                    return (
                      <li key={q.id} className="flex justify-between">
                        <span>
                          {i + 1}. {name}
                        </span>
                        {user?.id === q.user_id && <span className="text-gold/70">you</span>}
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
        paused={paused}
        onPauseToggle={setPaused}
        performerName={effectivePerformerId ? performerName : null}
        // Position: 0 = currently performing, N>=1 = N turns away from the
        // stage (counts the active performer + everyone queued ahead), or
        // null when the viewer is neither performing nor in line.
        myQueuePosition={
          isMyTurn
            ? 0
            : (() => {
                if (!user) return null;
                const idx = visibleQueue.findIndex((q) => q.user_id === user.id);
                if (idx < 0) return null;
                // If there's an active performer in front, add 1; otherwise
                // queue index 0 is up next immediately.
                return effectivePerformerId && effectivePerformerId !== user.id ? idx + 1 : idx;
              })()
        }
        bookingActive={!!bookingHostUserId}
      />
    </>
  );
}
