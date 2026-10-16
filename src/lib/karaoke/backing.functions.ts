import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Signed link to a backing-track file. Files are owner/staff-only in
 * storage; the server hands a short-lived link to the track's owner or to
 * the singer whose turn is using it right now (shared tracks).
 */
export const getBackingTrackUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { trackId: string }) =>
    z.object({ trackId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: track } = await supabaseAdmin
      .from("karaoke_backing_tracks")
      .select("id,owner_id,is_public,storage_path")
      .eq("id", data.trackId)
      .maybeSingle();
    if (!track) return { ok: false as const, error: "Track not found" };
    let allowed = track.owner_id === context.userId;
    if (!allowed && track.is_public) {
      const { data: s } = await supabaseAdmin
        .from("karaoke_sessions")
        .select("room_id")
        .eq("backing_track_id", track.id)
        .eq("performer_user_id", context.userId)
        .limit(1)
        .maybeSingle();
      allowed = !!s;
    }
    if (!allowed) return { ok: false as const, error: "Not allowed" };
    const { data: signed, error } = await supabaseAdmin.storage
      .from("karaoke-backing-tracks")
      .createSignedUrl(track.storage_path as string, 60 * 60 * 2);
    if (error || !signed) return { ok: false as const, error: error?.message ?? "Couldn't sign" };
    return { ok: true as const, url: signed.signedUrl };
  });
