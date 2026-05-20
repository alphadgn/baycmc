import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  getLivekitToken,
  revalidateLivekitRoomAccess,
  setRoomLocked,
  kickRoomParticipant,
  muteAllRoomParticipants,
} from "@/server/livekit.functions";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionQualityIndicator,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useRoomInfo,
} from "@livekit/components-react";
import { ConnectionQuality } from "livekit-client";
import { AmaConference } from "@/components/AmaConference";
import "@livekit/components-styles";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Lock,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  RefreshCw,
  UserMinus,
  Users,
  Video as VideoIcon,
  VideoOff,
} from "lucide-react";
import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";
import { RoomsShell } from "@/components/RoomsShell";

interface ConferenceRoomProps {
  roomId: string;
  roomName: string;
  ambience?: string | null;
  backgroundImage?: string | null;
  kind?: "conference" | "game";
  /** Booking owner of the currently-active slot, or null for free-use sessions. */
  hostUserId?: string | null;
}

type JoinState =
  | { phase: "idle" }
  | { phase: "connecting"; progress: number }
  | { phase: "live"; token: string; url: string; isHost: boolean }
  | { phase: "error"; message: string; recoverable: boolean; accessLoss?: boolean };

/**
 * Room-detail page surface. Owns the connection state machine and renders
 * the RoomsShell layout in every phase (idle / connecting / error / live)
 * so the user never sees the layout shift between phases.
 */
