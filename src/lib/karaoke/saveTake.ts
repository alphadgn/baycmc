/**
 * Save a parked take: check the waiver, upload the audio to the singer's own
 * folder in the PRIVATE karaoke-recordings bucket, then create the recording
 * row with the visibility the singer chose. Discard never calls this.
 */
import { supabase } from "@/integrations/supabase/client";
import { saveKaraokeRecording } from "@/lib/karaoke/recordings.functions";
import type { PendingTake } from "@/lib/karaoke/pendingTakes";
import { isWaiverError, markWaiverRequired, refreshWaiverStatus } from "@/lib/karaoke/waiverStatus";

export type TakeVisibility = "public" | "private";
/** Saved takes are private unless the singer picks Public. */
export const DEFAULT_TAKE_VISIBILITY: TakeVisibility = "private";

export class WaiverRequiredError extends Error {
  constructor() {
    super("Accept the performance waiver to save this take.");
    this.name = "WaiverRequiredError";
  }
}

export async function savePendingTake(take: PendingTake, visibility: TakeVisibility) {
  // Check first so nothing is uploaded when the save would be refused.
  const w = await refreshWaiverStatus();
  if (w.status === "needed") throw new WaiverRequiredError();

  const baseMime = take.mime.split(";")[0] || "audio/webm";
  const ext = baseMime.includes("mp4") ? "m4a" : "webm";
  const storagePath = `${take.userId}/${take.roomId}/take-${Date.now()}.${ext}`;
  const up = await supabase.storage
    .from("karaoke-recordings")
    .upload(storagePath, take.blob, { contentType: baseMime, upsert: false });
  if (up.error) throw new Error(up.error.message);
  try {
    await saveKaraokeRecording({
      data: {
        roomId: take.roomId,
        storagePath,
        songTitle: take.title,
        songArtist: take.artist,
        youtubeId: take.youtubeId,
        backingTrackId: take.backingTrackId,
        reservationId: take.reservationId,
        sessionGeneration: take.generation,
        durationMs: Math.min(take.durationMs, 60 * 60 * 1000),
        mimeType: baseMime,
        hasInstrumental: take.hasInstrumental,
        visibility,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isWaiverError(msg)) {
      markWaiverRequired();
      throw new WaiverRequiredError();
    }
    throw e;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("karaoke:recordings-changed"));
  }
}
