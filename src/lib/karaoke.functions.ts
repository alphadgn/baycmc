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
      return { source: "web" as const, hits: cached.results as unknown as SongHit[] };
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
        (
          res as {
            results?: { web?: Array<{ url?: string; title?: string; description?: string }> };
          }
        ).results?.web ??
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
          {
            query: cacheKey,
            results: JSON.parse(JSON.stringify(hits)),
            fetched_at: new Date().toISOString(),
          },
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
    const seen = new Set<string>();

    for (const url of sources) {
      try {
        // Use Firecrawl JSON extraction — KaraFun's markdown layout is
        // inconsistent across pages, so a regex over markdown produced 0
        // hits. The JSON/prompt format reliably returns title+artist pairs.
        const r = (await fc.scrape(url, {
          formats: [
            {
              type: "json",
              prompt:
                "Extract every karaoke song listed on this KaraFun chart page as an array named 'songs'. Each item must have 'title' (song name only, no artist) and 'artist' (performer name). Do not invent songs. Return up to 200 songs from this page in chart order.",
            },
            "markdown",
          ],
          onlyMainContent: true,
        })) as {
          json?: { songs?: Array<{ title?: string; artist?: string }> };
          data?: {
            json?: { songs?: Array<{ title?: string; artist?: string }> };
            markdown?: string;
          };
          markdown?: string;
        };

        const songs = r.json?.songs ?? r.data?.json?.songs ?? [];
        for (const s of songs) {
          const title = (s.title ?? "").replace(/\s+/g, " ").trim();
          const artist = (s.artist ?? "").replace(/\s+/g, " ").trim();
          if (!title || !artist) continue;
          if (title.length > 200 || artist.length > 200) continue;
          const key = `${normalize(title)}|${normalize(artist)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push({ title, artist });
        }

        // Fallback: also try parsing the markdown if JSON missed it.
        const md = r.markdown ?? r.data?.markdown ?? "";
        if (songs.length === 0 && md) {
          for (const line of md.split("\n")) {
            const m =
              line.match(/^\s*\d+\.?\s+\**(.+?)\**\s+[-–—|]\s+\**(.+?)\**\s*$/) ||
              line.match(/^\s*\[(.+?)\]\(.+?\)\s+[-–—|]\s+(.+?)\s*$/);
            if (!m) continue;
            const title = m[1].trim();
            const artist = m[2].trim();
            if (!title || !artist) continue;
            const key = `${normalize(title)}|${normalize(artist)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            collected.push({ title, artist });
          }
        }
      } catch (e) {
        console.warn("[seedKaraokeCatalog] failed", url, e);
      }
    }

    if (collected.length === 0) {
      return { inserted: 0, skipped: 0, total: 0, lastSeededAt: null as string | null };
    }

    // Count pre-existing rows so we can report skipped duplicates accurately.
    const normalizedKeys = collected.map((s) => normalize(s.title));
    const { data: existing } = await supabaseAdmin
      .from("karaoke_songs")
      .select("normalized_title,artist")
      .in("normalized_title", normalizedKeys);
    const existingSet = new Set(
      (existing ?? []).map((r) => `${r.normalized_title}|${normalize(r.artist ?? "")}`),
    );

    const rows = collected.slice(0, 1000).map((s, i) => ({
      title: s.title,
      artist: s.artist,
      normalized_title: normalize(s.title),
      source: "karafun-top-1000",
      rank: i + 1,
    }));

    const skipped = rows.filter((r) =>
      existingSet.has(`${r.normalized_title}|${normalize(r.artist ?? "")}`),
    ).length;
    const inserted = rows.length - skipped;

    const { error } = await supabaseAdmin
      .from("karaoke_songs")
      .upsert(rows, { onConflict: "normalized_title,artist" });
    if (error) throw new Error(error.message);

    const lastSeededAt = new Date().toISOString();
    await supabaseAdmin.from("app_settings").upsert(
      {
        key: "karaoke_catalog_seed",
        value: {
          last_seeded_at: lastSeededAt,
          last_inserted: inserted,
          last_skipped: skipped,
          last_total_collected: collected.length,
        },
        updated_by: userId,
        updated_at: lastSeededAt,
      },
      { onConflict: "key" },
    );

    return { inserted, skipped, total: collected.length, lastSeededAt };
  });

/**
 * Admin-only: stats summary for the karaoke catalog seed page.
 */
export const getKaraokeCatalogStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (!roles?.some((r) => r.role === "admin" || r.role === "super_admin")) {
      throw new Error("Admin only");
    }
    const [{ count }, { data: settings }] = await Promise.all([
      supabaseAdmin.from("karaoke_songs").select("id", { count: "exact", head: true }),
      supabaseAdmin
        .from("app_settings")
        .select("value,updated_at")
        .eq("key", "karaoke_catalog_seed")
        .maybeSingle(),
    ]);
    const v = (settings?.value ?? {}) as {
      last_seeded_at?: string;
      last_inserted?: number;
      last_skipped?: number;
      last_total_collected?: number;
    };
    return {
      totalSongs: count ?? 0,
      lastSeededAt: v.last_seeded_at ?? settings?.updated_at ?? null,
      lastInserted: v.last_inserted ?? null,
      lastSkipped: v.last_skipped ?? null,
      lastTotalCollected: v.last_total_collected ?? null,
    };
  });