export function ConferenceRoom({
  roomId,
  roomName,
  ambience = null,
  backgroundImage = null,
  kind = "conference",
  hostUserId = null,
}: ConferenceRoomProps) {
  const [state, setState] = useState<JoinState>({ phase: "idle" });
  const getToken = useServerFn(getLivekitToken);
  const revalidateAccess = useServerFn(revalidateLivekitRoomAccess);
  const navigate = useNavigate();
  const { prefs } = useRoomPreferences();

  const progressTimer = useRef<number | null>(null);

  const join = useCallback(async () => {
    setState({ phase: "connecting", progress: 5 });
    if (progressTimer.current) window.clearInterval(progressTimer.current);
    progressTimer.current = window.setInterval(() => {
      setState((prev) =>
        prev.phase === "connecting"
          ? { phase: "connecting", progress: Math.min(prev.progress + 7, 85) }
          : prev,
      );
    }, 220);

    try {
      const res = await getToken({ data: { roomId } });
      if (!res.ok) {
        const accessLoss =
          "code" in res && (res.code === "bayc_revoked" || res.code === "otherpage_revoked");
        if (accessLoss) {
          toast.error("Exclusive room locked", { description: res.error, duration: 8000 });
        } else if ("code" in res && res.code === "room_locked") {
          toast.error("Room is locked", { description: res.error, duration: 6000 });
        } else {
          toast.error(res.error);
        }
        setState({ phase: "error", message: res.error, recoverable: !accessLoss, accessLoss });
        return;
      }
      setState({
        phase: "live",
        token: res.token,
        url: res.url,
        isHost: !!res.isHost,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to join";
      toast.error(message);
      setState({ phase: "error", message, recoverable: true });
    } finally {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
    }
  }, [getToken, roomId]);

  // Auto-join on mount and re-join when the user lands on a different room.
  useEffect(() => {
    void join();
    return () => {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Periodic re-validation while live — drop the user out if their delegation
  // got revoked or the host locked the room mid-call.
  useEffect(() => {
    if (state.phase !== "live") return;
    let cancelled = false;
    async function checkAccess() {
      const res = await revalidateAccess({ data: { roomId } }).catch(() => null);
      if (cancelled || !res || res.ok) return;
      setState({ phase: "error", message: res.error, recoverable: false, accessLoss: true });
      toast.error("Access changed", { description: res.error, duration: 8000 });
    }
    const interval = window.setInterval(checkAccess, 30_000);
    window.addEventListener("focus", checkAccess);
    document.addEventListener("visibilitychange", checkAccess);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkAccess);
      document.removeEventListener("visibilitychange", checkAccess);
    };
  }, [state.phase, roomId, revalidateAccess]);

  const goBack = useCallback(() => {
    void navigate({ to: "/rooms" });
  }, [navigate]);

  // ─── LIVE PHASE ──────────────────────────────────────────────────────────
  if (state.phase === "live") {
    return (
      <LiveKitRoom
        token={state.token}
        serverUrl={state.url}
        connect
        // Auto-publish mic/cam tracks based on saved prefs the moment we
        // connect — otherwise users had to toggle each control off-then-on
        // before LiveKit would acquire the device.
        audio={prefs.micEnabled}
        video={prefs.cameraEnabled}
        data-lk-theme="default"
        onDisconnected={() => setState({ phase: "idle" })}
        // We render the LiveKit toolbar ourselves so the bottom bar matches
        // the conf.png mockup; suppress the SDK's default UI.
        style={{ background: "transparent" }}
      >
        <RoomsShell
          title={roomName}
          subtitle={ambience ?? undefined}
          backgroundImage={backgroundImage}
          rightRail={
            <LiveRightRail
              roomId={roomId}
              isHost={state.isHost}
              connecting={false}
              hostUserId={hostUserId}
            />
          }
          bottomBar={
            <LiveBottomBar
              isHost={state.isHost}
              onLeave={() => {
                setState({ phase: "idle" });
                goBack();
              }}
            />
          }
        >
          <VideoArea
            backgroundImage={backgroundImage}
            kind={kind}
            roomName={roomName}
            hostUserId={hostUserId}
          />
          <RoomAudioRenderer />
        </RoomsShell>
      </LiveKitRoom>
    );
  }

  // ─── IDLE / CONNECTING / ERROR PHASES ────────────────────────────────────
  return (
    <RoomsShell
      title={roomName}
      subtitle={ambience ?? undefined}
      backgroundImage={backgroundImage}
      rightRail={<PreLiveRightRail state={state} onRetry={() => void join()} />}
      bottomBar={<PreLiveBottomBar onLeave={goBack} />}
    >
      <PreLivePanel
        state={state}
        kind={kind}
        backgroundImage={backgroundImage}
        roomName={roomName}
        onRetry={() => void join()}
      />
    </RoomsShell>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PRE-LIVE views (idle / connecting / error)
// ────────────────────────────────────────────────────────────────────────────

function PreLivePanel({
  state,
  kind,
  backgroundImage,
  roomName,
  onRetry,
}: {
  state: JoinState;
  kind: "conference" | "game";
  backgroundImage: string | null;
  roomName: string;
  onRetry: () => void;
}) {
  const bgStyle: React.CSSProperties = backgroundImage
    ? {
        // Pre-live panel keeps a slightly stronger vignette than the live
        // video area so the join button and copy stay legible while the
        // room atmosphere still reads.
        backgroundImage: `linear-gradient(rgba(8,8,12,0.45), rgba(8,8,12,0.7)), url(${backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {};

  return (
    <div
      className="relative flex min-h-[60vh] items-center justify-center overflow-hidden rounded-2xl border border-border/60 p-6 shadow-card sm:p-10"
      style={bgStyle}
    >
      {state.phase === "connecting" && (
        <ConnectingHero progress={state.progress} roomName={roomName} />
      )}
      {state.phase === "error" && (
        <ErrorHero
          roomName={roomName}
          message={state.message}
          recoverable={state.recoverable}
          accessLoss={state.accessLoss}
          onRetry={onRetry}
        />
      )}
      {state.phase === "idle" && <IdleHero roomName={roomName} kind={kind} onJoin={onRetry} />}
    </div>
  );
}

function IdleHero({
  roomName,
  kind,
  onJoin,
}: {
  roomName: string;
  kind: "conference" | "game";
  onJoin: () => void;
}) {
  return (
    <div className="text-center">
      <h2 className="font-display text-3xl text-gradient-gold sm:text-5xl">{roomName}</h2>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground font-sans-display">
        {kind === "game"
          ? "Real-time PvP arena. Pair with another verified member and play head-to-head."
          : "Live audio + video conference. Your saved camera and microphone preferences are applied as soon as you connect."}
      </p>
      <button
        type="button"
        onClick={onJoin}
        className="mt-6 rounded-md bg-gradient-gold px-6 py-3 text-sm font-semibold text-gold-foreground shadow-gold font-sans-display"
      >
        {kind === "game" ? "Enter game room" : "Enter room"}
      </button>
    </div>
  );
}

function ConnectingHero({ progress, roomName }: { progress: number; roomName: string }) {
  return (
    <div role="status" aria-live="polite" className="text-center">
      <Loader2 className="mx-auto h-10 w-10 animate-spin text-gold" />
      <h2 className="mt-4 font-display text-2xl text-foreground sm:text-3xl">
        Connecting to {roomName}…
      </h2>
      <p className="mt-2 text-xs text-muted-foreground font-sans-display sm:text-sm">
        Verifying access, minting your LiveKit token, and opening the conference.
      </p>
      <div className="mx-auto mt-5 w-full max-w-sm">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
          <div
            className="h-full rounded-full bg-gradient-gold transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          {progress < 30 ? "Verifying holder…" : progress < 60 ? "Minting token…" : "Opening room…"}
        </p>
      </div>
    </div>
  );
}

function ErrorHero({
  roomName,
  message,
  recoverable,
  accessLoss,
  onRetry,
}: {
  roomName: string;
  message: string;
  recoverable: boolean;
  accessLoss?: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alertdialog"
      data-testid={accessLoss ? "exclusive-access-loss" : "conf-error"}
      className="text-center"
    >
      <div className="mx-auto w-fit rounded-full border border-destructive/40 bg-destructive/10 p-3">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h2 className="mt-4 font-display text-2xl text-foreground sm:text-3xl">Connection failed</h2>
      <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
        Couldn't connect to {roomName}
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm text-foreground font-sans-display">{message}</p>
      {accessLoss && (
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground font-sans-display">
          Refresh your wallet delegation or reconnect with a wallet that currently qualifies, then
          try again.
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {recoverable && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-gold px-5 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold font-sans-display"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        )}
      </div>
    </div>
  );
}

function PreLiveRightRail({ state, onRetry }: { state: JoinState; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      {state.phase === "error" && (
        <Panel
          tone="destructive"
          title="Connection Failed"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        >
          <p className="text-[11px] text-muted-foreground">{state.message}</p>
          {state.recoverable && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-[11px] font-semibold text-destructive-foreground hover:opacity-90"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          )}
        </Panel>
      )}
      {state.phase === "connecting" && (
        <Panel title="Connecting to room…" icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
            <div
              className="h-full rounded-full bg-gradient-gold transition-[width]"
              style={{ width: `${state.progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            {state.progress < 30
              ? "Verifying holder…"
              : state.progress < 60
                ? "Minting token…"
                : "Opening room…"}
          </p>
        </Panel>
      )}
      <PreferencesPanel />
      <HostControlsPlaceholder />
    </div>
  );
}

function PreLiveBottomBar({ onLeave }: { onLeave: () => void }) {
  // Pre-join mic/cam buttons mirror the saved preference (same state the
  // right-rail PreferencesPanel writes to). Clicking flips that preference,
  // so the user can stage their join-state from either control. The actual
  // LiveKit track only attaches once they join — the prefs are applied at
  // that point.
  const { prefs, setPrefs } = useRoomPreferences();
  return (
    <BottomBarShell
      onLeave={onLeave}
      controls={
        <>
          <BottomControl
            label="Mic"
            tone={prefs.micEnabled ? "active" : "off"}
            icon={prefs.micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            onClick={() => setPrefs({ micEnabled: !prefs.micEnabled })}
          />
          <BottomControl
            label="Cam"
            tone={prefs.cameraEnabled ? "active" : "off"}
            icon={
              prefs.cameraEnabled ? (
                <VideoIcon className="h-4 w-4" />
              ) : (
                <VideoOff className="h-4 w-4" />
              )
            }
            onClick={() => setPrefs({ cameraEnabled: !prefs.cameraEnabled })}
          />
          <BottomControl
            label="Share Screen"
            tone="neutral"
            icon={<Monitor className="h-4 w-4" />}
            disabled
          />
          <BottomControl
            label="Chat"
            tone="neutral"
            icon={<MessageCircle className="h-4 w-4" />}
            disabled
          />
          <BottomControl
            label="0"
            ariaLabel="Participants"
            tone="neutral"
            icon={<Users className="h-4 w-4" />}
            disabled
          />
        </>
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LIVE views (inside LiveKitRoom — can use room context hooks)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reads the room-wide mic lock the host sets via "Mute all". While true,
 * non-host members can't un-mute their microphone. Driven by LiveKit room
 * metadata so it stays in sync across every connected client.
 */
function useMicLock(): boolean {
  const { metadata } = useRoomInfo();
  return useMemo(() => {
    if (!metadata) return false;
    try {
      const parsed = JSON.parse(metadata) as { micLock?: boolean };
      return !!parsed.micLock;
    } catch {
      return false;
    }
  }, [metadata]);
}

function VideoArea({
  backgroundImage,
  kind,
  roomName,
  hostUserId,
}: {
  backgroundImage: string | null;
  kind: "conference" | "game";
  roomName: string;
  hostUserId: string | null;
}) {
  // Game rooms keep a framed stage with their own background. Conference
  // rooms render the video tiles directly on top of the page-level room
  // backdrop painted by RoomsShell — no duplicate layer, no inner shadow.
  if (kind === "game") {
    const wrapperStyle: React.CSSProperties = backgroundImage
      ? {
          backgroundImage: `linear-gradient(rgba(8,8,12,0.35), rgba(8,8,12,0.55)), url(${backgroundImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : {};
    return (
      <div
        className="overflow-hidden rounded-2xl border border-border/60 shadow-card"
        style={{ ...wrapperStyle, minHeight: "60vh" }}
      >
        <div className="h-full min-h-[60vh] bg-background/30 backdrop-blur-sm">
          <GameRoomScaffold roomName={roomName} />
        </div>
      </div>
    );
  }

  return (
    <AmaConference roomName={roomName} hostUserId={hostUserId} backgroundImage={backgroundImage} />
  );
}

function LiveRightRail({
  roomId,
  isHost,
  connecting,
  hostUserId,
}: {
  roomId: string;
  isHost: boolean;
  connecting: boolean;
  hostUserId: string | null;
}) {
  // We surface a compact "no host booked" status card here when no host is
  // present in the room — the big central HostTile has been hidden so the
  // user's own video sits in the centre of the page without scrolling.
  const participants = useParticipants();
  const hostPresent = hostUserId ? participants.some((p) => p.identity === hostUserId) : false;

  return (
    <div className="space-y-3">
      {connecting && (
        <Panel title="Connecting to room…" icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
            <div className="h-full w-1/2 rounded-full bg-gradient-gold" />
          </div>
        </Panel>
      )}
      <LivePreferencesPanel isHost={isHost} />
      {isHost && <HostControlsPanel roomId={roomId} />}
      {!hostPresent && (
        <Panel title="Session Status">
          <p className="text-[11px] text-muted-foreground">
            {hostUserId
              ? "Host hasn't joined yet — they'll appear here when they do."
              : "Open session — no host booked for this slot."}
          </p>
        </Panel>
      )}
      <ConnectionPanel />
    </div>
  );
}

/** Connection-quality readout — signal bars + label for the local user. */
function ConnectionPanel() {
  // Pass the local participant explicitly: the rail isn't wrapped in a
  // ParticipantContext, so the no-arg form would throw.
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });

  const meta: Record<ConnectionQuality, { bars: number; label: string; tone: string }> = {
    [ConnectionQuality.Excellent]: {
      bars: 4,
      label: "Excellent",
      tone: "text-emerald-300",
    },
    [ConnectionQuality.Good]: { bars: 3, label: "Good", tone: "text-emerald-300" },
    [ConnectionQuality.Poor]: { bars: 2, label: "Poor", tone: "text-amber-300" },
    [ConnectionQuality.Lost]: { bars: 0, label: "Disconnected", tone: "text-destructive" },
    [ConnectionQuality.Unknown]: { bars: 1, label: "Checking…", tone: "text-muted-foreground" },
  };
  const { bars, label, tone } = meta[quality] ?? meta[ConnectionQuality.Unknown];

  return (
    <Panel title="Connection">
      <div className="flex items-center gap-2.5">
        <SignalBars active={bars} tone={tone} />
        <span className={`text-[11px] font-medium ${tone}`}>{label}</span>
      </div>
    </Panel>
  );
}

/** Four-bar wifi/signal-strength glyph. `active` bars are lit, rest are dim. */
function SignalBars({ active, tone }: { active: number; tone: string }) {
  const heights = ["h-1.5", "h-2.5", "h-3.5", "h-4"];
  return (
    <span className="inline-flex items-end gap-0.5" aria-hidden>
      {heights.map((h, i) => (
        <span
          key={i}
          className={`w-1 rounded-sm ${h} ${i < active ? `${tone} bg-current` : "bg-border/60"}`}
        />
      ))}
    </span>
  );
}

function LiveBottomBar({ onLeave, isHost }: { onLeave: () => void; isHost: boolean }) {
  const local = useLocalParticipant();
  const room = useRoomContext();
  const participants = useParticipants();
  const { prefs, setPrefs } = useRoomPreferences();
  const [screenOn, setScreenOn] = useState(false);
  const micLock = useMicLock();
  // Host keeps full mic control even while the room-wide lock is on.
  const micLocked = micLock && !isHost;

  const mic = useMediaDeviceSelect({ kind: "audioinput", room: room ?? undefined });
  const cam = useMediaDeviceSelect({ kind: "videoinput", room: room ?? undefined });

  // Restore the persisted device choice once the device list is populated.
  // Browsers only label devices after a permission grant, so this often
  // re-runs after the first toggle.
  useEffect(() => {
    if (!prefs.audioInputDeviceId) return;
    if (!mic.devices.some((d) => d.deviceId === prefs.audioInputDeviceId)) return;
    if (mic.activeDeviceId === prefs.audioInputDeviceId) return;
    void mic.setActiveMediaDevice(prefs.audioInputDeviceId);
  }, [mic.devices, mic.activeDeviceId, prefs.audioInputDeviceId, mic]);
  useEffect(() => {
    if (!prefs.videoInputDeviceId) return;
    if (!cam.devices.some((d) => d.deviceId === prefs.videoInputDeviceId)) return;
    if (cam.activeDeviceId === prefs.videoInputDeviceId) return;
    void cam.setActiveMediaDevice(prefs.videoInputDeviceId);
  }, [cam.devices, cam.activeDeviceId, prefs.videoInputDeviceId, cam]);

  async function toggleMic() {
    const v = !prefs.micEnabled;
    if (v && micLocked) {
      toast.error("The host has muted the room — you can't unmute until they lift it.");
      return;
    }
    setPrefs({ micEnabled: v });
    try {
      await local.localParticipant.setMicrophoneEnabled(v);
    } catch (e) {
      console.warn("toggleMic", e);
    }
  }
  async function toggleCam() {
    const v = !prefs.cameraEnabled;
    setPrefs({ cameraEnabled: v });
    try {
      await local.localParticipant.setCameraEnabled(v);
    } catch (e) {
      console.warn("toggleCam", e);
    }
  }
  // Mobile web browsers (iOS Safari, Android Chrome) don't expose
  // getDisplayMedia, so screen sharing is physically unavailable there —
  // detect it up front and tell the user instead of failing silently.
  const screenShareSupported =
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function";

  async function toggleScreen() {
    if (!screenShareSupported) {
      toast.error("Screen sharing isn't available on this browser. Use a desktop browser to share your screen.");
      return;
    }
    const next = !screenOn;
    setScreenOn(next);
    try {
      await local.localParticipant.setScreenShareEnabled(next);
    } catch (e) {
      // Reverting here also covers the case where the user dismisses the
      // browser's screen-picker (getDisplayMedia rejects).
      setScreenOn(!next);
      console.warn("toggleScreen", e);
    }
  }
  async function selectMic(id: string) {
    setPrefs({ audioInputDeviceId: id });
    try {
      await mic.setActiveMediaDevice(id);
    } catch (e) {
      console.warn("selectMic", e);
    }
  }
  async function selectCam(id: string) {
    setPrefs({ videoInputDeviceId: id });
    try {
      await cam.setActiveMediaDevice(id);
    } catch (e) {
      console.warn("selectCam", e);
    }
  }

  return (
    <BottomBarShell
      onLeave={() => {
        void room?.disconnect();
        onLeave();
      }}
      participants={participants.length}
      controls={
        <>
          <BottomControl
            label={micLocked ? "Muted" : "Mic"}
            tone={micLocked ? "off" : prefs.micEnabled ? "active" : "off"}
            icon={
              prefs.micEnabled && !micLocked ? (
                <Mic className="h-4 w-4" />
              ) : (
                <MicOff className="h-4 w-4" />
              )
            }
            onClick={() => void toggleMic()}
            disabled={micLocked}
            devices={mic.devices}
            activeDeviceId={mic.activeDeviceId}
            onSelectDevice={(id) => void selectMic(id)}
          />
          <BottomControl
            label="Cam"
            tone={prefs.cameraEnabled ? "active" : "off"}
            icon={
              prefs.cameraEnabled ? (
                <VideoIcon className="h-4 w-4" />
              ) : (
                <VideoOff className="h-4 w-4" />
              )
            }
            onClick={() => void toggleCam()}
            devices={cam.devices}
            activeDeviceId={cam.activeDeviceId}
            onSelectDevice={(id) => void selectCam(id)}
          />
          <BottomControl
            label="Share Screen"
            tone={screenOn ? "active" : "neutral"}
            icon={<Monitor className="h-4 w-4" />}
            onClick={() => void toggleScreen()}
          />
          <BottomControl
            label="Chat"
            tone="neutral"
            icon={<MessageCircle className="h-4 w-4" />}
            disabled
          />
          <BottomControl
            label={String(participants.length)}
            ariaLabel={`Participants: ${participants.length}`}
            tone="neutral"
            icon={<Users className="h-4 w-4" />}
          />
        </>
      }
    />
  );
}

function GameRoomScaffold({ roomName }: { roomName: string }) {
  const participants = useParticipants();
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h3 className="font-display text-2xl text-gradient-gold sm:text-3xl">{roomName}</h3>
      <p className="max-w-md text-xs text-muted-foreground font-sans-display sm:text-sm">
        PvP arena ready. The realtime channel is open — once a game is wired up, both players will
        exchange moves through this room.
      </p>
      <div className="mt-2 rounded-xl border border-border/40 bg-background/40 px-4 py-3 backdrop-blur-sm">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">In the arena</p>
        <ul className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-[11px]">
          {participants.map((p) => (
            <li
              key={p.identity}
              className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 text-gold"
            >
              {p.name || p.identity.slice(0, 6)}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-[10px] italic text-muted-foreground">
        Background art coming soon · game wiring scaffolded.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared right-rail panels
// ────────────────────────────────────────────────────────────────────────────

function Panel({
  title,
  icon,
  tone = "default",
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  tone?: "default" | "destructive";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`glass rounded-xl border p-3 shadow-card ${
        tone === "destructive" ? "border-destructive/40 bg-destructive/5" : "border-border/60"
      }`}
    >
      <h4
        className={`flex items-center gap-1.5 font-display text-[11px] uppercase tracking-wider ${
          tone === "destructive" ? "text-destructive" : "text-gold"
        }`}
      >
        {icon}
        {title}
      </h4>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function PreferencesPanel() {
  const { prefs, setPrefs } = useRoomPreferences();
  return (
    <Panel title="Your Preferences">
      <div className="space-y-2 text-xs">
        <ToggleRow
          label="Camera"
          checked={prefs.cameraEnabled}
          onChange={(v) => setPrefs({ cameraEnabled: v })}
        />
        <ToggleRow
          label="Microphone"
          checked={prefs.micEnabled}
          onChange={(v) => setPrefs({ micEnabled: v })}
        />
        <label className="flex cursor-pointer items-start gap-2 pt-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={prefs.applyToAll}
            onChange={(e) => setPrefs({ applyToAll: e.target.checked })}
            className="mt-0.5"
          />
          Keep settings for all rooms
        </label>
      </div>
    </Panel>
  );
}

function LivePreferencesPanel({ isHost }: { isHost: boolean }) {
  const { prefs, setPrefs } = useRoomPreferences();
  const local = useLocalParticipant();
  const micLock = useMicLock();
  const micLocked = micLock && !isHost;

  async function toggleMic(v: boolean) {
    if (v && micLocked) {
      toast.error("The host has muted the room — you can't unmute until they lift it.");
      return;
    }
    setPrefs({ micEnabled: v });
    try {
      await local.localParticipant.setMicrophoneEnabled(v);
    } catch (e) {
      console.warn("toggleMic", e);
    }
  }
  async function toggleCam(v: boolean) {
    setPrefs({ cameraEnabled: v });
    try {
      await local.localParticipant.setCameraEnabled(v);
    } catch (e) {
      console.warn("toggleCam", e);
    }
  }

  return (
    <Panel title="Your Preferences">
      <div className="space-y-2 text-xs">
        <ToggleRow
          label="Camera"
          checked={prefs.cameraEnabled}
          onChange={(v) => void toggleCam(v)}
        />
        <ToggleRow
          label="Microphone"
          checked={prefs.micEnabled && !micLocked}
          disabled={micLocked}
          onChange={(v) => void toggleMic(v)}
        />
        {micLocked && (
          <p className="pt-0.5 text-[10px] text-destructive">
            Host muted the room — unmute is locked.
          </p>
        )}
        <label className="flex cursor-pointer items-start gap-2 pt-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={prefs.applyToAll}
            onChange={(e) => setPrefs({ applyToAll: e.target.checked })}
            className="mt-0.5"
          />
          Keep settings for all rooms
        </label>
      </div>
    </Panel>
  );
}

function HostControlsPlaceholder() {
  return (
    <Panel title="Host Controls" icon={<Lock className="h-3.5 w-3.5" />}>
      <p className="text-[11px] text-muted-foreground">
        Host controls (mute all, lock, kick) appear here once you're connected as the room's active
        host.
      </p>
    </Panel>
  );
}

function HostControlsPanel({ roomId }: { roomId: string }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const [busy, setBusy] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const lockFn = useServerFn(setRoomLocked);
  const kickFn = useServerFn(kickRoomParticipant);
  const muteAllFn = useServerFn(muteAllRoomParticipants);

  // "Mute all" is a toggle: the first click force-mutes the room and locks
  // un-muting; clicking again lifts the lock. We mirror the authoritative
  // room-metadata flag so the button reflects the real state even after a
  // reconnect or if another host toggled it.
  const micLock = useMicLock();
  const [allMuted, setAllMuted] = useState(micLock);
  useEffect(() => setAllMuted(micLock), [micLock]);

  const localId = room?.localParticipant.identity;
  const others = participants.filter((p) => p.identity !== localId);

  async function toggleLock() {
    setBusy("lock");
    const res = await lockFn({ data: { roomId, locked: !locked } });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setLocked(!locked);
    toast.success(locked ? "Room unlocked" : "Room locked — new joins blocked");
  }

  async function toggleMuteAll() {
    const next = !allMuted;
    setBusy("mute");
    const res = await muteAllFn({ data: { roomId, muted: next } });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    setAllMuted(next);
    if (next) {
      toast.success(`Muted ${res.affected} mic(s) — members can't unmute until you lift it`);
    } else {
      toast.success("Room unmuted — members can speak again");
    }
  }

  async function kick(identity: string, displayName: string) {
    if (!window.confirm(`Remove ${displayName} from the room?`)) return;
    setBusy(`kick:${identity}`);
    const res = await kickFn({ data: { roomId, identity } });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${displayName} removed`);
  }

  return (
    <Panel title="Host Controls" icon={<Lock className="h-3.5 w-3.5" />}>
      <div className="space-y-2">
        <button
          type="button"
          disabled={busy === "mute"}
          onClick={() => void toggleMuteAll()}
          aria-pressed={allMuted}
          className={`flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[11px] font-semibold disabled:opacity-50 ${
            allMuted
              ? "border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
              : "border border-border bg-secondary/50 text-foreground hover:bg-secondary"
          }`}
        >
          {allMuted ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
          {allMuted ? "Unmute all" : "Mute all"}
        </button>
        <button
          type="button"
          disabled={busy === "lock"}
          onClick={() => void toggleLock()}
          className={`flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[11px] font-semibold disabled:opacity-50 ${
            locked
              ? "border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
              : "border border-border bg-secondary/50 text-foreground hover:bg-secondary"
          }`}
        >
          <Lock className="h-3.5 w-3.5" /> {locked ? "Unlock room" : "Lock room"}
        </button>
        <div className="pt-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Kick participant
          </p>
          <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto">
            {others.length === 0 ? (
              <li className="text-[11px] italic text-muted-foreground">No other participants.</li>
            ) : (
              others.map((p) => (
                <li key={p.identity} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] text-foreground">
                    {p.name || p.identity.slice(0, 8)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void kick(p.identity, p.name || p.identity.slice(0, 8))}
                    disabled={busy === `kick:${p.identity}`}
                    aria-label={`Kick ${p.name || p.identity}`}
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/20 disabled:opacity-50"
                  >
                    <UserMinus className="h-3 w-3" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${disabled ? "opacity-60" : ""}`}>
      <span className="text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition disabled:cursor-not-allowed ${checked ? "bg-gradient-gold" : "bg-secondary"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition ${checked ? "left-4" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Bottom-bar primitives
// ────────────────────────────────────────────────────────────────────────────

function BottomBarShell({
  onLeave,
  controls,
  participants,
}: {
  onLeave: () => void;
  controls: React.ReactNode;
  participants?: number;
}) {
  // The "Room Settings" label used to be static. Now it's a toggle: click it
  // (or its chevron) to reveal a small help panel above the bar explaining
  // what each control does. Closed by default so the bar stays compact.
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative">
      {settingsOpen && (
        <div className="absolute bottom-full left-0 right-0 border-t border-border/60 bg-background/95 px-3 py-3 backdrop-blur sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[11px] text-muted-foreground font-sans-display">
              <p className="mb-1 font-semibold uppercase tracking-widest text-foreground">
                What you can do here
              </p>
              <ul className="space-y-1">
                <li>
                  <strong className="text-foreground">Mic</strong> · mute or un-mute yourself. Use
                  the caret to switch microphones.
                </li>
                <li>
                  <strong className="text-foreground">Cam</strong> · turn your camera on or off. The
                  caret lets you pick a webcam.
                </li>
                <li>
                  <strong className="text-foreground">Screen</strong> · share a window or your full
                  screen with the room.
                </li>
                <li>
                  <strong className="text-foreground">Chat</strong> · open the in-room chat thread.
                </li>
                <li>
                  <strong className="text-foreground">Participants</strong> · see everyone in the
                  room.
                </li>
                <li>
                  <strong className="text-foreground">Leave Room</strong> · disconnect and return to
                  the room list.
                </li>
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              aria-label="Close room settings"
              className="rounded-md border border-border bg-secondary/40 px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground transition hover:bg-secondary"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-expanded={settingsOpen}
          aria-label="Toggle room settings help"
          className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] uppercase tracking-widest text-muted-foreground transition hover:bg-secondary/40 hover:text-foreground"
        >
          <Lock className="h-3.5 w-3.5" />
          <span>Room Settings</span>
          {settingsOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>

        <div className="flex flex-1 items-center justify-center gap-3 sm:gap-5">{controls}</div>

        <div className="flex items-center gap-2">
          {typeof participants === "number" && (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {participants} in room
            </span>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="inline-flex items-center gap-2 rounded-md bg-destructive px-4 py-2 text-[11px] font-semibold text-destructive-foreground hover:opacity-90"
          >
            <LogOut className="h-3.5 w-3.5" /> Leave Room
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Bottom-bar control: icon button + optional caret that opens a device-picker
 * dropdown. Tone reflects state — green (active), red (muted/off), or neutral.
 * The caret only appears when a non-empty `devices` list is supplied; mic and
 * cam get it, screen-share doesn't (browser handles source selection on start).
 */
function BottomControl({
  label,
  ariaLabel,
  icon,
  tone,
  disabled,
  onClick,
  devices,
  activeDeviceId,
  onSelectDevice,
}: {
  label: string;
  /** Accessible name when the visible label is terse (e.g. a bare count). */
  ariaLabel?: string;
  icon: React.ReactNode;
  tone: "active" | "off" | "neutral";
  disabled?: boolean;
  onClick?: () => void;
  devices?: MediaDeviceInfo[];
  activeDeviceId?: string;
  onSelectDevice?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const hasPicker = !!(devices && devices.length > 0 && onSelectDevice && !disabled);

  const toneClasses = disabled
    ? "border-border/40 bg-secondary/20 text-muted-foreground/60 cursor-not-allowed"
    : tone === "active"
      ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_18px_-6px_rgba(16,185,129,0.7)]"
      : tone === "off"
        ? "border-destructive/60 bg-destructive/10 text-destructive"
        : "border-border bg-secondary/50 text-foreground hover:bg-secondary";

  return (
    <div ref={wrapRef} className="relative inline-flex items-stretch">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        aria-pressed={tone === "active"}
        className={`flex h-12 w-14 flex-col items-center justify-center gap-0.5 border px-0.5 text-[10px] font-medium leading-none transition ${
          hasPicker ? "rounded-l-md border-r-0" : "rounded-md"
        } ${toneClasses}`}
      >
        <span aria-hidden>{icon}</span>
        <span className="w-full text-center leading-tight">{label}</span>
      </button>
      {hasPicker && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={`${label} options`}
            aria-haspopup="menu"
            aria-expanded={open}
            className={`flex h-12 w-5 items-center justify-center rounded-r-md border transition ${toneClasses}`}
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          {open && (
            <ul
              role="menu"
              className="absolute bottom-[calc(100%+6px)] left-0 z-50 max-h-64 w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
            >
              {devices!.map((d) => {
                const checked = d.deviceId === activeDeviceId;
                return (
                  <li key={d.deviceId}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      onClick={() => {
                        onSelectDevice!(d.deviceId);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
                        checked ? "bg-gold/10 text-gold" : "text-foreground hover:bg-secondary"
                      }`}
                    >
                      <span className="truncate">{d.label || `${label} device`}</span>
                      {checked && <Check className="h-3 w-3 shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
