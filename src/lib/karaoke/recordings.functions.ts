import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InsertSchema = z.object({
  roomId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  publicUrl: z.string().url(),
  songTitle: z.string().max(255).optional().nullable(),
  songArtist: z.string().max(255).optional().nullable(),
  youtubeId: z.string().max(20).optional().nullable(),
  durationMs: z.number().int().min(0).max(60 * 60 * 1000).optional().nullable(),
  mimeType: z.string().max(64).default("audio/webm"),
  hasInstrumental: z.boolean().default(true),
});

/**
 * Insert a karaoke recording row after the singer's browser uploaded the
 * mixed blob to the karaoke-recordings storage bucket. RLS guarantees that
 * `performer_id` matches the authenticated user.
 */
export const saveKaraokeRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("karaoke_recordings")
      .insert({
        room_id: data.roomId,
        performer_id: userId,
        storage_path: data.storagePath,
        public_url: data.publicUrl,
        song_title: data.songTitle ?? null,
        song_artist: data.songArtist ?? null,
        youtube_id: data.youtubeId ?? null,
        duration_ms: data.durationMs ?? null,
        mime_type: data.mimeType,
        has_instrumental: data.hasInstrumental,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, publicUrl: row.public_url };
  });

export const listRoomKaraokeRecordings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ roomId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("karaoke_recordings")
      .select("id, song_title, song_artist, public_url, duration_ms, performer_id, created_at")
      .eq("room_id", data.roomId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
