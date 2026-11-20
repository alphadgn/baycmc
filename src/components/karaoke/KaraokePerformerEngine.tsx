/**
 * KaraokePerformerEngine — mounted INSIDE <LiveKitRoom> for karaoke rooms.
 *
 * How real karaoke apps work (Smule, StarMaker, KaraFun Party, Singa):
 *   the backing track and the voice are mixed ON THE SINGER'S DEVICE and the
 *   audience receives ONE stream, so voice and music can never drift apart.
 *
 * The previous build did the opposite: every viewer played their own copy of
 * the YouTube video (started at different moments) while the singer's voice
 * arrived separately over LiveKit — out of sync by seconds — and phones
 * couldn't share music at all. The KaraokeMixBus already existed but was
 * never mounted, so recordings were never made either.
 *
 * For the singer this engine:
 *   1. builds the mix bus (mic → compressor ─┐
 *                          backing track ────┼─► one LiveKit track "karaoke-mix")
 *                          YouTube tab audio ┘
 *   2. plays uploaded backing tracks locally (works on phones) in step with the
 *      server-authoritative play/pause/seek state,
 *   3. records every performance and uploads it as a replayable take.
 * For everyone it reports whether the singer is on air and whether their
 * music is inside the mix (so listeners mute their local YouTube copy).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  AudioPresets,
  LocalAudioTrack,
  ParticipantEvent,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from "livekit-client";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  KaraokeMixBus,
  ensureAudioContextRunning,
  setKaraokeAudioSession,
  getBackingElement,
} from "@/lib/karaoke/audioMixBus";
import { addPendingTake, usePendingTakes } from "@/lib/karaoke/pendingTakes";
import {
  appendDraftChunk,
  deleteDraft,
  putDraft,
  setDraftLive,
} from "@/lib/karaoke/pendingTakesDb";
import {
  assessTake,
  classifyTakeEnd,
  shouldKeepRecording,
  shouldStartTake,
} from "@/lib/karaoke/takeLifecycle";
import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";
import {
  getKaraokeStage,
  livePositionMs,
  patchKaraokeStage,
  useKaraokeStage,
} from "@/lib/karaoke/stageStore";

const MIX_TRACK_NAME = "karaoke-mix";

export function KaraokePerformerEngine({ roomId }: { roomId: string }) {
  const room = useRoomContext();
  const stage = useKaraokeStage();
  // ONE mic switch for the whole room: the bottom-bar Mic, the preferences
  // panel and the karaoke machine all read/write prefs.micEnabled. For the
  // singer it means "my voice is in the mix".
  const { prefs, setPrefs } = useRoomPreferences();
  const micWanted = prefs.micEnabled;

  const busRef = useRef<KaraokeMixBus | null>(null);
  const micAttachedRef = useRef<{ headphones: boolean } | null>(null);
  const publishedRef = useRef<LocalAudioTrack | null>(null);
  const publishingRef = useRef(false);
  const [published, setPublished] = useState(false);
  const recKeyRef = useRef<string | null>(null);
  // Everything about the take is captured when recording STARTS (including
  // who is singing), so it can't be lost if the stage resets while the take
  // is being closed (leaving the room used to drop the take silently).
  const recMetaRef = useRef<{
    takeId: string;
    userId: string;
    startedAt: number;
    title: string | null;
    artist: string | null;
    youtubeId: string | null;
    backingTrackId: string | null;
    reservationId: string | null;
    generation: number;
  } | null>(null);
  /** The song whose take was just closed — no second take of it (see shouldStartTake). */
  const closedSongKeyRef = useRef<string | null>(null);
  /** Last time LiveKit or the network dropped (for "your connection dropped"). */
  const lastDisconnectAtRef = useRef(0);

  const active = stage.isMyTurn && stage.roomId === roomId;
  const session = stage.session;
  const songKey =
    session && (session.backing_track_id || session.video_id)
      ? `${session.generation}:${session.backing_track_id ?? session.video_id}`
      : null;
  const playing = session?.playback_status === "playing";
  const backingPlaying = active && !!session?.backing_track_id && playing;

  // ── Recording upload ─────────────────────────────────────────────────────
  const finishRecording = useCallback(
    async (opts: { localAction?: boolean; leaving?: boolean } = {}) => {
      const bus = busRef.current;
      const meta = recMetaRef.current;
      closedSongKeyRef.current = recKeyRef.current ?? closedSongKeyRef.current;
      recKeyRef.current = null;
      recMetaRef.current = null;
      patchKaraokeStage({ recording: false });
      if (meta) setDraftLive(meta.takeId, false);
      if (!bus || !bus.isRecording() || !meta) return;
      const result = await bus.stopRecording().catch(() => null);
      const size = result?.blob.size ?? 0;
      const durationMs = result?.durationMs ?? 0;
      const { offer, note } = assessTake({ sizeBytes: size, durationMs });
      if (!result || !offer) {
        // Never vanish without a word: nothing was captured at all.
        void deleteDraft(meta.takeId);
        toast.message("Nothing was recorded", {
          description: "Your take had no audio. Was your mic on?",
        });
        return;
      }
      const reason = classifyTakeEnd({
        localAction: !!opts.localAction,
        leaving: !!opts.leaving,
        userId: meta.userId,
        generation: meta.generation,
        serverEnd: getKaraokeStage().session?.last_end ?? null,
        recentlyDisconnected:
          Date.now() - lastDisconnectAtRef.current < 120_000 ||
          (typeof navigator !== "undefined" && navigator.onLine === false),
      });
      // Never auto-save: park the take and ask the singer (KaraokeSaveTakeDialog).
      addPendingTake({
        id: meta.takeId,
        userId: meta.userId,
        roomId,
        blob: result.blob,
        mime: result.mime,
        durationMs: result.durationMs,
        title: meta.title,
        artist: meta.artist,
        youtubeId: meta.youtubeId,
        backingTrackId: meta.backingTrackId,
        reservationId: meta.reservationId,
        generation: meta.generation,
        hasInstrumental: !!meta.backingTrackId || bus.hasMusicStream(),
        reason,
        note,
        createdAt: meta.startedAt,
      });
    },
    [roomId],
  );

  // End Performance: close the take first so the singer decides Save/Discard
  // before the stage is handed to the next person in line.
  useEffect(() => {
    function onFinish() {
      void finishRecording({ localAction: true }).finally(() =>
        window.dispatchEvent(new Event("karaoke:take-finished")),
      );
    }
    window.addEventListener("karaoke:finish-take", onFinish);
    return () => window.removeEventListener("karaoke:finish-take", onFinish);
  }, [finishRecording]);

  // ── Teardown ─────────────────────────────────────────────────────────────
  const teardown = useCallback(
    async (leaving = false) => {
      await finishRecording({ leaving });
      const t = publishedRef.current;
      publishedRef.current = null;
      setPublished(false);
      if (t && room) {
        await room.localParticipant.unpublishTrack(t, true).catch(() => undefined);
      }
      const el = typeof window !== "undefined" ? getBackingElement() : null;
      if (el) {
        el.pause();
      }
      const bus = busRef.current;
      busRef.current = null;
      micAttachedRef.current = null;
      if (bus) await bus.dispose().catch(() => undefined);
      void room?.localParticipant.setAttributes({ karaokeMusic: "" }).catch(() => undefined);
      patchKaraokeStage({ engineLive: false, recording: false, musicInMyMix: false });
      window.dispatchEvent(new CustomEvent("karaoke:mic-state", { detail: { enabled: false } }));
    },
    [finishRecording, room],
  );

  // 1. Bus lifecycle — exists for as long as I'm the performer.
  useEffect(() => {
    if (!active) {
      if (busRef.current) void teardown();
      return;
    }
    if (!busRef.current) {
      const s = getKaraokeStage();
      busRef.current = new KaraokeMixBus({ monitor: false, musicGainValue: s.musicVolume });
      busRef.current.setMicGain(s.micVolume);
      busRef.current.attachMusicElement(getBackingElement());
      void ensureAudioContextRunning();
    }
  }, [active, teardown]);

  useEffect(() => () => void teardown(true), [teardown]);

  // Remember connection drops so a turn lost to one says so on the prompt.
  useEffect(() => {
    const mark = () => {
      lastDisconnectAtRef.current = Date.now();
    };
    room?.on(RoomEvent.Reconnecting, mark).on(RoomEvent.Disconnected, mark);
    window.addEventListener("offline", mark);
    return () => {
      room?.off(RoomEvent.Reconnecting, mark).off(RoomEvent.Disconnected, mark);
      window.removeEventListener("offline", mark);
    };
  }, [room]);
  useEffect(() => {
    patchKaraokeStage({ engineMounted: true });
    return () => patchKaraokeStage({ engineMounted: false });
  }, []);

  // 2. Mic attach / detach (re-acquire when the headphone mode changes).
  useEffect(() => {
    const bus = busRef.current;
    if (!active || !bus) return;
    if (!micWanted) {
      if (micAttachedRef.current) {
        bus.detachMic();
        micAttachedRef.current = null;
      }
      return;
    }
    if (micAttachedRef.current?.headphones === stage.headphones) return;
    micAttachedRef.current = { headphones: stage.headphones };
    void bus.attachMic(undefined, { headphones: stage.headphones }).catch((e) => {
      micAttachedRef.current = null;
      setPrefs({ micEnabled: false });
      toast.error("Microphone unavailable", {
        description: e instanceof Error ? e.message : "Allow microphone access and try again.",
      });
    });
  }, [active, micWanted, stage.headphones]);

  // Steady music level on iPhone: one audio-session mode for the whole turn.
  useEffect(() => {
    if (!active) return;
    setKaraokeAudioSession(true);
    return () => setKaraokeAudioSession(false);
  }, [active]);

  // Hear yourself in headphones (the Voice slider sets the level). Never on
  // speaker mode — the phone speaker would feed back into the mic.
  useEffect(() => {
    busRef.current?.setVoiceMonitor(active && micWanted && stage.headphones);
  }, [active, micWanted, stage.headphones]);

  // 3. Volumes.
  useEffect(() => {
    busRef.current?.setMusicGain(stage.musicVolume);
  }, [stage.musicVolume, active]);
  useEffect(() => {
    busRef.current?.setMicGain(stage.micVolume);
  }, [stage.micVolume, active]);

  // 4. Publish the mixed track while there is something to hear.
  const shouldPublish = active && (micWanted || backingPlaying || stage.musicInMyMix);
  useEffect(() => {
    const bus = busRef.current;
    if (!room || !bus) return;
    if (shouldPublish && !publishedRef.current && !publishingRef.current) {
      publishingRef.current = true;
      void (async () => {
        try {
          // The raw mic would double the voice — the mix replaces it.
          // Unpublish (not just mute) so the singer has exactly one
          // Microphone-source track and listeners see the right on-air state.
          for (const pub of room.localParticipant.audioTrackPublications.values()) {
            if (
              pub.source === Track.Source.Microphone &&
              pub.trackName !== MIX_TRACK_NAME &&
              pub.track
            ) {
              await room.localParticipant.unpublishTrack(pub.track, true).catch(() => undefined);
            }
          }
          const mixed = bus.broadcastTrack();
          if (!mixed) throw new Error("Mix bus produced no audio track");
          const lk = new LocalAudioTrack(mixed, undefined, false);
          await room.localParticipant.publishTrack(lk, {
            source: Track.Source.Microphone,
            name: MIX_TRACK_NAME,
            audioPreset: AudioPresets.musicHighQuality,
            dtx: false, // DTX treats sustained music as "silence" and drops it
            red: true,
          });
          if (busRef.current === bus) {
            publishedRef.current = lk;
            setPublished(true);
          } else await room.localParticipant.unpublishTrack(lk, true).catch(() => undefined);
        } catch (e) {
          console.warn("[karaoke-engine] publish failed", e);
          toast.error("Couldn't put you on air", {
            description: e instanceof Error ? e.message : "Check microphone permission.",
          });
          setPrefs({ micEnabled: false });
        } finally {
          publishingRef.current = false;
        }
      })();
    } else if (!shouldPublish && publishedRef.current) {
      const t = publishedRef.current;
      publishedRef.current = null;
      setPublished(false);
      void room.localParticipant.unpublishTrack(t, true).catch(() => undefined);
    }
  }, [shouldPublish, room]);

  useEffect(() => {
    const live = active && micWanted && published;
    patchKaraokeStage({ engineLive: live });
    window.dispatchEvent(new CustomEvent("karaoke:mic-state", { detail: { enabled: live } }));
  }, [active, micWanted, published]);

  // 5. Uploaded backing track: follow the server's play / pause / seek.
  const backingUrl = active ? (stage.backingTrack?.url ?? null) : null;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = getBackingElement();
    if (!active || !session?.backing_track_id || !backingUrl) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.src !== backingUrl) {
      el.src = backingUrl;
      el.load();
    }
    const target = livePositionMs(session) / 1000;
    if (session.playback_status === "playing") {
      if (Math.abs(el.currentTime - target) > 1.5 && Number.isFinite(target)) {
        try {
          el.currentTime = target;
        } catch {
          /* metadata not loaded yet — seek after canplay below */
        }
      }
      void ensureAudioContextRunning();
      el.play().catch((e) => {
        console.warn("[karaoke-engine] backing play blocked", e);
        toast.message("Tap ▶ to start the music", {
          description: "Your browser needs one more tap before it will play audio.",
        });
      });
    } else {
      el.pause();
      if (session.playback_status !== "paused") el.currentTime = 0;
    }
  }, [active, backingUrl, session]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = getBackingElement();
    const onTime = () =>
      patchKaraokeStage({
        backingPositionMs: Math.round(el.currentTime * 1000),
        backingDurationMs: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0,
      });
    const onEnded = () => {
      if (getKaraokeStage().isMyTurn) window.dispatchEvent(new Event("karaoke:backing-ended"));
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
    };
  }, []);

  // 6. YouTube on desktop: capture this tab's audio INTO the mix.
  useEffect(() => {
    function onPublish() {
      const bus = busRef.current;
      if (!bus || !getKaraokeStage().isMyTurn) return;
      if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
        toast.error("This device can't share YouTube audio", {
          description: "Upload the instrumental under My tracks — uploaded tracks work on phones.",
        });
        return;
      }
      // Called synchronously from the click so the share picker may open.
      navigator.mediaDevices
        .getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        .then((stream) => {
          stream.getVideoTracks().forEach((t) => t.stop());
          const a = stream.getAudioTracks()[0];
          if (!a) {
            stream.getTracks().forEach((t) => t.stop());
            toast.error("No tab audio captured", {
              description: "Pick 'This tab' and switch on 'Share tab audio'.",
            });
            return;
          }
          if (busRef.current !== bus) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          bus.attachMusicStream(new MediaStream([a]));
          a.addEventListener("ended", () => {
            bus.detachMusicStream();
            patchKaraokeStage({ musicInMyMix: false });
          });
          patchKaraokeStage({ musicInMyMix: true });
          toast.success("The room now hears the music in sync with your voice.");
        })
        .catch(() => {
          toast.error("Tab audio wasn't shared.");
        });
    }
    function onUnpublish() {
      busRef.current?.detachMusicStream();
      patchKaraokeStage({ musicInMyMix: false });
    }
    window.addEventListener("karaoke:publish-music", onPublish);
    window.addEventListener("karaoke:unpublish-music", onUnpublish);
    return () => {
      window.removeEventListener("karaoke:publish-music", onPublish);
      window.removeEventListener("karaoke:unpublish-music", onUnpublish);
    };
  }, []);

  useEffect(() => {
    if (!room) return;
    void room.localParticipant
      .setAttributes({ karaokeMusic: active && stage.musicInMyMix ? "1" : "" })
      .catch(() => undefined);
  }, [room, active, stage.musicInMyMix]);

  // 7. Record each performance (one take per song).
  //
  // A take lives exactly as long as the PERFORMANCE: from the song starting
  // until Stop (song cleared), a new song, the turn ending or leaving the
  // room. Mute and Pause never end it — the recorder has its own feed from
  // the mix bus, so it doesn't depend on being on air. (It used to require
  // `published`; muting the mic during a YouTube song took the mix off air,
  // which ended the take and popped "Save this performance?" mid-song.)
  const myTakes = usePendingTakes(stage.userId);
  const promptPending = myTakes.some((t) => t.roomId === roomId);
  useEffect(() => {
    const bus = busRef.current;
    const wantRecord =
      !!bus &&
      shouldKeepRecording({
        active,
        recordingEnabled: stage.settings.recording_enabled,
        songKey,
      });
    // A cleared song resets the guard: the same song may be sung again.
    if (!songKey) closedSongKeyRef.current = null;
    if (!wantRecord) {
      // Still my turn → I pressed Stop (song cleared) or recording was
      // switched off. Turn over → teardown (effect 1) closes the take.
      if (recKeyRef.current) void finishRecording({ localAction: active });
      return;
    }
    if (recKeyRef.current && recKeyRef.current !== songKey) {
      // New song: close the previous take (its recorder detaches
      // synchronously) and fall through to start the next one.
      void finishRecording({ localAction: true });
      closedSongKeyRef.current = null;
    }
    const userId = stage.userId;
    if (
      userId &&
      session &&
      shouldStartTake({
        wantRecord,
        recording: !!recKeyRef.current,
        playing,
        promptPending,
        songKey,
        closedSongKey: closedSongKeyRef.current,
      })
    ) {
      try {
        const takeId = `${roomId}:${session.generation}:${Date.now()}`;
        const meta = {
          takeId,
          userId,
          startedAt: Date.now(),
          title: session.song_title ?? stage.backingTrack?.title ?? null,
          artist: session.song_artist ?? stage.backingTrack?.artist ?? null,
          youtubeId: session.video_id,
          backingTrackId: session.backing_track_id,
          reservationId: session.reservation_id,
          generation: session.generation,
        };
        setDraftLive(takeId, true);
        bus.startRecording((chunk, seq) => void appendDraftChunk(takeId, seq, chunk));
        // Keep the take on the device while it records, so closing the tab
        // mid-song still leaves something to Save / Discard next visit.
        void putDraft({
          id: takeId,
          userId,
          roomId,
          mime: bus.recordingMime() || "audio/webm",
          title: meta.title,
          artist: meta.artist,
          youtubeId: meta.youtubeId,
          backingTrackId: meta.backingTrackId,
          reservationId: meta.reservationId,
          generation: meta.generation,
          hasInstrumental: !!meta.backingTrackId,
          createdAt: meta.startedAt,
          startedAt: meta.startedAt,
          updatedAt: meta.startedAt,
        });
        recKeyRef.current = songKey;
        recMetaRef.current = meta;
        patchKaraokeStage({ recording: true });
      } catch (e) {
        console.warn("[karaoke-engine] recorder unavailable", e);
      }
      return;
    }
    if (recKeyRef.current) {
      if (session?.playback_status === "paused") bus?.pauseRecording();
      else if (playing) bus?.resumeRecording();
    }
  }, [
    active,
    songKey,
    playing,
    session,
    roomId,
    promptPending,
    stage.userId,
    stage.settings.recording_enabled,
    stage.backingTrack,
    finishRecording,
  ]);

  // 8. Everyone: is the performer on air, and is their music in the mix?
  const performerId = session?.performer_user_id ?? null;
  useEffect(() => {
    if (!room) return;
    const compute = () => {
      const s = getKaraokeStage();
      if (!performerId) {
        patchKaraokeStage({ performerLive: false, performerMusicInMix: false });
        return;
      }
      if (performerId === room.localParticipant.identity) {
        patchKaraokeStage({ performerLive: s.engineLive, performerMusicInMix: s.musicInMyMix });
        return;
      }
      const p = room.remoteParticipants.get(performerId) as RemoteParticipant | undefined;
      const mic = p?.getTrackPublication(Track.Source.Microphone);
      patchKaraokeStage({
        performerLive: !!mic && !mic.isMuted,
        performerMusicInMix: p?.attributes?.karaokeMusic === "1",
      });
    };
    compute();
    const evs = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantAttributesChanged,
    ] as const;
    evs.forEach((e) => room.on(e, compute));
    room.localParticipant.on(ParticipantEvent.LocalTrackPublished, compute);
    room.localParticipant.on(ParticipantEvent.LocalTrackUnpublished, compute);
    return () => {
      evs.forEach((e) => room.off(e, compute));
      room.localParticipant.off(ParticipantEvent.LocalTrackPublished, compute);
      room.localParticipant.off(ParticipantEvent.LocalTrackUnpublished, compute);
    };
  }, [room, performerId, stage.engineLive, stage.musicInMyMix]);

  return null;
}
