import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { GripVertical, Loader2, Lock, Music, Play, Search, X } from "lucide-react";
import { searchKaraokeSongs, type SongHit } from "@/lib/karaoke.functions";

interface KaraokeMusicBoardProps {
  /**
   * True only for the user who is currently the active performer (either
   * the booking owner, or the front of the waiting line when nobody booked
   * the room). When false the entire machine is render-locked.
   */
  isMyTurn: boolean;
  /** Current synchronized track state — comes from karaoke_sessions. */
  videoId: string | null;
  activeQuery: string | null;
  /**
   * Called only when isMyTurn — performer-driven changes write to
   * karaoke_sessions so every other viewer sees the same screen.
   */
  onChangeTrack: (next: { videoId: string | null; activeQuery: string | null }) => void;
  /** Called only when isMyTurn — finishes the song and yields the stage. */
  onEndSong?: () => void;
}

/**
 * Karaoke "Maschine"-style music machine.
 *
 * Sized 40% smaller than the original chassis and slides anywhere on the
 * screen via the gold drag handle so the audience video stays visible.
 *
 * `videoId` / `activeQuery` are CONTROLLED by the parent (KaraokeStage)
 * so every viewer renders the same screen in real time. Only `isMyTurn`
 * users can mutate them.
 */
export function KaraokeMusicBoard({
  isMyTurn,
  videoId,
  activeQuery,
  onChangeTrack,
  onEndSong,
}: KaraokeMusicBoardProps) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [results, setResults] = useState<SongHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSource, setSearchSource] = useState<"catalog" | "web" | null>(null);
  const runSongSearch = useServerFn(searchKaraokeSongs);

  // Drag state — bottom-right anchor, offsets in CSS pixels.
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
    // Anchored bottom-right → dragging right increases dx (panel moves right),
    // dragging up increases dy (panel moves up).
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

  const padPresets: { label: string; query: string; hue: string }[] = [
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
    { label: "Power Ballads", query: "power ballad karaoke", hue: "from-blue-400 to-blue-600" },
    { label: "Frank Sinatra", query: "frank sinatra karaoke", hue: "from-indigo-400 to-indigo-600" },
    { label: "Beyoncé", query: "beyonce karaoke", hue: "from-violet-400 to-violet-600" },
    { label: "Drake", query: "drake karaoke", hue: "from-purple-400 to-purple-600" },
    { label: "Trending", query: "trending karaoke 2025", hue: "from-pink-500 to-rose-600" },
  ];

  function extractYouTubeId(input: string): string | null {
    const t = input.trim();
    if (!t) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(t)) return t;
    try {
      const u = new URL(t);
      if (u.hostname.includes("youtu.be")) return u.pathname.replace(/^\//, "").slice(0, 11) || null;
      const v = u.searchParams.get("v");
      if (v) return v.slice(0, 11);
      const parts = u.pathname.split("/").filter(Boolean);
      const i = parts.findIndex((p) => p === "embed" || p === "shorts");
      if (i >= 0 && parts[i + 1]) return parts[i + 1].slice(0, 11);
    } catch {
      /* not a URL */
    }
    return null;
  }

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
      if (res.hits.length === 0) {
        setSearchError("No tracks found. Try a different title or artist.");
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function pickHit(hit: SongHit) {
    if (hit.youtubeId) {
      onChangeTrack({ videoId: hit.youtubeId, activeQuery: null });
    } else if (hit.url) {
      const id = extractYouTubeId(hit.url);
      if (id) onChangeTrack({ videoId: id, activeQuery: null });
    }
    setResults(null);
  }

  function playUrl() {
    const id = extractYouTubeId(urlInput);
    if (id) onChangeTrack({ videoId: id, activeQuery: null });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open music machine"
        className="group fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-gold/60 bg-background/80 px-3 py-1.5 text-[11px] font-semibold text-gold shadow-gold backdrop-blur transition hover:bg-gold/10 relative"
      >
        {/* Pulsing rings — pure CSS, no extra deps */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-gold/60 animate-ping"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full bg-gold/20 blur-md animate-pulse"
        />
        <Music className="relative h-3.5 w-3.5 animate-pulse" />
        <span className="relative">Music Machine</span>
      </button>
    );
  }

  const screenSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`
    : activeQuery
      ? `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(activeQuery)}&autoplay=1&rel=0&modestbranding=1`
      : null;

  // Original width was 26rem; 40% smaller ≈ 15.6rem. Use 15.5rem.
  return (
    <div
      className="fixed bottom-4 right-4 z-40 w-[min(96vw,15.5rem)] overflow-hidden rounded-xl border border-gold/40 bg-[#0a0a0a] shadow-gold"
      style={{ transform: `translate(${-pos.dx}px, ${-pos.dy}px)` }}
    >
      {/* Top chassis bar — also the drag handle */}
      <div
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
        className="flex cursor-grab touch-none select-none items-center justify-between border-b border-gold/20 bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] px-2 py-1.5 active:cursor-grabbing"
      >
        <div className="flex items-center gap-1.5">
          <GripVertical className="h-3 w-3 text-gold/60" />
          <span className="font-display text-[9px] uppercase tracking-[0.25em] text-gold">
            Maschine · Karaoke
          </span>
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

      {/* Dual screens */}
      <div className="grid grid-cols-2 gap-1 border-b border-gold/10 bg-[#050505] p-1.5">
        <div className="aspect-video overflow-hidden rounded-sm border border-gold/20 bg-black">
          {screenSrc ? (
            <iframe
              key={screenSrc}
              src={screenSrc}
              title="Karaoke screen"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[7px] uppercase tracking-widest text-gold/40">
              No track
            </div>
          )}
        </div>
        <div className="flex aspect-video flex-col justify-between rounded-sm border border-gold/20 bg-gradient-to-br from-[#1a0a0a] to-black p-1.5">
          <div className="text-[7px] uppercase tracking-widest text-gold/60">Now Playing</div>
          <div className="truncate font-display text-[8px] text-gold">
            {videoId ? `ID · ${videoId}` : (activeQuery ?? "—")}
          </div>
          <div className="text-[7px] uppercase tracking-widest text-gold/40">
            {isMyTurn ? "Mic live" : "Audience"}
          </div>
        </div>
      </div>

      {/* Knob row */}
      <div className="flex items-center justify-between border-b border-gold/10 bg-[#0a0a0a] px-2 py-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="relative h-3 w-3 rounded-full border border-gold/30 bg-gradient-to-br from-[#2a2a2a] to-[#0a0a0a] shadow-inner"
          >
            <span
              className="absolute left-1/2 top-1/2 block h-1.5 w-[1px] origin-bottom -translate-x-1/2 -translate-y-full bg-gold"
              style={{ transform: `translate(-50%, -100%) rotate(${i * 30 - 90}deg)` }}
            />
          </div>
        ))}
      </div>

      {/* Search bar */}
      <div className="space-y-1 border-b border-gold/10 bg-[#0a0a0a] p-2">
        <div className="flex gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query);
            }}
            disabled={false}
            placeholder={isMyTurn ? "Search song or artist…" : "Locked"}
            className="flex-1 rounded-sm border border-gold/20 bg-black/60 px-1.5 py-1 text-[9px] text-gold placeholder:text-gold/30 outline-none focus:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => runSearch(query)}
            disabled={!query.trim() || searching}
            className="inline-flex items-center gap-0.5 rounded-sm bg-gradient-gold px-1.5 py-1 text-[8px] font-semibold text-gold-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {searching ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Search className="h-2.5 w-2.5" />} Find
          </button>
        </div>

        {/* Inline search results — stays in-app */}
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
                onClick={() => pickHit(h)}
                disabled={!h.youtubeId && !extractYouTubeId(h.url ?? "")}
                className="flex w-full items-center justify-between gap-1 rounded-sm px-1.5 py-1 text-left text-gold/90 transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
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
            onKeyDown={(e) => {
              if (e.key === "Enter") playUrl();
            }}
            disabled={false}
            placeholder="…or paste YouTube link"
            className="flex-1 rounded-sm border border-gold/10 bg-black/40 px-1.5 py-1 text-[8px] text-gold placeholder:text-gold/30 outline-none focus:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={playUrl}
            disabled={!extractYouTubeId(urlInput)}
            className="inline-flex items-center gap-0.5 rounded-sm border border-gold/30 bg-black/60 px-1.5 py-1 text-[8px] font-semibold text-gold transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-2.5 w-2.5" /> Cue
          </button>
        </div>
        {isMyTurn && onEndSong && (
          <button
            type="button"
            onClick={onEndSong}
            className="w-full rounded-sm border border-rose-500/40 bg-rose-500/10 px-1.5 py-1 text-[8px] font-semibold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
          >
            End song · Next performer
          </button>
        )}
      </div>

      {/* 4x4 colored pad grid */}
      <div className="grid grid-cols-4 gap-1 bg-[#050505] p-2">
        {padPresets.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={false}
            onClick={() => runSearch(p.query)}
            className={`relative aspect-square rounded-sm bg-gradient-to-br ${p.hue} text-[6px] font-bold uppercase leading-tight tracking-tight text-black/85 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.35),0_0_6px_rgba(255,255,255,0.08)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:saturate-50`}
          >
            <span className="absolute inset-0 flex items-center justify-center px-0.5 text-center drop-shadow">
              {p.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
