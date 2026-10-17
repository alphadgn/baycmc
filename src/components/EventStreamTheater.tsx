import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { Camera, CameraOff, Loader2, Mic, MicOff, Radio, RefreshCw, LogOut } from "lucide-react";
import { getLivekitToken } from "@/server/livekit.functions";
import { useAuth } from "@/lib/auth/useAuth";

type Phase =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "error"; message: string }
  | { phase: "live"; token: string; url: string; canPublish: boolean };

/**
 * Event Stream — a movie-theatre style, watch-only room. The host (an
 * account the super admin assigned) broadcasts from their phone; up to 250
 * verified holders watch. Viewers never publish (LiveKit refuses it).
 */
export function EventStreamTheater({
  roomId,
  capacity,
  goLive = false,
}: {
  roomId: string;
  capacity: number;
  /** Arrived from the "you're hosting" notification. */
  goLive?: boolean;
}) {
  const getToken = useServerFn(getLivekitToken);
  const [state, setState] = useState<Phase>({ phase: "idle" });

  const join = useCallback(async () => {
    setState({ phase: "connecting" });
    try {
      const res = await getToken({ data: { roomId } });
      if (!res.ok) {
        toast.error(res.error);
        setState({ phase: "error", message: res.error });
        return;
      }
      setState({
        phase: "live",
        token: res.token,
        url: res.url,
        canPublish: !!res.canPublish,
      });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Couldn't join." });
    }
  }, [getToken, roomId]);

  // Walk straight in — this is a theatre, not a lobby.
  useEffect(() => {
    void join();
  }, [join]);

  return (
    <div className="relative flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-[#070504]">
      <TheaterTop />
      {state.phase === "live" ? (
        <LiveKitRoom
          token={state.token}
          serverUrl={state.url}
          connect
          audio={false}
          video={false}
          onDisconnected={() => setState({ phase: "idle" })}
          style={{ background: "transparent" }}
          className="relative z-10 flex flex-1 flex-col"
        >
          <RoomAudioRenderer />
          <Stage capacity={capacity} tokenCanPublish={state.canPublish} goLive={goLive} />
        </LiveKitRoom>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          {state.phase === "error" ? (
            <>
              <p className="max-w-sm text-sm text-muted-foreground">{state.message}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void join()}
                  className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground"
                >
                  Try again
                </button>
                <Link to="/lobby" className="rounded-md border border-border px-4 py-2 text-sm">
                  Back to lobby
                </Link>
              </div>
            </>
          ) : state.phase === "idle" ? (
            <button
              type="button"
              onClick={() => void join()}
              className="rounded-md bg-gradient-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold"
            >
              Take your seat
            </button>
          ) : (
            <p className="flex items-center gap-2 text-sm text-gold">
              <Loader2 className="h-4 w-4 animate-spin" /> Finding your seat…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Velvet curtains, marquee lights and a proscenium arch — top of page only. */
function TheaterTop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-0 h-40 sm:h-52">
      {/* curtain folds */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "repeating-linear-gradient(90deg, #3a0a0c 0px, #6b1418 14px, #8a1c20 22px, #5a1013 34px, #3a0a0c 44px)",
          maskImage: "linear-gradient(to bottom, black 35%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 35%, transparent 100%)",
        }}
      />
      {/* valance with gold trim */}
      <div className="absolute inset-x-0 top-0 h-7 bg-gradient-to-b from-[#4a0d10] to-[#2a0608] shadow-[0_6px_16px_rgba(0,0,0,0.6)]">
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-gold" />
      </div>
      {/* marquee bulbs */}
      <div className="absolute inset-x-6 top-9 flex justify-between">
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_2px_oklch(0.82_0.15_80/0.7)]"
            style={{ animation: `pulse 1.6s ease-in-out ${(i % 3) * 0.3}s infinite` }}
          />
        ))}
      </div>
      {/* marquee title */}
      <div className="absolute inset-x-0 top-12 flex justify-center">
        <span className="rounded-sm border border-gold/60 bg-black/70 px-4 py-1 font-display text-sm uppercase tracking-[0.35em] text-gold shadow-gold">
          Event Stream
        </span>
      </div>
      {/* arch fade into the dark theatre */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[#070504]" />
    </div>
  );
}

