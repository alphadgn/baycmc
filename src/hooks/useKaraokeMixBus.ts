import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { LocalAudioTrack, Track } from "livekit-client";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { KaraokeMixBus, ensureAudioContextRunning } from "@/lib/karaoke/audioMixBus";
import { saveKaraokeRecording } from "@/lib/karaoke/recordings.functions";

export interface UseKaraokeMixBusOptions {
  roomId: string;
  /** True when the current local user is the active performer. */
  isMyTurn: boolean;
  /** True when the singer's mic is requested-on (driven by KaraokeMusicBoard). */
  micWanted: boolean;
  /** Currently-playing song metadata (for recording rows). */
  currentSong?: {
    title?: string | null;
    artist?: string | null;
    youtubeId?: string | null;
  };
}

export interface UseKaraokeMixBusResult {
  /** The mix bus instance, or null until the singer enables their mic. */
  bus: KaraokeMixBus | null;
  /** Register a karaoke music `<audio>` element so its audio joins the mix. */
  registerMusicElement: (el: HTMLAudioElement | null) => void;
  /** True while the singer's voice is going out through LiveKit. */
  live: boolean;
  /** True while a take is being captured by MediaRecorder. */
  recording: boolean;
  /** Last upload result, if any. */
  lastRecordingUrl: string | null;
  /** Force-reinit the mic + AudioContext (used by the diagnostics panel). */
  reconnect: () => Promise<void>;
  /** Manually toggle the recorder. */
  startRecording: () => void;
  stopRecording: () => Promise<void>;
  /** Mic analyser for level meter UI. */
  micAnalyser: AnalyserNode | null;
  /** Mix-bus analyser for the broadcast-level meter UI. */
  mixAnalyser: AnalyserNode | null;
  /** Currently-running AudioContext state. */
  contextState: AudioContextState | null;
}

/**
 * Karaoke mix-bus integration:
 *
 * - Lazily constructs a KaraokeMixBus when the current user becomes the
 *   performer AND opens their mic.
 * - Replaces the LiveKit microphone publication's track with the MIXED
 *   audio (vocals + music) using setMicrophoneEnabled(false) +
 *   publishTrack(mixedAudioTrack, { source: Microphone, name: "karaoke-vocals" })
 *   so the audience hears both at once via the normal mic slot.
 * - When the performer ends a song, auto-stops the MediaRecorder, uploads
 *   the resulting blob to the `karaoke-recordings` storage bucket, and
 *   inserts a metadata row via saveKaraokeRecording.
 * - On performer change / room exit, fully cleans up nodes and tracks.
 *
 * When the user is NOT the performer this hook is mostly inert — they
 * publish the normal LiveKit mic track and just consume the singer's
 * audio via RoomAudioRenderer.
 */
