import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, GripVertical, Mic, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getBackingTrackUrl } from "@/lib/karaoke/backing.functions";
import { syncKaraokeStageMics } from "@/server/livekit.functions";
import { useAuth } from "@/lib/auth/useAuth";
import { KaraokeMusicBoard, type TrackChange } from "@/components/KaraokeMusicBoard";
import {
  DEFAULT_ROOM_SETTINGS,
  getKaraokeStage,
  patchKaraokeStage,
  resetKaraokeStage,
  type BackingTrackMeta,
  type KaraokeRoomSettings,
  type KaraokeSessionRow,
} from "@/lib/karaoke/stageStore";

interface KaraokeStageProps {
  roomId: string;
  /**
   * user_id of the active WHOLE-ROOM booking (room_bookings), if any. Used
   * only for host affordances (skip). Who is on stage is decided by the
   * server (karaoke_sessions.performer_user_id + stage_source), which already
   * accounts for reservations, bookings, mutes and the open-mic line.
   */
  bookingHostUserId: string | null;
}

const SESSION_COLUMNS =
  "performer_user_id,video_id,search_query,backing_track_id,song_title,song_artist,playback_status,position_ms,position_at,generation,revision,stage_source,reservation_id";

const EMPTY_SESSION: KaraokeSessionRow = {
  performer_user_id: null,
  video_id: null,
  search_query: null,
  backing_track_id: null,
  song_title: null,
  song_artist: null,
  playback_status: "idle",
  position_ms: 0,
  position_at: new Date(0).toISOString(),
  generation: 0,
  revision: -1,
  stage_source: "open",
  reservation_id: null,
};

function friendly(msg: string | undefined) {
  if (!msg) return "Please try again.";
  if (msg.includes("STALE_REVISION")) return "The stage just changed — try again.";
  if (msg.includes("function") && msg.includes("does not exist")) {
    return "Karaoke isn't set up on the database yet — run the karaoke v2 migration.";
  }
  return msg;
}

interface QueueRow {
  id: string;
  user_id: string;
  joined_at: string;
}
interface ReservationRow {
  id: string;
  singer_user_id: string;
  starts_at: string;
  ends_at: string;
  song_title: string | null;
}

type Profile = { id: string; username: string | null };

export function displayName(p: Profile | undefined | null, id?: string | null) {
  if (p?.username) return p.username;
  const key = p?.id ?? id ?? "";
  return key ? `Member ${key.slice(0, 4)}` : "—";
}

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Coordinates the karaoke room's shared "now playing" state and turn-taking.
 *
 * All writes go through the karaoke_* SECURITY DEFINER RPCs (see
 * supabase/migrations/20261013000001_karaoke_v2_authoritative_stage.sql);
 * this component renders server state, heart-beats presence every 15s and
 * mirrors the session into the karaoke stage store for the audio engine.
 */