function Stage({
  capacity,
  tokenCanPublish,
  goLive,
}: {
  capacity: number;
  tokenCanPublish: boolean;
  goLive: boolean;
}) {
  const { user } = useAuth();
  // Live permission: a super admin can assign (or remove) a host while they
  // are already in the room — LiveKit pushes the change, no rejoin needed.
  const perms = useLocalParticipantPermissions();
  const canPublish = perms ? !!perms.canPublish : tokenCanPublish;
  const [wasHost, setWasHost] = useState(canPublish);
  useEffect(() => {
    if (canPublish && !wasHost) {
      toast.success("You're now an Event Stream host — tap Start streaming to go live.", {
        duration: 10_000,
      });
    } else if (!canPublish && wasHost) {
      toast.info("You're no longer a host for the Event Stream.");
    }
    setWasHost(canPublish);
  }, [canPublish, wasHost]);
  const participants = useParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.ScreenShare, withPlaceholder: false },
      { source: Track.Source.Camera, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const feature = tracks.find((t) => t.publication && !t.publication.isMuted) ?? tracks[0];

  // Broadcasters publish tracks; everyone else is an audience member.
  const audience = useMemo(
    () => participants.filter((p) => p.trackPublications.size === 0 || p.identity === user?.id),
    [participants, user?.id],
  );
  const hosts = participants.filter((p) => p.trackPublications.size > 0);
  const viewers = participants.length - hosts.length;
  const live = hosts.length > 0;

  return (
    <div className="flex flex-1 flex-col pt-24 sm:pt-32">
      {/* Main screen — full width, 16:9 (≈ a third of a phone screen). */}
      <div className="mx-auto w-full max-w-6xl px-2 sm:px-4">
        <div className="relative aspect-video w-full overflow-hidden rounded-md border-2 border-gold/50 bg-black shadow-[0_0_60px_-10px_oklch(0.82_0.15_80/0.45)]">
          {feature?.publication ? (
            <VideoTrack trackRef={feature} className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
              <Radio className="h-8 w-8 text-gold/60" />
              <p className="font-display text-lg text-gold">The show starts soon</p>
              <p className="text-xs text-muted-foreground">
                Stay seated — the stream appears here when the host goes live.
              </p>
            </div>
          )}
          {live && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
            </span>
          )}
          {/* Viewer count — numbers only, bottom corner. */}
          <div className="absolute bottom-2 right-2 flex items-baseline gap-1.5 rounded-sm bg-black/75 px-2 py-1 text-[10px] uppercase tracking-wider text-gold/80 backdrop-blur">
            <span>Viewers</span>
            <span className="font-mono text-sm font-semibold text-gold">
              {viewers}/{capacity}
            </span>
            <span>Capacity</span>
          </div>
        </div>
        {canPublish && <HostControls highlight={goLive} />}
      </div>

      {/* Seats — proof of attendance. You're highlighted; others are greyed. */}
      <div className="mx-auto mt-5 w-full max-w-6xl flex-1 px-2 pb-6 sm:px-4">
        <p className="mb-2 text-center text-[10px] uppercase tracking-[0.3em] text-gold/60">
          In the audience
        </p>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10 lg:grid-cols-14">
          {audience.map((p) => {
            const me = p.identity === user?.id;
            const name = abbreviate(p.name || "Guest");
            return (
              <div
                key={p.identity}
                title={p.name || "Guest"}
                className={`flex h-9 flex-col items-center justify-end rounded-t-lg border-b-2 px-0.5 pb-0.5 ${
                  me
                    ? "border-gold bg-gold/20 shadow-[0_0_12px_oklch(0.82_0.15_80/0.6)] ring-1 ring-gold"
                    : "border-border/40 bg-secondary/20 opacity-50 grayscale"
                }`}
              >
                <span
                  className={`truncate text-[8px] leading-tight ${me ? "font-bold text-gold" : "text-muted-foreground"}`}
                >
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function abbreviate(name: string) {
  const n = name.trim();
  return n.length > 9 ? `${n.slice(0, 8)}…` : n;
}

/** Shown only to assigned hosts: go live from this phone. */
function HostControls({ highlight }: { highlight: boolean }) {
  const { localParticipant, isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
  const streaming = isCameraEnabled || isMicrophoneEnabled;
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Device error");
    } finally {
      setBusy(false);
    }
  }
  const btn =
    "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-50";
  if (!streaming) {
    // One tap: camera + mic on together → the stream appears on the main
    // screen for every viewer.
    return (
      <div
        className={`mt-3 flex flex-col items-center gap-2 rounded-xl border px-4 py-3 text-center ${
          highlight
            ? "border-gold bg-gold/10 shadow-[0_0_30px_-6px_oklch(0.82_0.15_80/0.6)]"
            : "border-gold/30 bg-black/40"
        }`}
      >
        <p className="text-xs text-gold/90">
          You're a host. Your camera and mic go out to everyone in the theatre.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await localParticipant.setCameraEnabled(true, { facingMode: facing });
              await localParticipant.setMicrophoneEnabled(true);
              toast.success("You're live.");
            })
          }
          className="inline-flex items-center gap-2 rounded-md bg-gradient-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
          Start streaming
        </button>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Camera:</span>
          <button
            type="button"
            onClick={() => setFacing("environment")}
            className={facing === "environment" ? "text-gold underline" : ""}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => setFacing("user")}
            className={facing === "user" ? "text-gold underline" : ""}
          >
            Selfie
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
      <span className="mr-1 text-[10px] uppercase tracking-wider text-gold/70">Host · Live</span>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(() =>
            localParticipant.setCameraEnabled(!isCameraEnabled, { facingMode: facing }),
          )
        }
        className={`${btn} ${isCameraEnabled ? "border-emerald-400/50 text-emerald-300" : "border-gold/40 text-gold"}`}
      >
        {isCameraEnabled ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
        {isCameraEnabled ? "Camera on" : "Camera off"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled))}
        className={`${btn} ${isMicrophoneEnabled ? "border-emerald-400/50 text-emerald-300" : "border-gold/40 text-gold"}`}
      >
        {isMicrophoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        {isMicrophoneEnabled ? "Mic on" : "Mic off"}
      </button>
      {isCameraEnabled && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const next = facing === "environment" ? "user" : "environment";
            setFacing(next);
            void run(async () => {
              await localParticipant.setCameraEnabled(false);
              await localParticipant.setCameraEnabled(true, { facingMode: next });
            });
          }}
          className={`${btn} border-gold/40 text-gold`}
        >
          <RefreshCw className="h-4 w-4" /> Flip
        </button>
      )}
      {(isCameraEnabled || isMicrophoneEnabled) && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await localParticipant.setCameraEnabled(false);
              await localParticipant.setMicrophoneEnabled(false);
            })
          }
          className={`${btn} border-destructive/50 text-destructive`}
        >
          <LogOut className="h-4 w-4" /> End broadcast
        </button>
      )}
    </div>
  );
}
