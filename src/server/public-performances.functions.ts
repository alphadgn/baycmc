import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Public karaoke performances — viewable by anyone on the internet (no
 * account) through share links. Only rows marked public are returned, and
 * playback uses short-lived signed links made by the server.
 */
const TTL_S = 60 * 60;

export interface PublicPerformance {
  id: string;
  songTitle: string | null;
  songArtist: string | null;
  durationMs: number | null;
  createdAt: string;
  performerId: string;
  performerName: string;
  performerAvatar: string | null;
  url: string | null;
}

async function shape(
  rows: {
    id: string;
    song_title: string | null;
    song_artist: string | null;
    duration_ms: number | null;
    created_at: string;
    performer_id: string;
    storage_path: string;
  }[],
): Promise<PublicPerformance[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.performer_id))];
  const { data: profs } = await supabaseAdmin
    .from("profiles")
    .select("id,username,avatar_url,wallet_display")
    .in("id", ids);
  const { data: signed } = await supabaseAdmin.storage.from("karaoke-recordings").createSignedUrls(
    rows.map((r) => r.storage_path),
    TTL_S,
  );
  const urlBy = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => {
    const p = profs?.find((x) => x.id === r.performer_id);
    return {
      id: r.id,
      songTitle: r.song_title,
      songArtist: r.song_artist,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
      performerId: r.performer_id,
      performerName: p?.username?.trim() || p?.wallet_display || "BAYCmc member",
      performerAvatar: p?.avatar_url ?? null,
      url: urlBy.get(r.storage_path) ?? null,
    };
  });
}

const COLS = "id,song_title,song_artist,duration_ms,created_at,performer_id,storage_path";

export const getPublicPerformance = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("karaoke_recordings")
      .select(COLS)
      .eq("id", data.id)
      .eq("visibility", "public")
      .maybeSingle();
    if (!row) return { ok: false as const };
    const [p] = await shape([row as never]);
    return { ok: true as const, performance: p! };
  });

export const listPublicPerformances = createServerFn({ method: "POST" })
  .inputValidator((d: { performerId: string }) =>
    z.object({ performerId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("karaoke_recordings")
      .select(COLS)
      .eq("performer_id", data.performerId)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(100);
    const list = await shape((rows ?? []) as never);
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("username,avatar_url,wallet_display")
      .eq("id", data.performerId)
      .maybeSingle();
    return {
      performer: prof
        ? {
            name: prof.username?.trim() || prof.wallet_display || "BAYCmc member",
            avatar: prof.avatar_url ?? null,
          }
        : null,
      performances: list,
    };
  });

/**
 * Admins: remove recording files that no performance row points to. Runs
 * when an admin opens Admin → Karaoke.
 */
export const cleanupOrphanRecordingFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "super_admin"]);
    if (!roles?.length) return { removed: 0 };
    const { data: paths } = await (
      supabaseAdmin.rpc as unknown as (
        f: string,
      ) => Promise<{ data: string[] | null; error: unknown }>
    )("karaoke_orphan_recording_paths");
    const list = (paths ?? []).filter(Boolean);
    if (list.length === 0) return { removed: 0 };
    const { data: removed } = await supabaseAdmin.storage.from("karaoke-recordings").remove(list);
    return { removed: removed?.length ?? 0 };
  });
