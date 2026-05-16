import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";
import { searchGifs, trendingGifs, type GifResult } from "@/server/giphy.functions";

interface GifPickerProps {
  onPick: (gif: GifResult) => void;
}

export function GifPicker({ onPick }: GifPickerProps) {
  const search = useServerFn(searchGifs);
  const trending = useServerFn(trendingGifs);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await trending({ data: { limit: 24 } });
        if (cancelled) return;
        setConfigured(res.configured);
        setItems(res.results ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trending]);

  useEffect(() => {
    if (!q.trim()) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      let cancelled = false;
      setLoading(true);
      (async () => {
        try {
          const res = await search({ data: { q: q.trim(), limit: 24 } });
          if (cancelled) return;
          setConfigured(res.configured);
          setItems(res.results ?? []);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, search]);

  if (!configured) {
    return (
      <div className="rounded-xl border border-border bg-popover p-4 text-center text-xs text-muted-foreground">
        GIF picker isn't configured. Add <span className="font-mono">GIPHY_API_KEY</span>{" "}
        in Lovable Cloud secrets to enable Giphy.
        <br />
        <a
          href="https://developers.giphy.com/dashboard/"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-gold hover:underline"
        >
          Get a free key →
        </a>
      </div>
    );
  }

  return (
    <div className="flex h-80 w-full flex-col rounded-xl border border-border bg-popover">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search Tenor…"
          className="flex-1 bg-transparent text-sm focus:outline-none"
        />
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No results.
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto p-2 sm:grid-cols-3">
          {items.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(g)}
              className="overflow-hidden rounded-lg bg-muted/40 transition hover:ring-2 hover:ring-gold/60"
            >
              <img
                src={g.preview}
                alt={g.description}
                loading="lazy"
                className="h-24 w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
