/**
 * Tiny shared store for karaoke state that must cross the LiveKit boundary.
 *
 * <KaraokeStage> (outside <LiveKitRoom>) owns the authoritative DB session
 * and writes it here; <KaraokePerformerEngine> (inside <LiveKitRoom>, so it
 * can publish tracks) reads it, drives the audio mix bus / recorder, and
 * writes back live/recording/music flags that the UI renders.
 *
 * Replaces the earlier pile of window CustomEvents for anything stateful —
 * events fired before a listener mounted were simply lost, which is how the
 * singer's mic toggle silently did nothing on some loads.
 */
import { useSyncExternalStore } from "react";

export interface KaraokeSessionRow {
  performer_user_id: string | null;
  video_id: string | null;
  search_query: string | null;
  backing_track_id: string | null;
  song_title: string | null;
  song_artist: string | null;
  playback_status: string;
  position_ms: number;
  position_at: string;
  generation: number;
  revision: number;
  stage_source: string;
  reservation_id: string | null;
}

export interface KaraokeRoomSettings {
  rules: string;
  max_song_seconds: number;
  max_slot_minutes: number;
  max_future_bookings: number;
  booking_window_days: number;
  require_booking: boolean;
  holders_priority: boolean;
  allow_youtube: boolean;
  allow_uploads: boolean;
  recording_enabled: boolean;
}

export const DEFAULT_ROOM_SETTINGS: KaraokeRoomSettings = {
  rules: "",
  max_song_seconds: 420,
  max_slot_minutes: 15,
  max_future_bookings: 3,
  booking_window_days: 14,
  require_booking: false,
  holders_priority: true,
  allow_youtube: true,
  allow_uploads: true,
  recording_enabled: true,
};

export interface BackingTrackMeta {
  id: string;
  title: string;
  artist: string | null;
  lyrics: string | null;
  url: string | null; // signed URL, performer only
}

export interface KaraokeStageSnapshot {
  roomId: string | null;
  userId: string | null;
  isMyTurn: boolean;
  session: KaraokeSessionRow | null;
  settings: KaraokeRoomSettings;
  backingTrack: BackingTrackMeta | null;
  // Performer preferences (set by the music machine).
  micWanted: boolean;
  headphones: boolean;
  musicVolume: number; // 0..1
  micVolume: number; // 0..1.5
  // Engine-reported state.
  engineLive: boolean; // my mixed track is on air
  recording: boolean;
  musicInMyMix: boolean; // YouTube tab audio captured into my mix
  performerLive: boolean; // the current performer's mic is on air (any viewer)
  performerMusicInMix: boolean; // listeners should mute local YouTube
  backingPositionMs: number;
  backingDurationMs: number;
  /** serverNow - clientNow, so every device computes the same song position. */
  clockOffsetMs: number;
  /** The LiveKit-side engine is mounted (i.e. I'm actually connected). */
  engineMounted: boolean;
}

let snapshot: KaraokeStageSnapshot = {
  roomId: null,
  userId: null,
  isMyTurn: false,
  session: null,
  settings: DEFAULT_ROOM_SETTINGS,
  backingTrack: null,
  micWanted: false,
  headphones: true,
  musicVolume: 0.8,
  micVolume: 1,
  engineLive: false,
  recording: false,
  musicInMyMix: false,
  performerLive: false,
  performerMusicInMix: false,
  backingPositionMs: 0,
  backingDurationMs: 0,
  clockOffsetMs: 0,
  engineMounted: false,
};
const listeners = new Set<() => void>();

export function getKaraokeStage(): KaraokeStageSnapshot {
  return snapshot;
}

export function patchKaraokeStage(patch: Partial<KaraokeStageSnapshot>) {
  let changed = false;
  for (const k of Object.keys(patch) as (keyof KaraokeStageSnapshot)[]) {
    if (snapshot[k] !== patch[k]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

export function resetKaraokeStage() {
  patchKaraokeStage({
    roomId: null,
    isMyTurn: false,
    session: null,
    backingTrack: null,
    micWanted: false,
    engineLive: false,
    recording: false,
    musicInMyMix: false,
    performerLive: false,
    performerMusicInMix: false,
    backingPositionMs: 0,
    backingDurationMs: 0,
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useKaraokeStage(): KaraokeStageSnapshot {
  return useSyncExternalStore(subscribe, getKaraokeStage, getKaraokeStage);
}

/** Server-authoritative song position right now (ms), from the session row. */
export function livePositionMs(
  s: Pick<KaraokeSessionRow, "playback_status" | "position_ms" | "position_at">,
) {
  if (s.playback_status !== "playing") return s.position_ms;
  const at = new Date(s.position_at).getTime();
  const now = Date.now() + snapshot.clockOffsetMs;
  return Math.max(0, s.position_ms + (Number.isFinite(at) ? now - at : 0));
}