export function useKaraokeMixBus({
  roomId,
  isMyTurn,
  micWanted,
  currentSong,
}: UseKaraokeMixBusOptions): UseKaraokeMixBusResult {
  const room = useRoomContext();
  const local = useLocalParticipant();
  const { user } = useAuth();
  const saveFn = useServerFn(saveKaraokeRecording);

  const busRef = useRef<KaraokeMixBus | null>(null);
  const mixedTrackRef = useRef<LocalAudioTrack | null>(null);
  const musicElRef = useRef<HTMLAudioElement | null>(null);

  const [bus, setBus] = useState<KaraokeMixBus | null>(null);
  const [live, setLive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lastRecordingUrl, setLastRecordingUrl] = useState<string | null>(null);
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const [mixAnalyser, setMixAnalyser] = useState<AnalyserNode | null>(null);
  const [contextState, setContextState] = useState<AudioContextState | null>(null);

  const registerMusicElement = useCallback((el: HTMLAudioElement | null) => {
    musicElRef.current = el;
    if (el && busRef.current) {
      busRef.current.attachMusicElement(el);
    }
  }, []);

  // ── Lifecycle: when this user is the performer + wants mic on,
  //    spin up the mix bus and publish the mixed stream.
  const teardown = useCallback(async () => {
    const t = mixedTrackRef.current;
    mixedTrackRef.current = null;
    if (t && room) {
      try {
        await room.localParticipant.unpublishTrack(t, true);
      } catch (e) {
        console.warn("[karaoke-mix] unpublish failed", e);
      }
    }
    if (busRef.current) {
      const b = busRef.current;
      busRef.current = null;
      setBus(null);
      setMicAnalyser(null);
      setMixAnalyser(null);
      await b.dispose().catch(() => undefined);
    }
    setLive(false);
  }, [room]);

  const startSession = useCallback(async () => {
    if (!room) return;
    if (busRef.current) return;
    await ensureAudioContextRunning();
    const b = new KaraokeMixBus({ monitor: false });
    busRef.current = b;
    setBus(b);
    setContextState(b.ctx.state);
    try {
      // Ensure LiveKit's default mic publication is OFF first — we'll publish
      // our own mixed track in its place.
      try {
        await local.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* noop */
      }
      await b.attachMic();
      if (musicElRef.current) b.attachMusicElement(musicElRef.current);

      const mixedTrack = b.broadcastTrack();
      if (!mixedTrack) throw new Error("Mix bus produced no track");
      const lkTrack = new LocalAudioTrack(mixedTrack, undefined, false);
      await room.localParticipant.publishTrack(lkTrack, {
        source: Track.Source.Microphone,
        name: "karaoke-mix",
      });
      mixedTrackRef.current = lkTrack;
      setMicAnalyser(b.getMicAnalyser());
      setMixAnalyser(b.attachMixAnalyser());
      setLive(true);
    } catch (e) {
      console.warn("[karaoke-mix] startSession failed", e);
      toast.error(
        e instanceof Error ? e.message : "Couldn't start karaoke audio. Check microphone permission.",
      );
      await teardown();
    }
  }, [room, local.localParticipant, teardown]);

  useEffect(() => {
    if (isMyTurn && micWanted) {
      void startSession();
    } else {
      void teardown();
    }
    return () => {
      // Final cleanup happens via teardown on unmount path below
    };
  }, [isMyTurn, micWanted, startSession, teardown]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  // ── Recording: upload to bucket then insert row
  const startRecording = useCallback(() => {
    if (!busRef.current) return;
    busRef.current.startRecording();
    setRecording(true);
  }, []);

  const stopRecording = useCallback(async () => {
    const b = busRef.current;
    if (!b) return;
    setRecording(false);
    const result = await b.stopRecording().catch(() => null);
    if (!result || !user) return;
    if (result.blob.size < 4_000) {
      // Probably empty/aborted
      return;
    }
    try {
      const ext = result.mime.includes("mp4") ? "m4a" : "webm";
      const filename = `take-${Date.now()}.${ext}`;
      const storagePath = `${user.id}/${roomId}/${filename}`;
      const up = await supabase.storage
        .from("karaoke-recordings")
        .upload(storagePath, result.blob, {
          contentType: result.mime,
          upsert: false,
        });
      if (up.error) throw new Error(up.error.message);
      const { data: pub } = supabase.storage
        .from("karaoke-recordings")
        .getPublicUrl(storagePath);
      const row = await saveFn({
        data: {
          roomId,
          storagePath,
          publicUrl: pub.publicUrl,
          songTitle: currentSong?.title ?? null,
          songArtist: currentSong?.artist ?? null,
          youtubeId: currentSong?.youtubeId ?? null,
          durationMs: result.durationMs,
          mimeType: result.mime,
          hasInstrumental: !!musicElRef.current,
        },
      });
      setLastRecordingUrl(row.publicUrl);
      toast.success("Recording saved", {
        description: "Your karaoke take is ready to replay.",
      });
    } catch (e) {
      console.warn("[karaoke-mix] upload failed", e);
      toast.error(e instanceof Error ? e.message : "Couldn't save recording");
    }
  }, [user, roomId, currentSong?.title, currentSong?.artist, currentSong?.youtubeId, saveFn]);

  // Auto-record while live
  useEffect(() => {
    if (!busRef.current) return;
    if (live && !busRef.current.isRecording()) {
      startRecording();
    }
    if (!live && busRef.current.isRecording()) {
      void stopRecording();
    }
  }, [live, startRecording, stopRecording]);

  const reconnect = useCallback(async () => {
    await teardown();
    if (isMyTurn && micWanted) {
      await startSession();
    }
  }, [teardown, startSession, isMyTurn, micWanted]);

  return {
    bus,
    registerMusicElement,
    live,
    recording,
    lastRecordingUrl,
    reconnect,
    startRecording,
    stopRecording,
    micAnalyser,
    mixAnalyser,
    contextState,
  };
}
