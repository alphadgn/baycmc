import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Giphy v1 GIF search.
 *
 * Tenor closed new API client signups in January 2026, so we use Giphy
 * instead. Get a free key at https://developers.giphy.com/dashboard/.
 *
 * Lacking GIPHY_API_KEY the server fn returns an empty list with
 * `configured: false` so the UI can show a "GIF picker not configured"
 * message instead of crashing.
 */

export interface GifResult {
  id: string;
  url: string;        // direct media URL we render in chat
  preview: string;    // smaller URL for the picker grid
  width: number;
  height: number;
  description: string;
}

interface GiphyImage {
  url?: string;
  width?: string;
  height?: string;
}

interface GiphyResponse {
  data?: Array<{
    id?: string;
    title?: string;
    images?: {
      original?: GiphyImage;
      downsized?: GiphyImage;
      downsized_medium?: GiphyImage;
      fixed_height?: GiphyImage;
      fixed_width_small?: GiphyImage;
      preview_gif?: GiphyImage;
    };
  }>;
}

const fetchTimeoutMs = 8_000;

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), fetchTimeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Giphy`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function mapResults(json: GiphyResponse): GifResult[] {
  return (json.data ?? []).flatMap((g) => {
    if (!g.id || !g.images) return [];
    // Render in chat at a reasonable size; pick a downsized version first
    // so we don't blow through bandwidth, fall back to original.
    const main =
      g.images.downsized_medium ??
      g.images.downsized ??
      g.images.fixed_height ??
      g.images.original;
    // Picker thumbnail — small.
    const thumb =
      g.images.fixed_width_small ??
      g.images.preview_gif ??
      g.images.fixed_height ??
      main;
    if (!main?.url || !thumb?.url) return [];
    return [
      {
        id: g.id,
        url: main.url,
        preview: thumb.url,
        width: parseInt(main.width ?? "200", 10) || 200,
        height: parseInt(main.height ?? "200", 10) || 200,
        description: g.title ?? "",
      },
    ];
  });
}

export const searchGifs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string; limit?: number }) =>
    z
      .object({
        q: z.string().min(1).max(80),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env.GIPHY_API_KEY?.trim();
    if (!key) {
      return { ok: false as const, configured: false as const, results: [] as GifResult[] };
    }
    const limit = data.limit ?? 24;
    const url =
      `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}` +
      `&q=${encodeURIComponent(data.q)}&limit=${limit}` +
      `&rating=pg-13&lang=en&bundle=messaging_non_clips`;
    try {
      const json = await fetchJson<GiphyResponse>(url);
      return {
        ok: true as const,
        configured: true as const,
        results: mapResults(json),
      };
    } catch (e) {
      console.error("Giphy search failed", e);
      return {
        ok: false as const,
        configured: true as const,
        results: [] as GifResult[],
        reason: e instanceof Error ? e.message : "Giphy search failed",
      };
    }
  });

export const trendingGifs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number }) =>
    z.object({ limit: z.number().int().min(1).max(50).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env.GIPHY_API_KEY?.trim();
    if (!key) {
      return { ok: false as const, configured: false as const, results: [] as GifResult[] };
    }
    const limit = data.limit ?? 24;
    const url =
      `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(key)}` +
      `&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;
    try {
      const json = await fetchJson<GiphyResponse>(url);
      return {
        ok: true as const,
        configured: true as const,
        results: mapResults(json),
      };
    } catch (e) {
      console.error("Giphy trending failed", e);
      return {
        ok: false as const,
        configured: true as const,
        results: [] as GifResult[],
        reason: e instanceof Error ? e.message : "Giphy failed",
      };
    }
  });
