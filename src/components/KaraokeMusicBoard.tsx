import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  GripVertical,
  Headphones,
  Loader2,
  Lock,
  Maximize2,
  Mic,
  MicOff,
  Music,
  Pause,
  Play,
  Search,
  Speaker,
  Square,
  Volume2,
  X,
} from "lucide-react";
import {
  reportUnplayableVideo,
  resolveKaraokeSong,
  searchKaraokeSongs,
  type SongHit,
} from "@/lib/karaoke.functions";
import { unlockKaraokeAudio } from "@/lib/karaoke/audioMixBus";
import {
  livePositionMs,
  patchKaraokeStage,
  useKaraokeStage,
  type BackingTrackMeta,
  type KaraokeRoomSettings,
  type KaraokeSessionRow,
} from "@/lib/karaoke/stageStore";
import { KaraokeTrackLibrary } from "@/components/karaoke/KaraokeTrackLibrary";
import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";

// Average karaoke song length, used to estimate ETA from a queue position.
const AVG_SONG_SECONDS = 240;
function formatEta(position: number): string {
  const secs = position * AVG_SONG_SECONDS;
  if (secs < 60) return `${secs}s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface TrackChange {
  videoId: string | null;
  backingTrackId?: string | null;
  title?: string | null;
  artist?: string | null;
}

interface KaraokeMusicBoardProps {
  roomId: string;
  isMyTurn: boolean;
  session: KaraokeSessionRow;
  settings: KaraokeRoomSettings;
  backingTrack: BackingTrackMeta | null;
  onChangeTrack: (next: TrackChange) => void;
  onControl: (action: "play" | "pause" | "seek" | "stop", positionMs?: number) => void;
  onEndSong?: () => void;
  performerName?: string | null;
  myQueuePosition?: number | null;
  reserved?: boolean;
}

function extractYouTubeId(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(t)) return t;
  try {
    const u = new URL(t);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace(/^\//, "").slice(0, 11);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v.slice(0, 11))) return v.slice(0, 11);
    const parts = u.pathname.split("/").filter(Boolean);
    const i = parts.findIndex((p) => p === "embed" || p === "shorts");
    if (i >= 0 && parts[i + 1]) {
      const id = parts[i + 1].slice(0, 11);
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

const PADS: { label: string; query: string; hue: string }[] = [
  { label: "Pop Hits", query: "pop karaoke hits", hue: "from-rose-400 to-rose-600" },
  { label: "80s", query: "80s karaoke", hue: "from-fuchsia-400 to-fuchsia-600" },
  { label: "90s", query: "90s karaoke", hue: "from-pink-400 to-pink-600" },
  { label: "2000s", query: "2000s karaoke", hue: "from-red-400 to-red-600" },
  { label: "R&B", query: "rnb karaoke", hue: "from-amber-300 to-amber-500" },
  { label: "Hip-Hop", query: "hip hop karaoke", hue: "from-yellow-300 to-yellow-500" },
  { label: "Rock", query: "rock karaoke classics", hue: "from-lime-300 to-lime-500" },
  { label: "Country", query: "country karaoke", hue: "from-emerald-300 to-emerald-500" },
  { label: "Latin", query: "latin karaoke", hue: "from-teal-300 to-teal-500" },
  { label: "Disney", query: "disney karaoke", hue: "from-cyan-300 to-cyan-500" },
  { label: "Duets", query: "duet karaoke", hue: "from-sky-300 to-sky-500" },
  { label: "Ballads", query: "power ballad karaoke", hue: "from-blue-400 to-blue-600" },
  { label: "Sinatra", query: "frank sinatra karaoke", hue: "from-indigo-400 to-indigo-600" },
  { label: "Beyoncé", query: "beyonce karaoke", hue: "from-violet-400 to-violet-600" },
  { label: "Drake", query: "drake karaoke", hue: "from-purple-400 to-purple-600" },
  { label: "Trending", query: "trending karaoke", hue: "from-pink-500 to-rose-600" },
];

/**
 * Karaoke "Maschine"-style music machine.
 *
 * Two sources:
 *   - YouTube (search / paste): the video is the lyric screen for everyone,
 *     started at the server's live position so late joiners are in sync. On
 *     desktop the singer can put the tab audio INTO their mix; listeners
 *     then mute their local copy and hear one synced stream.
 *   - My tracks (uploaded instrumentals): mixed with the voice on the
 *     singer's device — the path that works on phones.
 */
export function KaraokeMusicBoard({
  roomId: _roomId,
  isMyTurn,
  session,
  settings,
  backingTrack,
  onChangeTrack,
  onControl,
  onEndSong,
  performerName = null,
  myQueuePosition = null,
  reserved = false,
}: KaraokeMusicBoardProps) {
  const stage = useKaraokeStage();
  const videoId = session.video_id;
  const hasBacking = !!session.backing_track_id;
  const hasSong = !!videoId || hasBacking;
  const paused = session.playback_status === "paused";

  const [open, setOpen] = useState(false);
  const [forceExpanded, setForceExpanded] = useState(false);
  const isPlaying = hasSong && !paused;
  const minimized = isPlaying && !forceExpanded;
  useEffect(() => {
    if (!hasSong) setForceExpanded(false);
  }, [hasSong]);
  // Pop the machine open for the singer when their turn starts.
  useEffect(() => {
    if (isMyTurn) setOpen(true);
  }, [isMyTurn]);

  const [tab, setTab] = useState<"youtube" | "tracks">(
    settings.allow_youtube ? "youtube" : "tracks",
  );
  useEffect(() => {
    if (!settings.allow_youtube && tab === "youtube") setTab("tracks");
    if (!settings.allow_uploads && tab === "tracks") setTab("youtube");
  }, [settings.allow_youtube, settings.allow_uploads, tab]);

  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<SongHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSource, setSearchSource] = useState<"catalog" | "web" | null>(null);
  const runSongSearch = useServerFn(searchKaraokeSongs);

  // ── YouTube player sync ────────────────────────────────────────────────
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const ytTimeRef = useRef<number | null>(null);
  function postToPlayer(func: string, args: (string | number | boolean)[] = []) {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(JSON.stringify({ event: "command", func, args }), "https://www.youtube.com");
  }
  // Start offset is fixed ONCE per song and baked into the iframe URL.
  // It used to be stored with setState in an effect, which changed the URL
  // a moment after the video started → the iframe reloaded, and on iPhone a
  // reloaded YouTube embed cannot autoplay without a new tap: the music
  // started, then immediately stopped.
  const songKey = videoId ? `${videoId}:${session.generation}` : null;
  const startSec = useMemo(() => {
    if (!videoId) return 0;
    const s = Math.floor(livePositionMs(session) / 1000);
    return s < 3 ? 0 : s; // a fresh song starts at 0:00
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songKey]);
  const ytStateRef = useRef<number | null>(null); // YT: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
  const [needsTap, setNeedsTap] = useState(false);
  // YouTube refused to play this video outside youtube.com (errors 101/150)
  // or the video is gone (100) — the player can never start it.
  const [embedBlocked, setEmbedBlocked] = useState(false);
  const reportUnplayable = useServerFn(reportUnplayableVideo);
  useEffect(() => {
    ytTimeRef.current = null;
    ytStateRef.current = null;
    setNeedsTap(false);
    setEmbedBlocked(false);
  }, [songKey]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== "https://www.youtube.com" || typeof e.data !== "string") return;
      try {
        const d = JSON.parse(e.data) as {
          event?: string;
          info?: { currentTime?: number; playerState?: number } | number;
        };
        if (d.event === "infoDelivery" && d.info && typeof d.info === "object") {
          if (typeof d.info.currentTime === "number") ytTimeRef.current = d.info.currentTime;
          if (typeof d.info.playerState === "number") ytStateRef.current = d.info.playerState;
        } else if (d.event === "onStateChange" && typeof d.info === "number") {
          ytStateRef.current = d.info;
        } else if (d.event === "onError" && typeof d.info === "number") {
          if ([100, 101, 150, 2, 5].includes(d.info)) setEmbedBlocked(true);
        }
        if (ytStateRef.current === 1) setNeedsTap(false);
      } catch {
        /* not ours */
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Tell the server (it re-checks with YouTube) so this video stops being
  // offered to anyone.
  useEffect(() => {
    if (embedBlocked && videoId)
      void reportUnplayable({ data: { videoId } }).catch(() => undefined);
  }, [embedBlocked, videoId, reportUnplayable]);

  // Follow the server's play / pause (only when it actually changes).
  useEffect(() => {
    if (!videoId) return;
    postToPlayer(paused ? "pauseVideo" : "playVideo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, videoId]);

  // Watchdog: the server says "playing" but the player sits paused/unstarted
  // (iOS interrupted it, autoplay blocked) → nudge it, then ask for one tap.
  // Listeners also correct drift > 4 s. The singer's own player is the
  // reference, so it is never seeked.
  useEffect(() => {
    if (!videoId || paused) return;
    let nudges = 0;
    const t = window.setInterval(() => {
      const st = ytStateRef.current;
      if (st === 2 || st === -1 || st === 5 || st === null) {
        if (nudges < 2) {
          nudges++;
          postToPlayer("playVideo");
        } else {
          setNeedsTap(true);
        }
      } else {
        nudges = 0;
      }
      if (!isMyTurn && st === 1) {
        const target = livePositionMs(session) / 1000;
        if (ytTimeRef.current !== null && Math.abs(ytTimeRef.current - target) > 4) {
          postToPlayer("seekTo", [target, true]);
        }
      }
    }, 2500);
    return () => window.clearInterval(t);
  }, [videoId, paused, session, isMyTurn]);

  // Listeners mute their local YouTube copy whenever the singer's mix already
  // contains the music — they hear it once, in sync with the voice.
  const muteLocal = !isMyTurn && stage.performerMusicInMix;
  useEffect(() => {
    if (!videoId) return;
    postToPlayer(muteLocal ? "mute" : "unMute");
    if (!muteLocal) postToPlayer("setVolume", [Math.round(stage.musicVolume * 100)]);
  }, [muteLocal, videoId, stage.musicVolume]);

  // ── Live position for the backing-track screen ─────────────────────────
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!hasSong || paused) return;
    const t = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [hasSong, paused]);
  const positionMs = isMyTurn && hasBacking ? stage.backingPositionMs : livePositionMs(session);

  // ── Mic: the SAME switch as the room's bottom-bar Mic button ───────────
  // prefs.micEnabled is shared by every mic control. Audience → the room bar
  // applies it to their LiveKit mic; singer → the mix engine puts the voice
  // on air. Previously this button kept its own state and drifted out of
  // sync with the bottom bar.
  const { prefs: roomPrefs, setPrefs: setRoomPrefs } = useRoomPreferences();
  const micOn = roomPrefs.micEnabled;
  function toggleMic() {
    if (isMyTurn) unlockKaraokeAudio(); // resume AudioContext inside the tap (iOS)
    setRoomPrefs({ micEnabled: !micOn });
  }
  function shareTabAudio() {
    // dispatchEvent is synchronous → getDisplayMedia runs inside this click.
    window.dispatchEvent(
      new Event(stage.musicInMyMix ? "karaoke:unpublish-music" : "karaoke:publish-music"),
    );
  }

  // ── Search ─────────────────────────────────────────────────────────────
  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const res = await runSongSearch({ data: { query: trimmed } });
      setResults(res.hits);
      setSearchSource(res.source);
      if (res.hits.length === 0)
        setSearchError("No tracks found. Try a different title or artist.");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }
  const resolveSong = useServerFn(resolveKaraokeSong);
  async function pickHit(hit: SongHit) {
    let id = hit.youtubeId ?? (hit.url ? extractYouTubeId(hit.url) : null);
    if (!id && hit.source === "catalog" && hit.id) {
      setSearching(true);
      try {
        const res = await resolveSong({ data: { songId: hit.id } });
        if (!res.ok) {
          setSearchError(res.error);
          return;
        }
        id = res.youtubeId;
      } finally {
        setSearching(false);
      }
    }
    if (id) onChangeTrack({ videoId: id, title: hit.title, artist: hit.artist });
    setResults(null);
  }
  function playUrl() {
    const id = extractYouTubeId(urlInput);
    if (id) onChangeTrack({ videoId: id });
  }

  // ── Drag ───────────────────────────────────────────────────────────────
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
    setPos({ dx: baseDx - (e.clientX - startX), dy: baseDy - (e.clientY - startY) });
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
  useEffect(() => {
    function onReset() {
      setOpen(true);
      setForceExpanded(true);
      setPos({ dx: 0, dy: 0 });
    }
    window.addEventListener("karaoke:reset-panels", onReset);
    return () => window.removeEventListener("karaoke:reset-panels", onReset);
  }, []);

  // ── One-time "scroll for more" hint ───────────────────────────────────
  // Each time the player changes size (playing ⇄ choosing music) and its
  // content no longer fits, a down-arrow slides once beside the player —
  // on the side facing the middle of the screen — then disappears.
  // (Hooks must stay ABOVE the early "closed" return below — placing them
  // after it crashed the room with "Rendered more hooks…" on open.)
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [scrollHint, setScrollHint] = useState<{
    x: number;
    y: number;
    side: "left" | "right";
    n: number;
  } | null>(null);
  const sizeMode = `${minimized ? "mini" : "full"}-${hasSong ? "song" : "pick"}`;
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    // Wait for the width transition / content swap to settle.
    const t = window.setTimeout(() => {
      if (el.scrollHeight - el.clientHeight < 8) return;
      const r = el.getBoundingClientRect();
      const onRight = r.left + r.width / 2 > window.innerWidth / 2;
      setScrollHint((prev) => ({
        side: onRight ? "left" : "right",
        x: onRight ? r.left - 30 : r.right + 6,
        y: r.top + r.height / 2 - 30,
        n: (prev?.n ?? 0) + 1,
      }));
    }, 400);
    return () => window.clearTimeout(t);
  }, [sizeMode, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setPos({ dx: 0, dy: 0 });
          setOpen(true);
        }}
        aria-label="Open music machine"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8.5rem)" }}
        className="group fixed left-1/2 z-50 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-gold/60 bg-background/80 px-3 py-1.5 text-[11px] font-semibold text-gold shadow-gold backdrop-blur transition hover:bg-gold/10"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-gold/60 animate-ping"
        />
        <Music className="relative h-3.5 w-3.5 animate-pulse" />
        <span className="relative">Karaoke Machine</span>
      </button>
    );
  }

  const ytParams = `autoplay=1&rel=0&modestbranding=1&enablejsapi=1&playsinline=1&start=${startSec}&origin=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.origin : "",
  )}`;
  const screenSrc = videoId ? `https://www.youtube.com/embed/${videoId}?${ytParams}` : null;
  const songTitle = session.song_title ?? backingTrack?.title ?? null;
  const durationMs = isMyTurn && hasBacking ? stage.backingDurationMs : 0;

  function handleStop() {
    postToPlayer("stopVideo");
    onChangeTrack({ videoId: null });
  }
  function handlePause() {
    if (!paused) onControl("pause");
    else {
      unlockKaraokeAudio();
      onControl("play");
    }
  }

  const btn =
    "inline-flex items-center gap-1 rounded-sm border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40";

  // Size is locked to the compact player (header, screen, transport, mix
  // sliders). Anything more — song search, queue, add-music — scrolls
  // vertically inside the player instead of growing it.
  return (
    <>
      {scrollHint && (
        <div
          key={scrollHint.n}
          aria-hidden
          onAnimationEnd={() => setScrollHint(null)}
          className="kara-scroll-hint pointer-events-none fixed z-50 flex h-6 w-6 items-center justify-center rounded-full border border-gold/60 bg-black/80 text-gold shadow-gold"
          style={{
            left: Math.max(4, Math.min(window.innerWidth - 28, scrollHint.x)),
            top: scrollHint.y,
          }}
        >
          <ChevronDown className="h-4 w-4" />
        </div>
      )}
      <div
        ref={panelRef}
        className={`fixed bottom-4 right-4 z-40 max-h-[min(85vh,25.5rem)] touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-gold/40 bg-[#0a0a0a] shadow-gold transition-[width] duration-300 ${
          minimized ? "w-[min(96vw,18rem)]" : "w-[min(96vw,22rem)]"
        }`}
        style={{ transform: `translate(${-pos.dx}px, ${-pos.dy}px)` }}
      >
        {/* Chassis bar / drag handle */}
        <div
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          className="sticky top-0 z-10 flex cursor-grab touch-none select-none items-center justify-between border-b border-gold/20 bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] px-2 py-1.5 active:cursor-grabbing"
        >
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-3 w-3 text-gold/60" />
            <span className="font-display text-[9px] uppercase tracking-[0.25em] text-gold">
              Karaoke Machine
            </span>
            {stage.recording && (
              <span className="rounded-sm bg-destructive/20 px-1 text-[7px] font-bold uppercase text-destructive">
                ● Rec
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isMyTurn ? (
              <span className="rounded-sm bg-emerald-500/20 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wider text-emerald-300">
                Your Turn
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/15 px-1 py-0.5 text-[7px] font-bold uppercase tracking-wider text-amber-300">
                <Lock className="h-2 w-2" /> Locked
              </span>
            )}
            {hasSong && (
              <button
                type="button"
                aria-label={minimized ? "Expand music machine" : "Collapse music machine"}
                onClick={() => setForceExpanded((v) => !v)}
                className="rounded-md p-0.5 text-gold/70 transition hover:bg-gold/10 hover:text-gold"
              >
                <Maximize2 className="h-2.5 w-2.5" />
              </button>
            )}
            <button
              type="button"
              aria-label="Close music machine"
              onClick={() => setOpen(false)}
              className="rounded-md p-0.5 text-gold/70 transition hover:bg-gold/10 hover:text-gold"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Turn status */}
        <div className="flex items-center justify-between gap-2 border-b border-gold/15 bg-[#0a0a0a] px-2 py-1 text-[8px] uppercase tracking-wider text-gold/70">
          <span className="min-w-0 truncate">
            <span className="text-gold/50">Now:</span>{" "}
            <span className="text-gold">{performerName ?? "Stage open"}</span>
            {reserved && <span className="ml-1 text-gold/50">(reserved)</span>}
          </span>
          <span className="shrink-0 text-right">
            {myQueuePosition === 0 ? (
              <span className="text-emerald-300">You're up</span>
            ) : myQueuePosition && myQueuePosition > 0 ? (
              <>
                <span className="text-gold/50">You:</span>{" "}
                <span className="text-gold">#{myQueuePosition}</span>
                <span className="ml-1 text-gold/70">~{formatEta(myQueuePosition)}</span>
              </>
            ) : (
              <span className="text-gold/40">Not in line</span>
            )}
          </span>
        </div>

        {isMyTurn && !stage.engineMounted && (
          <div className="border-b border-amber-400/30 bg-amber-500/10 p-2 text-[10px] text-amber-200">
            You're up, but you're not connected to the room audio.
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("karaoke:request-join"))}
              className="ml-2 rounded-sm border border-amber-300/50 px-2 py-0.5 font-semibold"
            >
              Connect
            </button>
          </div>
        )}

        {/* Screen */}
        <div className="border-b border-gold/10 bg-[#050505] p-1.5">
          <div className="aspect-video overflow-hidden rounded-sm border border-gold/20 bg-black">
            {screenSrc ? (
              <iframe
                ref={iframeRef}
                key={songKey ?? "none"}
                src={screenSrc}
                title="Karaoke screen"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                onLoad={() => {
                  // Ask the player to stream currentTime back (drift correction).
                  const w = iframeRef.current?.contentWindow;
                  w?.postMessage(
                    JSON.stringify({ event: "listening", id: "kara", channel: "widget" }),
                    "https://www.youtube.com",
                  );
                  w?.postMessage(
                    JSON.stringify({
                      event: "command",
                      func: "addEventListener",
                      args: ["onStateChange"],
                      id: "kara",
                      channel: "widget",
                    }),
                    "https://www.youtube.com",
                  );
                  w?.postMessage(
                    JSON.stringify({
                      event: "command",
                      func: "addEventListener",
                      args: ["onError"],
                      id: "kara",
                      channel: "widget",
                    }),
                    "https://www.youtube.com",
                  );
                  if (muteLocal) postToPlayer("mute");
                }}
                className="h-full w-full"
              />
            ) : hasBacking ? (
              <div className="flex h-full w-full flex-col p-2">
                <div className="truncate font-display text-[10px] text-gold">
                  ♪ {songTitle}
                  {(session.song_artist ?? backingTrack?.artist) && (
                    <span className="text-gold/60">
                      {" "}
                      · {session.song_artist ?? backingTrack?.artist}
                    </span>
                  )}
                </div>
                <div className="mt-1 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-[10px] leading-snug text-gold/80">
                  {backingTrack?.lyrics ||
                    (isMyTurn
                      ? "Sing it! (Add lyrics when uploading to show them here.)"
                      : "Live performance")}
                </div>
                <div className="mt-1 flex items-center gap-1 text-[8px] text-gold/50">
                  <span>{clock(positionMs)}</span>
                  {durationMs > 0 && (
                    <>
                      <div className="h-0.5 flex-1 overflow-hidden rounded bg-gold/15">
                        <div
                          className="h-full bg-gold"
                          style={{ width: `${Math.min(100, (positionMs / durationMs) * 100)}%` }}
                        />
                      </div>
                      <span>{clock(durationMs)}</span>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[8px] uppercase tracking-widest text-gold/40">
                {isMyTurn ? "Pick a song below" : "No track"}
              </div>
            )}
          </div>
          {videoId && ((!paused && needsTap) || embedBlocked) && (
            <p
              role="alert"
              key={`${songKey}-${embedBlocked ? "blocked" : "paused"}`}
              className="kara-alert mt-1 rounded-sm border border-amber-400/70 bg-amber-500/15 px-2 py-1.5 text-[9px] font-semibold leading-snug text-amber-200"
            >
              Your browser paused the playback of this music. This track is not available for
              playback outside of YouTube. Please select another track to continue your performance.
            </p>
          )}
          {!isMyTurn && videoId && !muteLocal && (
            <p className="mt-1 text-[8px] leading-snug text-amber-200/70">
              Music is playing from your own device — the singer hasn't shared their track, so it
              may not line up perfectly with their voice.
            </p>
          )}
        </div>

        {/* Transport */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 border-b border-gold/10 bg-[#0a0a0a] px-2 py-2">
          {hasSong && (
            <>
              <button
                type="button"
                onClick={handlePause}
                disabled={!isMyTurn}
                className={`${btn} border-gold/40 bg-gold/10 text-gold hover:bg-gold/20`}
              >
                {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                {paused ? "Play" : "Pause"}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={!isMyTurn}
                className={`${btn} border-rose-400/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20`}
              >
                <Square className="h-3 w-3" /> Stop
              </button>
            </>
          )}
          <button
            type="button"
            onClick={toggleMic}
            className={`${btn} ${
              micOn
                ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                : "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
            }`}
          >
            {micOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
            {isMyTurn
              ? micOn
                ? stage.engineLive
                  ? "On air"
                  : "Starting…"
                : "Go live"
              : micOn
                ? "Mic on"
                : "Mic off"}
          </button>
          {isMyTurn && (
            <button
              type="button"
              onClick={() => patchKaraokeStage({ headphones: !stage.headphones })}
              title={
                stage.headphones
                  ? "Headphones mode: studio-quality mic. Switch to speaker mode if you're not wearing headphones."
                  : "Speaker mode: echo cancellation on so the music isn't picked up twice."
              }
              className={`${btn} border-gold/40 bg-gold/10 text-gold hover:bg-gold/20`}
            >
              {stage.headphones ? (
                <Headphones className="h-3 w-3" />
              ) : (
                <Speaker className="h-3 w-3" />
              )}
              {stage.headphones ? "Headphones" : "Speaker"}
            </button>
          )}
          {isMyTurn && videoId && (
            <button
              type="button"
              onClick={shareTabAudio}
              title="Desktop: puts this tab's YouTube audio into your mix so the room hears music + voice in sync"
              className={`${btn} ${
                stage.musicInMyMix
                  ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-300"
                  : "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
              }`}
            >
              <Music className="h-3 w-3" />
              {stage.musicInMyMix ? "Music in mix" : "Add music to mix"}
            </button>
          )}
        </div>

        {isMyTurn && (
          <div className="grid grid-cols-2 gap-3 border-b border-gold/10 bg-[#0a0a0a] px-3 py-2">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-gold/70">
                <Music className="h-2.5 w-2.5" /> Music · {Math.round(stage.musicVolume * 100)}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(stage.musicVolume * 100)}
                onChange={(e) => patchKaraokeStage({ musicVolume: Number(e.target.value) / 100 })}
                aria-label="Music volume"
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-gold/20 accent-gold"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-gold/70">
                <Volume2 className="h-2.5 w-2.5" /> Voice · {Math.round(stage.micVolume * 100)}
              </span>
              <input
                type="range"
                min={0}
                max={150}
                value={Math.round(stage.micVolume * 100)}
                onChange={(e) => patchKaraokeStage({ micVolume: Number(e.target.value) / 100 })}
                aria-label="Voice volume"
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-gold/20 accent-emerald-400"
              />
            </label>
          </div>
        )}

        {!minimized && (
          <>
            {/* Source tabs */}
            <div className="flex border-b border-gold/10 bg-[#0a0a0a] text-[9px] uppercase tracking-widest">
              {settings.allow_youtube && (
                <button
                  type="button"
                  onClick={() => setTab("youtube")}
                  className={`flex-1 py-1.5 ${tab === "youtube" ? "bg-gold/15 text-gold" : "text-gold/50 hover:text-gold"}`}
                >
                  YouTube
                </button>
              )}
              {settings.allow_uploads && (
                <button
                  type="button"
                  onClick={() => setTab("tracks")}
                  className={`flex-1 py-1.5 ${tab === "tracks" ? "bg-gold/15 text-gold" : "text-gold/50 hover:text-gold"}`}
                >
                  My tracks
                </button>
              )}
            </div>

            {tab === "youtube" && settings.allow_youtube ? (
              <>
                <div className="space-y-1 border-b border-gold/10 bg-[#0a0a0a] p-2">
                  <div className="flex gap-1">
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={!isMyTurn}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isMyTurn) void runSearch(query);
                      }}
                      placeholder={isMyTurn ? "Search song or artist…" : "Locked — wait your turn"}
                      className="flex-1 rounded-sm border border-gold/20 bg-black/60 px-1.5 py-1 text-[9px] text-gold placeholder:text-gold/30 outline-none focus:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => void runSearch(query)}
                      disabled={!isMyTurn || !query.trim() || searching}
                      className="inline-flex items-center gap-0.5 rounded-sm bg-gradient-gold px-1.5 py-1 text-[8px] font-semibold text-gold-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {searching ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Search className="h-2.5 w-2.5" />
                      )}{" "}
                      Find
                    </button>
                  </div>
                  {(results !== null || searchError) && (
                    <div className="max-h-40 overflow-y-auto rounded-sm border border-gold/20 bg-black/50 p-1 text-[8px]">
                      {searchSource && results && results.length > 0 && (
                        <div className="px-1 pb-1 text-[7px] uppercase tracking-widest text-gold/50">
                          {searchSource === "catalog" ? "From music machine" : "From the web"}
                        </div>
                      )}
                      {results?.map((h, i) => (
                        <button
                          key={`${h.id ?? h.url ?? i}`}
                          type="button"
                          onClick={() => void pickHit(h)}
                          disabled={
                            !h.youtubeId &&
                            !extractYouTubeId(h.url ?? "") &&
                            !(h.source === "catalog" && h.id)
                          }
                          className="flex w-full items-center justify-between gap-1 rounded-sm px-1.5 py-1 text-left text-gold/90 hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span className="truncate">
                            <span className="font-semibold">{h.title}</span>
                            {h.artist && <span className="text-gold/60"> · {h.artist}</span>}
                          </span>
                          <Play className="h-2 w-2 shrink-0 text-gold/70" />
                        </button>
                      ))}
                      {searchError && <div className="px-1 py-1 text-rose-300">{searchError}</div>}
                    </div>
                  )}
                  <div className="flex gap-1">
                    <input
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      disabled={!isMyTurn}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isMyTurn) playUrl();
                      }}
                      placeholder={isMyTurn ? "…or paste YouTube link" : "Locked — wait your turn"}
                      className="flex-1 rounded-sm border border-gold/10 bg-black/40 px-1.5 py-1 text-[8px] text-gold placeholder:text-gold/30 outline-none focus:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={playUrl}
                      disabled={!isMyTurn || !extractYouTubeId(urlInput)}
                      className="inline-flex items-center gap-0.5 rounded-sm border border-gold/30 bg-black/60 px-1.5 py-1 text-[8px] font-semibold text-gold hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Play className="h-2.5 w-2.5" /> Cue
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1 bg-[#050505] p-2">
                  {PADS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => void runSearch(p.query)}
                      disabled={!isMyTurn}
                      className={`relative aspect-square rounded-sm bg-gradient-to-br ${p.hue} text-[6px] font-bold uppercase leading-tight text-black/85 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40`}
                    >
                      <span className="absolute inset-0 flex items-center justify-center px-0.5 text-center">
                        {p.label}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : settings.allow_uploads ? (
              <div className="bg-[#0a0a0a] p-2">
                <KaraokeTrackLibrary
                  compact
                  canPlay={isMyTurn}
                  onPlay={(t) =>
                    onChangeTrack({
                      videoId: null,
                      backingTrackId: t.id,
                      title: t.title,
                      artist: t.artist,
                    })
                  }
                />
              </div>
            ) : null}

            {isMyTurn && onEndSong && (
              <div className="border-t border-gold/10 bg-[#0a0a0a] p-2">
                <button
                  type="button"
                  onClick={onEndSong}
                  className="w-full rounded-sm border border-rose-500/40 bg-rose-500/10 px-1.5 py-1 text-[8px] font-semibold uppercase tracking-wider text-rose-300 hover:bg-rose-500/20"
                >
                  {reserved ? "End song (keep my slot)" : "End song · Next performer"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
