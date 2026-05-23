import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface SongHit {
  id?: string;
  title: string;
  artist: string | null;
  source: "catalog" | "web";
  /** YouTube video ID extracted from a discovered URL, if any. */
  youtubeId: string | null;
  /** The original landing URL (only set for web hits). */
  url: string | null;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = input.trim();
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

/**
 * Search the local karaoke catalog first; if nothing matches, fall back
 * to Firecrawl web search for "<query> karaoke" and pull playable URLs
 * from the results. Hits are cached so repeated misses don't re-scrape.
 */
export const searchKaraokeSongs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ query: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = data.query.trim();
    const norm = normalize(q);

    // 1) Local catalog (trigram ILIKE)
    const { data: local } = await supabase
      .from("karaoke_songs")
      .select("id,title,artist,playable_url,youtube_id")
      .or(`normalized_title.ilike.%${norm}%,artist.ilike.%${norm}%`)
      .limit(20);

    if (local && local.length > 0) {
      return {
        source: "catalog" as const,
        hits: local.map<SongHit>((r) => ({
          id: r.id,
          title: r.title,
          artist: r.artist,
          source: "catalog",
          youtubeId: r.youtube_id ?? extractYouTubeId(r.playable_url),
          url: r.playable_url,
        })),
      };
    }

    // 2) Cache check
    const cacheKey = `${norm} karaoke`;
    const { data: cached } = await supabaseAdmin
      .from("karaoke_search_cache")
      .select("results,fetched_at")
      .eq("query", cacheKey)
      .maybeSingle();
    const fresh =
      cached && Date.now() - new Date(cached.fetched_at).getTime() < 7 * 24 * 3600 * 1000;
    if (fresh && Array.isArray(cached.results) && cached.results.length > 0) {
      return { source: "web" as const, hits: cached.results as SongHit[] };
    }

    // 3) Firecrawl search
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      return { source: "web" as const, hits: [] as SongHit[], error: "Search unavailable" };
    }
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const fc = new Firecrawl({ apiKey });

    let hits: SongHit[] = [];
    try {
      const res = await fc.search(`${q} karaoke with lyrics`, { limit: 8 });
      const results: Array<{ url?: string; title?: string; description?: string }> =
        // SDK exposes results under .web in v2
        (res as { web?: Array<{ url?: string; title?: string; description?: string }> }).web ??
        (res as { results?: { web?: Array<{ url?: string; title?: string; description?: string }> } })
          .results?.web ??
        [];

      hits = results
        .map<SongHit | null>((r) => {
          if (!r.url) return null;
          const yt = extractYouTubeId(r.url);
          return {
            title: r.title?.replace(/\s*[-–|].*$/, "").trim() || q,
            artist: null,
            source: "web",
            youtubeId: yt,
            url: r.url,
          };
        })
        .filter((x): x is SongHit => x !== null)
        .slice(0, 8);
    } catch (e) {
      console.error("[karaoke] firecrawl search failed", e);
      return { source: "web" as const, hits: [] as SongHit[], error: "Search failed" };
    }

    // Cache it
    if (hits.length > 0) {
      await supabaseAdmin
        .from("karaoke_search_cache")
        .upsert(
          { query: cacheKey, results: hits, fetched_at: new Date().toISOString() },
          { onConflict: "query" },
        );
    }

    return { source: "web" as const, hits };
  });

/**
 * Admin-only: scrape KaraFun's top-played karaoke chart via Firecrawl and
 * upsert songs into the catalog. Idempotent — re-running refreshes ranks.
 */
export const seedKaraokeCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // Verify admin
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!roles?.some((r) => r.role === "admin" || r.role === "super_admin")) {
      throw new Error("Admin only");
    }
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const fc = new Firecrawl({ apiKey });

    const sources = [
      "https://www.karafun.com/karaoke/most-popular/",
      "https://www.karafun.com/karaoke/most-popular/?page=2",
      "https://www.karafun.com/karaoke/most-popular/?page=3",
      "https://www.karafun.com/karaoke/most-popular/?page=4",
      "https://www.karafun.com/karaoke/most-popular/?page=5",
    ];

    const collected: Array<{ title: string; artist: string | null }> = [];
    for (const url of sources) {
      try {
        const r = await fc.scrape(url, { formats: ["markdown"], onlyMainContent: true });
        const md =
          (r as { markdown?: string }).markdown ??
          (r as { data?: { markdown?: string } }).data?.markdown ??
          "";
        // KaraFun chart rows roughly look like "Song Title  —  Artist" in markdown
        for (const line of md.split("\n")) {
          const m = line.match(/^\s*\d+\.?\s+(.+?)\s+[-–—]\s+(.+?)\s*$/);
          if (m) {
            const title = m[1].replace(/\*\*/g, "").trim();
            const artist = m[2].replace(/\*\*/g, "").trim();
            if (title && artist && title.length < 200 && artist.length < 200) {
              collected.push({ title, artist });
            }
          }
        }
      } catch (e) {
        console.warn("[seedKaraokeCatalog] failed", url, e);
      }
    }

    if (collected.length === 0) {
      return { inserted: 0, total: 0 };
    }

    const rows = collected.slice(0, 1000).map((s, i) => ({
      title: s.title,
      artist: s.artist,
      normalized_title: normalize(s.title),
      source: "karafun-top-1000",
      rank: i + 1,
    }));

    const { error } = await supabaseAdmin
      .from("karaoke_songs")
      .upsert(rows, { onConflict: "normalized_title,artist" });
    if (error) throw new Error(error.message);

    return { inserted: rows.length, total: collected.length };
  });
