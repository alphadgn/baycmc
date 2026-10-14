import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InsertSchema = z.object({
  roomId: z.string().uuid(),
  storagePath: z.string().min(1).max(500),
  songTitle: z.string().max(255).optional().nullable(),
  songArtist: z.string().max(255).optional().nullable(),
  youtubeId: z.string().max(20).optional().nullable(),
  backingTrackId: z.string().uuid().optional().nullable(),
  reservationId: z.string().uuid().optional().nullable(),
  sessionGeneration: z.number().int().min(0).optional().nullable(),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 1000)
    .optional()
    .nullable(),
  mimeType: z.string().max(64).default("audio/webm"),
  hasInstrumental: z.boolean().default(true),
  visibility: z.enum(["room", "private"]).default("room"),
});

const SIGNED_URL_TTL_S = 60 * 60;

/**
 * Insert a karaoke recording row after the singer's browser uploaded the
 * mixed take (vocals + backing track) to the PRIVATE karaoke-recordings
 * bucket. The path must live under the caller's own folder for this room,
 * and the object must actually exist.
 */
export const saveKaraokeRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof InsertSchema>) => InsertSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prefix = `${userId}/${data.roomId}/`;
    if (!data.storagePath.startsWith(prefix) || data.storagePath.includes("..")) {
      throw new Error("Invalid recording path");
    }
    const fileName = data.storagePath.slice(prefix.length);
    const { data: listed } = await supabase.storage
      .from("karaoke-recordings")
      .list(`${userId}/${data.roomId}`, { search: fileName, limit: 1 });
    if (!listed || !listed.some((o) => o.name === fileName)) {
      throw new Error("Recording upload not found");
    }

    const { data: room } = await supabase
      .from("karaoke_room_settings")
      .select("recording_enabled")
      .eq("room_id", data.roomId)
      .maybeSingle();
    if (room && room.recording_enabled === false)
      throw new Error("Recording is disabled in this room");

    const { data: row, error } = await supabase
      .from("karaoke_recordings")
      .insert({
        room_id: data.roomId,
        performer_id: userId,
        storage_path: data.storagePath,
        // Kept for schema compatibility; playback always uses a signed URL.
        public_url: `storage://karaoke-recordings/${data.storagePath}`,
        song_title: data.songTitle ?? null,
        song_artist: data.songArtist ?? null,
        youtube_id: data.youtubeId ?? null,
        backing_track_id: data.backingTrackId ?? null,
        reservation_id: data.reservationId ?? null,
        session_generation: data.sessionGeneration ?? null,
        duration_ms: data.durationMs ?? null,
        mime_type: data.mimeType,
        has_instrumental: data.hasInstrumental,
        visibility: data.visibility,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export interface RecordingListItem {
  id: string;
  song_title: string | null;
  song_artist: string | null;
  duration_ms: number | null;
  performer_id: string;
  created_at: string;
  visibility: string;
  url: string | null;
}

export const listRoomKaraokeRecordings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string; mine?: boolean }) =>
    z.object({ roomId: z.string().uuid(), mine: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RecordingListItem[]> => {
    const { supabase, userId } = context;
    let q = supabase
      .from("karaoke_recordings")
      .select(
        "id, song_title, song_artist, storage_path, duration_ms, performer_id, created_at, visibility",
      )
      .eq("room_id", data.roomId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.mine) q = q.eq("performer_id", userId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const visible = (rows ?? []).filter(
      (r) => r.visibility !== "private" || r.performer_id === userId,
    );
    const paths = visible.map((r) => r.storage_path as string);
    const signed = paths.length
      ? ((
          await supabase.storage
            .from("karaoke-recordings")
            .createSignedUrls(paths, SIGNED_URL_TTL_S)
        ).data ?? [])
      : [];
    const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
    return visible.map((r) => ({
      id: r.id as string,
      song_title: r.song_title as string | null,
      song_artist: r.song_artist as string | null,
      duration_ms: r.duration_ms as number | null,
      performer_id: r.performer_id as string,
      created_at: r.created_at as string,
      visibility: r.visibility as string,
      url: byPath.get(r.storage_path as string) ?? null,
    }));
  });

/** Performer can delete their own take; admins can delete any take. */
export const deleteKaraokeRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("karaoke_recordings")
      .select("id,storage_path")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) return { ok: false as const, error: "Recording not found" };
    // RLS on karaoke_recordings DELETE = performer or admin; the storage
    // DELETE policy mirrors it, so a non-owner fails both.
    const { error } = await supabase.from("karaoke_recordings").delete().eq("id", data.id);
    if (error) return { ok: false as const, error: error.message };
    await supabase.storage.from("karaoke-recordings").remove([row.storage_path as string]);
    return { ok: true as const };
  });

/** Toggle a take between room-visible and private (performer only, via RLS). */
export const setKaraokeRecordingVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; visibility: "room" | "private" }) =>
    z.object({ id: z.string().uuid(), visibility: z.enum(["room", "private"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("karaoke_recordings")
      .update({ visibility: data.visibility })
      .eq("id", data.id)
      .eq("performer_id", context.userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
