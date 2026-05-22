import { useState } from "react";
import { Lock, Music, Play, Search, X } from "lucide-react";

interface KaraokeMusicBoardProps {
  /**
   * True only for the user whose active booking owns the karaoke stage.
   * When false the entire machine is render-locked — the panel still shows
   * (so the audience can see what's queued) but every control is disabled.
   */
  isMyTurn: boolean;
}

/**
 * Karaoke "Maschine"-style music machine.
 *
 * Visual likeness modeled after the Native Instruments Maschine controller:
 *   - dark chassis with gold trim,
 *   - twin display screens at the top (search / now-playing),
 *   - a row of rotary knob indicators,
 *   - a 4x4 grid of glowing pads acting as quick-pick result buttons.
 *
 * Search and playback are 100% in-app — we embed YouTube's built-in search
 * playlist via the IFrame Player (`listType=search&list=<query>`), so the
 * performer never leaves the clubhouse.
 *
 * Only the performer whose booking is currently active (`isMyTurn`) can
 * drive the machine; everyone else sees the locked chassis.
 */
export function KaraokeMusicBoard({ isMyTurn }: KaraokeMusicBoardProps) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");

  // Pre-loaded quick-pick pads — common karaoke genres mapped onto the 16
  // colored pads, mirroring Maschine's pad layout.
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

  function runSearch(q: string) {
    if (!isMyTurn) return;
    const trimmed = q.trim();
    if (!trimmed) return;
    setVideoId(null);
    setActiveQuery(`${trimmed} karaoke`);
  }

  function playUrl() {
    if (!isMyTurn) return;
    const id = extractYouTubeId(urlInput);
    if (id) {
      setActiveQuery(null);
      setVideoId(id);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-background/80 px-4 py-2 text-xs font-semibold text-gold shadow-gold backdrop-blur transition hover:bg-gold/10"
      >
        <Music className="h-4 w-4" />
        Music Machine
      </button>
    );
  }

  const screenSrc = videoId
    ? `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`
    : activeQuery
      ? `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(activeQuery)}&autoplay=1&rel=0&modestbranding=1`
      : null;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(96vw,26rem)] overflow-hidden rounded-2xl border border-gold/40 bg-[#0a0a0a] shadow-gold">
      {/* Top chassis bar */}
      <div className="flex items-center justify-between border-b border-gold/20 bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-gold/50 text-gold">
            <Music className="h-3 w-3" />
          </div>
          <span className="font-display text-xs uppercase tracking-[0.25em] text-gold">
            Maschine · Karaoke
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isMyTurn ? (
            <span className="rounded-sm bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
              Your Turn
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300">
              <Lock className="h-2.5 w-2.5" /> Locked
            </span>
          )}
          <button
            type="button"
            aria-label="Close music machine"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-gold/70 transition hover:bg-gold/10 hover:text-gold"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Dual screens */}
      <div className="grid grid-cols-2 gap-2 border-b border-gold/10 bg-[#050505] p-2">
        <div className="aspect-video overflow-hidden rounded-md border border-gold/20 bg-black">
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
            <div className="flex h-full w-full items-center justify-center text-[9px] uppercase tracking-widest text-gold/40">
              No track
            </div>
          )}
        </div>
        <div className="flex aspect-video flex-col justify-between rounded-md border border-gold/20 bg-gradient-to-br from-[#1a0a0a] to-black p-2">
          <div className="text-[9px] uppercase tracking-widest text-gold/60">Now Playing</div>
          <div className="truncate font-display text-[11px] text-gold">
            {videoId ? `ID · ${videoId}` : activeQuery ?? "—"}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-gold/40">
            {isMyTurn ? "Performer mic live" : "Awaiting performer"}
          </div>
        </div>
      </div>

      {/* Knob row */}
      <div className="flex items-center justify-between border-b border-gold/10 bg-[#0a0a0a] px-3 py-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="relative h-5 w-5 rounded-full border border-gold/30 bg-gradient-to-br from-[#2a2a2a] to-[#0a0a0a] shadow-inner"
          >
            <span
              className="absolute left-1/2 top-1/2 block h-2 w-[1.5px] origin-bottom -translate-x-1/2 -translate-y-full bg-gold"
              style={{ transform: `translate(-50%, -100%) rotate(${i * 30 - 90}deg)` }}
            />
          </div>
        ))}
      </div>

      {/* Search bar */}
      <div className="space-y-2 border-b border-gold/10 bg-[#0a0a0a] p-3">
        <div className="flex gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query);
            }}
            disabled={!isMyTurn}
            placeholder={isMyTurn ? "Search any song or artist…" : "Music machine locked"}
            className="flex-1 rounded-md border border-gold/20 bg-black/60 px-2 py-1.5 text-xs text-gold placeholder:text-gold/30 outline-none focus:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => runSearch(query)}
            disabled={!isMyTurn || !query.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-gradient-gold px-2.5 py-1.5 text-[11px] font-semibold text-gold-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Search className="h-3 w-3" /> Find
          </button>
        </div>
        <div className="flex gap-1.5">
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") playUrl();
            }}
            disabled={!isMyTurn}
            placeholder="…or paste a YouTube link"
            className="flex-1 rounded-md border border-gold/10 bg-black/40 px-2 py-1.5 text-[11px] text-gold placeholder:text-gold/30 outline-none focus:border-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={playUrl}
            disabled={!isMyTurn || !extractYouTubeId(urlInput)}
            className="inline-flex items-center gap-1 rounded-md border border-gold/30 bg-black/60 px-2 py-1.5 text-[11px] font-semibold text-gold transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-3 w-3" /> Cue
          </button>
        </div>
      </div>

      {/* 4x4 colored pad grid */}
      <div className="grid grid-cols-4 gap-1.5 bg-[#050505] p-3">
        {padPresets.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={!isMyTurn}
            onClick={() => runSearch(p.query)}
            className={`relative aspect-square rounded-md bg-gradient-to-br ${p.hue} text-[8px] font-bold uppercase leading-tight tracking-tight text-black/85 shadow-[inset_0_-4px_8px_rgba(0,0,0,0.35),0_0_12px_rgba(255,255,255,0.08)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:saturate-50`}
          >
            <span className="absolute inset-0 flex items-center justify-center px-1 text-center drop-shadow">
              {p.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