export function KaraokeStage({ roomId, bookingHostUserId }: KaraokeStageProps) {
  const getBackingUrl = useServerFn(getBackingTrackUrl);
  const syncStageMics = useServerFn(syncKaraokeStageMics);
  const { user } = useAuth();
  const [session, setSession] = useState<KaraokeSessionRow>(EMPTY_SESSION);
  const applySession = useCallback((row: KaraokeSessionRow) => {
    setSession((prev) => (row.revision < prev.revision ? prev : { ...EMPTY_SESSION, ...row }));
  }, []);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [settings, setSettings] = useState<KaraokeRoomSettings>(DEFAULT_ROOM_SETTINGS);
  const [nextReservation, setNextReservation] = useState<ReservationRow | null>(null);
  const [currentReservation, setCurrentReservation] = useState<ReservationRow | null>(null);
  const [backingTrack, setBackingTrack] = useState<BackingTrackMeta | null>(null);

  const [presentIds, setPresentIds] = useState<Set<string>>(() => new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ---- Server clock skew (once) ----
  useEffect(() => {
    const t0 = Date.now();
    void supabase.rpc("karaoke_server_time").then(({ data }) => {
      if (!data) return;
      const t1 = Date.now();
      const server = new Date(data as string).getTime();
      if (Number.isFinite(server)) patchKaraokeStage({ clockOffsetMs: server - (t0 + t1) / 2 });
    });
  }, []);

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
      if (data) applySession(data as unknown as KaraokeSessionRow);
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
    async function loadSettings() {
      const { data } = await supabase
        .from("karaoke_room_settings")
        .select("*")
        .eq("room_id", roomId)
        .maybeSingle();
      if (cancelled) return;
      setSettings(
        data
          ? { ...DEFAULT_ROOM_SETTINGS, ...(data as Partial<KaraokeRoomSettings>) }
          : DEFAULT_ROOM_SETTINGS,
      );
    }
    async function loadReservations() {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from("karaoke_reservations")
        .select("id,singer_user_id,starts_at,ends_at,song_title")
        .eq("room_id", roomId)
        .eq("status", "booked")
        .gt("ends_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(2);
      if (cancelled) return;
      const rows = (data ?? []) as ReservationRow[];
      const now = Date.now();
      const cur = rows.find((r) => new Date(r.starts_at).getTime() <= now) ?? null;
      setCurrentReservation(cur);
      setNextReservation(rows.find((r) => r !== cur) ?? null);
    }
    void loadSession();
    void loadQueue();
    void loadSettings();
    void loadReservations();
    const resTimer = window.setInterval(() => void loadReservations(), 60_000);

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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "karaoke_room_settings",
          filter: `room_id=eq.${roomId}`,
        },
        () => void loadSettings(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "karaoke_reservations",
          filter: `room_id=eq.${roomId}`,
        },
        () => void loadReservations(),
      )
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState() as Record<string, Array<{ user_id?: string }>>;
        const ids = new Set<string>();
        Object.entries(state).forEach(([key, metas]) => {
          const uid = metas?.[0]?.user_id ?? key;
          if (uid && !uid.startsWith("anon-")) ids.add(uid);
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
      window.clearInterval(resTimer);
      channelRef.current = null;
      void supabase.removeChannel(ch);
    };
  }, [roomId, user?.id, applySession]);

  // ---- Heartbeat lease (presence + performer lease + server-side promotion) ----
  const heartbeat = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase.rpc("karaoke_heartbeat", { _room: roomId });
    if (error) {
      console.warn("[karaoke] heartbeat failed", error.message);
      if (error.message.includes("does not exist")) {
        toast.error("Karaoke backend missing", {
          description: friendly(error.message),
          id: "kara-missing",
        });
      }
      return;
    }
    if (data) applySession(data as unknown as KaraokeSessionRow);
  }, [roomId, user?.id, applySession]);
  useEffect(() => {
    if (!user?.id) return;
    void heartbeat();
    const t = window.setInterval(() => void heartbeat(), 15_000);
    return () => window.clearInterval(t);
  }, [heartbeat, user?.id]);

  // ---- Resolve display names ----
  useEffect(() => {
    const ids = new Set<string>();
    if (session.performer_user_id) ids.add(session.performer_user_id);
    if (nextReservation) ids.add(nextReservation.singer_user_id);
    queue.forEach((q) => ids.add(q.user_id));
    const missing = [...ids].filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("profiles").select("id,username").in("id", missing);
      if (cancelled) return;
      setProfiles((prev) => {
        const next = { ...prev };
        for (const id of missing) next[id] = { id, username: null };
        (data ?? []).forEach((p) => {
          next[p.id] = p as Profile;
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [session.performer_user_id, nextReservation, queue, profiles]);

  // Visible queue = signed in + present + in line.
  const visibleQueue = useMemo(
    () => queue.filter((q) => presentIds.has(q.user_id)),
    [queue, presentIds],
  );

  const performerId = session.performer_user_id;
  const reserved = session.stage_source !== "open";
  const isMyTurn = !!user && !!performerId && user.id === performerId;
  const meInQueue = !!user && visibleQueue.some((q) => q.user_id === user.id);

  // Karaoke rules: when the stage changes hands, re-apply the server-side
  // mic rule (only the performer may publish during a performance). The
  // server decides from the database stage state; a small jitter keeps every
  // client from hitting it at the same instant.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(
      () => void syncStageMics({ data: { roomId } }).catch(() => {}),
      performerId === user.id ? 0 : 400 + Math.random() * 1500,
    );
    return () => window.clearTimeout(t);
  }, [performerId, roomId, user, syncStageMics]);

  // ---- Backing-track metadata (+ signed URL for the performer only) ----
  useEffect(() => {
    let cancelled = false;
    const id = session.backing_track_id;
    if (!id) {
      setBackingTrack(null);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("karaoke_backing_tracks")
        .select("id,title,artist,lyrics,storage_path")
        .eq("id", id)
        .maybeSingle();
      let url: string | null = null;
      if (data && isMyTurn) {
        // Files are owner/staff-only in storage; the server signs the link.
        const signed = await getBackingUrl({ data: { trackId: id } }).catch(() => null);
        url = signed?.ok ? signed.url : null;
      }
      if (cancelled) return;
      setBackingTrack({
        id,
        title: (data?.title as string | undefined) ?? session.song_title ?? "Backing track",
        artist: (data?.artist as string | null | undefined) ?? session.song_artist ?? null,
        lyrics: (data?.lyrics as string | null | undefined) ?? null,
        url,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [session.backing_track_id, session.song_title, session.song_artist, isMyTurn]);

  // ---- Mirror into the shared store for the audio engine / UI ----
  useEffect(() => {
    patchKaraokeStage({
      roomId,
      userId: user?.id ?? null,
      isMyTurn,
      session,
      settings,
      backingTrack,
    });
  }, [roomId, user?.id, isMyTurn, session, settings, backingTrack]);
  useEffect(() => () => resetKaraokeStage(), [roomId]);

  // ---- Performer actions ----
  const onChangeTrack = useCallback(
    async (next: TrackChange) => {
      if (!user) return;
      const stageFree = !performerId;
      if (!isMyTurn && !stageFree) {
        toast.message("Someone else is on stage", {
          description: "Join the line (or book a slot) to take your turn.",
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
        _backing_track_id: next.backingTrackId ?? undefined,
        _song_title: next.title ?? undefined,
        _song_artist: next.artist ?? undefined,
      });
      if (error) {
        toast.error("Could not start the track", { description: friendly(error.message) });
        return;
      }
      if (data) applySession(data as unknown as KaraokeSessionRow);
    },
    [user, performerId, isMyTurn, roomId, session.revision, applySession],
  );

  const control = useCallback(
    async (action: "play" | "pause" | "seek" | "stop", positionMs?: number) => {
      if (!isMyTurn) return;
      const { data, error } = await supabase.rpc("karaoke_control", {
        _room: roomId,
        _expected_revision: session.revision,
        _action: action,
        _position_ms: positionMs,
      });
      if (error) {
        toast.error("Couldn't update playback", { description: friendly(error.message) });
        return;
      }
      if (data) applySession(data as unknown as KaraokeSessionRow);
    },
    [isMyTurn, roomId, session.revision, applySession],
  );

  const onEndSong = useCallback(async () => {
    if (!isMyTurn || !user) return;
    // Open mic: server pops us and promotes the next singer. Reserved slot:
    // the server just stops the song — the singer keeps the stage until the
    // slot ends.
    const { data, error } = await supabase.rpc("karaoke_end_turn", {
      _room: roomId,
      _expected_generation: session.generation,
    });
    if (error) toast.error("Couldn't end the song", { description: friendly(error.message) });
    else if (data) applySession(data as unknown as KaraokeSessionRow);
  }, [isMyTurn, user, roomId, session.generation, applySession]);

  // Uploaded backing track reached its end → finish the song automatically.
  useEffect(() => {
    function onEnded() {
      void onEndSong();
    }
    window.addEventListener("karaoke:backing-ended", onEnded);
    return () => window.removeEventListener("karaoke:backing-ended", onEnded);
  }, [onEndSong]);

  // ---- Moderator force-skip ----
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
    !!performerId &&
    performerId !== user.id &&
    (isAdmin || (bookingHostUserId ? bookingHostUserId === user.id : false));

  const forceSkip = useCallback(async () => {
    if (!canForceSkip) return;
    const { error } = await supabase.rpc("karaoke_end_turn", {
      _room: roomId,
      _expected_generation: session.generation,
    });
    if (error) {
      toast.error("Couldn't skip", { description: friendly(error.message) });
      return;
    }
    toast.success("Skipped current performer");
  }, [canForceSkip, roomId, session.generation]);

  // ---- Queue actions (server-enforced) ----
  async function joinLine() {
    if (!user) return;
    // You can only sing if you're connected to the room's audio.
    if (!getKaraokeStage().engineMounted) window.dispatchEvent(new Event("karaoke:request-join"));
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

  // Leave the line / release an open-mic stage on real page exits. Hiding
  // the tab must NOT release the stage; crashed tabs are recovered by the
  // 45s heartbeat lease on the server.
  const userIdRef = useRef<string | null>(user?.id ?? null);
  userIdRef.current = user?.id ?? null;
  useEffect(() => {
    function cleanupSelf() {
      if (!userIdRef.current) return;
      try {
        void channelRef.current?.untrack();
      } catch {
        /* noop */
      }
      void supabase.rpc("karaoke_leave_queue", { _room: roomId });
    }
    window.addEventListener("pagehide", cleanupSelf);
    window.addEventListener("baycmc:karaoke-cleanup-self", cleanupSelf);
    return () => {
      window.removeEventListener("pagehide", cleanupSelf);
      window.removeEventListener("baycmc:karaoke-cleanup-self", cleanupSelf);
      cleanupSelf();
    };
  }, [roomId]);

  useEffect(() => {
    if (user?.id) return;
    try {
      void channelRef.current?.untrack();
    } catch {
      /* noop */
    }
  }, [user?.id]);

  const performerName = performerId ? displayName(profiles[performerId], performerId) : "—";

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

  const paused = session.playback_status === "paused";
  const hasSong = !!session.video_id || !!session.backing_track_id;
  const isPlaying = hasSong && !paused;
  const [forceWaitlistVisible, setForceWaitlistVisible] = useState(false);
  // Each new turn / song starts tucked away again for the singer.
  useEffect(() => {
    setForceWaitlistVisible(false);
  }, [isPlaying, isMyTurn]);
  // Hide/reveal applies ONLY to the singer whose turn it is (so the list stays
  // out of their way while they perform). Everyone else always sees the
  // waiting list; they can only drag it somewhere else.
  const singerMode = isMyTurn && isPlaying;
  const waitlistHidden = singerMode && !forceWaitlistVisible;

  const resetAllPanels = useCallback(() => {
    setPos({ dx: 0, dy: 0 });
    setForceWaitlistVisible(true);
    window.dispatchEvent(new CustomEvent("karaoke:reset-panels"));
  }, []);
  useEffect(() => {
    window.addEventListener("karaoke:request-reset-panels", resetAllPanels);
    return () => window.removeEventListener("karaoke:request-reset-panels", resetAllPanels);
  }, [resetAllPanels]);

  const myQueuePosition = isMyTurn
    ? 0
    : (() => {
        if (!user) return null;
        const idx = visibleQueue.findIndex((q) => q.user_id === user.id);
        if (idx < 0) return null;
        return performerId && performerId !== user.id ? idx + 1 : idx;
      })();

  return (
    <>
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
          {singerMode && !waitlistHidden && (
            <button
              type="button"
              aria-label="Hide waiting list"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setForceWaitlistVisible(false)}
              className="ml-auto rounded-sm px-1 text-gold/70 hover:bg-gold/10 hover:text-gold"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="p-3 pt-2">
          <div className="mt-1 truncate text-sm font-semibold text-foreground">
            {performerId ? performerName : "Nobody — first in line goes up"}
            {reserved && (
              <span className="ml-1 rounded-sm bg-gold/15 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-gold">
                {session.stage_source === "reservation" ? "Reserved" : "Booked"}
              </span>
            )}
          </div>
          {(session.song_title || backingTrack?.title) && hasSong && (
            <p className="truncate text-[11px] text-muted-foreground">
              ♪ {session.song_title ?? backingTrack?.title}
              {session.song_artist ? ` · ${session.song_artist}` : ""}
            </p>
          )}
          {currentReservation && reserved && (
            <p className="mt-1 text-[10px] text-gold/80">
              Slot ends {hhmm(currentReservation.ends_at)}
            </p>
          )}
          {canForceSkip && (
            <button
              type="button"
              onClick={forceSkip}
              className="mt-2 w-full rounded-sm border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-200 hover:bg-amber-400/20"
            >
              Skip performer →
            </button>
          )}

          {!reserved && (
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
                    disabled={!user || isMyTurn || settings.require_booking}
                    onClick={joinLine}
                    title={settings.require_booking ? "This room is booking-only" : undefined}
                    className="rounded-sm bg-gradient-gold px-2 py-0.5 text-[10px] font-semibold text-gold-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Join line
                  </button>
                )}
              </div>
              {visibleQueue.length > 0 && (
                <ol className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                  {visibleQueue.slice(0, 6).map((q, i) => (
                    <li key={q.id} className="flex justify-between">
                      <span>
                        {i + 1}. {displayName(profiles[q.user_id], q.user_id)}
                      </span>
                      {user?.id === q.user_id && <span className="text-gold/70">you</span>}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                {settings.require_booking
                  ? "Booking-only room — reserve a slot in the Room hub."
                  : `One song per turn${settings.max_song_seconds ? ` (max ${Math.round(settings.max_song_seconds / 60)} min)` : ""}. The line auto-advances.`}
              </p>
            </>
          )}
          {nextReservation && (
            <p className="mt-2 flex items-center gap-1 text-[10px] text-gold/80">
              <CalendarClock className="h-3 w-3" />
              Next booked:{" "}
              {displayName(
                profiles[nextReservation.singer_user_id],
                nextReservation.singer_user_id,
              )}{" "}
              · {hhmm(nextReservation.starts_at)}
            </p>
          )}
        </div>
      </div>

      <KaraokeMusicBoard
        roomId={roomId}
        isMyTurn={isMyTurn}
        session={session}
        settings={settings}
        backingTrack={backingTrack}
        onChangeTrack={onChangeTrack}
        onControl={control}
        onEndSong={onEndSong}
        performerName={performerId ? performerName : null}
        myQueuePosition={myQueuePosition}
        reserved={reserved}
      />
    </>
  );
}
