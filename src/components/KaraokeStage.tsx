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
  playback_status: string;
  position_ms: number;
  position_at: string;
  generation: number;
  revision: number;
}
type SessionRow = KaraokeSession;

const SESSION_COLUMNS =
  "performer_user_id,video_id,search_query,playback_status,position_ms,position_at,generation,revision";

const EMPTY_SESSION: KaraokeSession = {
  performer_user_id: null,
  video_id: null,
  search_query: null,
  playback_status: "idle",
  position_ms: 0,
  position_at: new Date(0).toISOString(),
  generation: 0,
  revision: -1,
};

function friendly(msg: string | undefined) {
  if (!msg) return "Please try again.";
  if (msg.includes("STALE_REVISION")) return "The stage just changed — try again.";
  return msg;
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
  const [session, setSession] = useState<KaraokeSession>(EMPTY_SESSION);
  // Only accept snapshots that are newer than what we already have, so a
  // slow response can never roll the room state backwards.
  const applySession = useCallback((row: SessionRow) => {
    setSession((prev) => (row.revision < prev.revision ? prev : { ...row }));
  }, []);
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
        .select(SESSION_COLUMNS)
        .eq("room_id", roomId)
        .maybeSingle();
      if (cancelled) return;
      if (data) applySession(data as SessionRow);
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

    channelRef.current = ch;

    return () => {
      cancelled = true;
      channelRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [roomId, user?.id]);

  // ---- Heartbeat lease ----
  // Every 15s each signed-in viewer renews its queue row / performer lease.
  // The server promotes the next singer when a performer's lease expires
  // (45s grace), so crashed tabs recover without unload requests and a
  // hidden tab keeps the stage.
  const heartbeat = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase.rpc("karaoke_heartbeat", { _room: roomId });
    if (error) {
      console.warn("[karaoke] heartbeat failed", error.message);
      return;
    }
    if (data) applySession(data as SessionRow);
  }, [roomId, user?.id, applySession]);
  useEffect(() => {
    if (!user?.id) return;
    void heartbeat();
    const t = window.setInterval(() => void heartbeat(), 15_000);
    return () => window.clearInterval(t);
  }, [heartbeat, user?.id]);

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

  // Promotion of the next singer happens on the server (heartbeat / end
  // turn), never by competing client writes.

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
      let revision = session.revision;
      if (stageFree) {
        const { data, error } = await supabase.rpc("karaoke_claim_stage", { _room: roomId });
        if (error || !data) {
          toast.error("Couldn't take the stage", { description: friendly(error?.message) });
          return;
        }
        revision = (data as { revision: number }).revision;
      }
      const { data, error } = await supabase.rpc("karaoke_control", {
        _room: roomId,
        _expected_revision: revision,
        _action: "song",
        _video_id: next.videoId ?? undefined,
        _search_query: next.activeQuery ?? undefined,
      });
      if (error) {
        toast.error("Could not sync track", { description: friendly(error.message) });
        return;
      }
      if (data) applySession(data as SessionRow);
    },
    [isMyTurn, user, roomId, effectivePerformerId, bookingHostUserId, session.revision],
  );

  const onEndSong = useCallback(async () => {
    if (!isMyTurn || !user) return;
    // Server pops us off the line and atomically promotes the next singer.
    // During a booking the booked performer keeps the stage.
    const { error } = await supabase.rpc("karaoke_end_turn", {
      _room: roomId,
      _expected_generation: session.generation,
    });
    if (error) toast.error("Couldn't end the song", { description: friendly(error.message) });
  }, [isMyTurn, user, roomId, session.generation]);

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
    const { error } = await supabase.rpc("karaoke_end_turn", {
      _room: roomId,
      _expected_generation: session.generation,
    });
    if (error) {
      toast.error("Couldn't skip", { description: friendly(error.message) });
      return;
    }
    toast.success("Skipped current performer");
  }, [canForceSkip, effectivePerformerId, roomId, session.generation]);

  // ---- Queue actions (server-enforced) ----
  async function joinLine() {
    if (!user) return;
    const { error } = await supabase.rpc("karaoke_join_queue", { _room: roomId });
    if (error) {
      toast.error("Could not join the line", { description: friendly(error.message) });
      return;
    }
    void heartbeat();
  }
  async function leaveLine() {
    if (!user) return;
    const { error } = await supabase.rpc("karaoke_leave_queue", { _room: roomId });
    if (error) toast.error("Could not leave the line", { description: friendly(error.message) });
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
      // Untrack presence so others drop us from the visible line instantly.
      try {
        void channelRef.current?.untrack();
      } catch {
        /* noop */
      }
      // Server-side leave: removes our queue row and hands the stage on if
      // we were singing. Crashed tabs are recovered by the heartbeat lease.
      void supabase.rpc("karaoke_leave_queue", { _room: roomId });
    }
    // Hiding the tab (switching apps, opening a share picker) must NOT
    // release the stage, so only real page exits clean up.
    window.addEventListener("pagehide", cleanupSelf);
    window.addEventListener("beforeunload", cleanupSelf);
    window.addEventListener("baycmc:karaoke-cleanup-self", cleanupSelf);
    return () => {
      window.removeEventListener("pagehide", cleanupSelf);
      window.removeEventListener("beforeunload", cleanupSelf);
      window.removeEventListener("baycmc:karaoke-cleanup-self", cleanupSelf);
      cleanupSelf();
    };
  }, [roomId]);

  // Sign-out: if the auth user disappears while the stage is still mounted,
  // drop the row immediately — an unauthenticated viewer fails condition (1).
  useEffect(() => {
    if (user?.id) return;
    try {
      void channelRef.current?.untrack();
    } catch {
      /* noop */
    }
  }, [user?.id]);

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
