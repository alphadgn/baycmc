import { useState } from "react";
import { ExternalLink, Music, Play, Search, X } from "lucide-react";

/**
 * Karaoke music machine.
 *
 * The user whose turn it is to perform can:
 *   1. Search Google / YouTube for their desired karaoke track in a new tab.
 *   2. Paste a YouTube URL or video ID into the machine and play it live
 *      inside the karaoke room (YouTube IFrame embed).
 *
 * Renders as a floating, dismissible panel anchored to the bottom-right
 * of the karaoke room so it never blocks the LiveKit stage.
 */
export function KaraokeMusicBoard() {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);

  function extractYouTubeId(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    // Already a bare 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    try {
      const u = new URL(trimmed);
      if (u.hostname.includes("youtu.be")) {
        return u.pathname.replace(/^\//, "").slice(0, 11) || null;
      }
      const v = u.searchParams.get("v");
      if (v) return v.slice(0, 11);
      // /embed/<id> or /shorts/<id>
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => p === "embed" || p === "shorts");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1].slice(0, 11);
    } catch {
      /* not a URL */
    }
    return null;
  }

  function playFromInput() {
    const id = extractYouTubeId(urlInput);
    if (id) setVideoId(id);
  }

  function openSearch(provider: "google" | "youtube") {
    const q = encodeURIComponent(`${query} karaoke`);
    const url =
      provider === "google"
        ? `https://www.google.com/search?q=${q}`
        : `https://www.youtube.com/results?search_query=${q}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-background/80 px-4 py-2 text-xs font-semibold text-gold shadow-gold backdrop-blur transition hover:bg-gold/10"
      >
        <Music className="h-4 w-4" />
        Music machine
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-gold/40 bg-background/90 shadow-gold backdrop-blur">
      <div className="flex items-center justify-between border-b border-gold/20 bg-gold/10 px-3 py-2">
        <div className="flex items-center gap-2 text-gold">
          <Music className="h-4 w-4" />
          <span className="font-display text-sm uppercase tracking-wider">
            Music Machine
          </span>
        </div>
        <button
          type="button"
          aria-label="Close music machine"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-gold/70 transition hover:bg-gold/10 hover:text-gold"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 p-3 text-xs">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Find a song
          </label>
          <div className="flex gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Song title or artist…"
              className="flex-1 rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-xs text-foreground outline-none focus:border-gold/60"
            />
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              disabled={!query.trim()}
              onClick={() => openSearch("google")}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-[11px] font-semibold text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Search className="h-3 w-3" /> Google
              <ExternalLink className="h-3 w-3 opacity-60" />
            </button>
            <button
              type="button"
              disabled={!query.trim()}
              onClick={() => openSearch("youtube")}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2 py-1.5 text-[11px] font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Search className="h-3 w-3" /> YouTube
              <ExternalLink className="h-3 w-3 opacity-60" />
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
            Paste a YouTube link to play
          </label>
          <div className="flex gap-1.5">
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") playFromInput();
              }}
              placeholder="youtube.com/watch?v=…"
              className="flex-1 rounded-md border border-border bg-secondary/40 px-2 py-1.5 text-xs text-foreground outline-none focus:border-gold/60"
            />
            <button
              type="button"
              onClick={playFromInput}
              disabled={!extractYouTubeId(urlInput)}
              className="inline-flex items-center gap-1 rounded-md bg-gradient-gold px-2.5 py-1.5 text-[11px] font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play className="h-3 w-3" /> Play
            </button>
          </div>
        </div>

        {videoId && (
          <div className="overflow-hidden rounded-md border border-gold/30 bg-black">
            <div className="aspect-video w-full">
              <iframe
                key={videoId}
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`}
                title="Karaoke track"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>
            <div className="flex items-center justify-between px-2 py-1.5 text-[10px] text-muted-foreground">
              <span className="truncate">Now playing</span>
              <button
                type="button"
                onClick={() => setVideoId(null)}
                className="text-destructive hover:underline"
              >
                stop
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
