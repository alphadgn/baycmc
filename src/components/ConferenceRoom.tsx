import { useCallback, useEffect, useRef, useState } from "react";
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
  VideoConference,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
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
}: ConferenceRoomProps) {
  const [state, setState] = useState<JoinState>({ phase: "idle" });
  const getToken = useServerFn(getLivekitToken);
  const revalidateAccess = useServerFn(revalidateLivekitRoomAccess);
  const navigate = useNavigate();

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
          "code" in res &&
          (res.code === "bayc_revoked" || res.code === "otherpage_revoked");
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
        data-lk-theme="default"
        onDisconnected={() => setState({ phase: "idle" })}
        // We render the LiveKit toolbar ourselves so the bottom bar matches
        // the conf.png mockup; suppress the SDK's default UI.
        style={{ background: "transparent" }}
      >
        <RoomsShell
          title={roomName}
          subtitle={ambience ?? undefined}
          rightRail={
            <LiveRightRail
              roomId={roomId}
              isHost={state.isHost}
              connecting={false}
            />
          }
          bottomBar={
            <LiveBottomBar
              onLeave={() => {
                setState({ phase: "idle" });
                goBack();
              }}
            />
          }
        >
          <VideoArea backgroundImage={backgroundImage} kind={kind} roomName={roomName} />
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
        backgroundImage: `linear-gradient(rgba(8,8,12,0.7), rgba(8,8,12,0.88)), url(${backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {};

  return (
    <div
      className="relative flex min-h-[60vh] items-center justify-center overflow-hidden rounded-2xl border border-border/60 p-6 shadow-card sm:p-10"
      style={bgStyle}
    >
      {state.phase === "connecting" && <ConnectingHero progress={state.progress} roomName={roomName} />}
      {state.phase === "error" && (
        <ErrorHero
          roomName={roomName}
          message={state.message}
          recoverable={state.recoverable}
          accessLoss={state.accessLoss}
          onRetry={onRetry}
        />
      )}
      {state.phase === "idle" && (
        <IdleHero roomName={roomName} kind={kind} onJoin={onRetry} />
      )}
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

function PreLiveRightRail({
  state,
  onRetry,
}: {
  state: JoinState;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      {state.phase === "error" && (
        <Panel tone="destructive" title="Connection Failed" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
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
            {state.progress < 30 ? "Verifying holder…" : state.progress < 60 ? "Minting token…" : "Opening room…"}
          </p>
        </Panel>
      )}
      <PreferencesPanel />
      <HostControlsPlaceholder />
    </div>
  );
}

function PreLiveBottomBar({ onLeave }: { onLeave: () => void }) {
  return (
    <BottomBarShell
      onLeave={onLeave}
      controls={
        <>
          <BottomControl label="Mic" tone="neutral" icon={<Mic className="h-4 w-4" />} disabled />
          <BottomControl label="Cam" tone="neutral" icon={<VideoIcon className="h-4 w-4" />} disabled />
          <BottomControl label="Screen" tone="neutral" icon={<Monitor className="h-4 w-4" />} disabled />
          <BottomControl label="Chat" tone="neutral" icon={<MessageCircle className="h-4 w-4" />} disabled />
          <BottomControl label="Participants" tone="neutral" icon={<Users className="h-4 w-4" />} disabled />
        </>
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// LIVE views (inside LiveKitRoom — can use room context hooks)
// ────────────────────────────────────────────────────────────────────────────

function VideoArea({
  backgroundImage,
  kind,
  roomName,
}: {
  backgroundImage: string | null;
  kind: "conference" | "game";
  roomName: string;
}) {
  const wrapperStyle: React.CSSProperties = backgroundImage
    ? {
        backgroundImage: `linear-gradient(rgba(8,8,12,0.78), rgba(8,8,12,0.92)), url(${backgroundImage})`,
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
        {kind === "game" ? <GameRoomScaffold roomName={roomName} /> : <VideoConference />}
      </div>
    </div>
  );
}

function LiveRightRail({
  roomId,
  isHost,
  connecting,
}: {
  roomId: string;
  isHost: boolean;
  connecting: boolean;
}) {
  return (
    <div className="space-y-3">
      {connecting && (
        <Panel title="Connecting to room…" icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
            <div className="h-full w-1/2 rounded-full bg-gradient-gold" />
          </div>
        </Panel>
      )}
      <LivePreferencesPanel />
      {isHost && <HostControlsPanel roomId={roomId} />}
    </div>
  );
}

function LiveBottomBar({ onLeave }: { onLeave: () => void }) {
  const local = useLocalParticipant();
  const room = useRoomContext();
  const participants = useParticipants();
  const { prefs, setPrefs } = useRoomPreferences();
  const [screenOn, setScreenOn] = useState(false);

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
  async function toggleScreen() {
    const next = !screenOn;
    setScreenOn(next);
    try {
      await local.localParticipant.setScreenShareEnabled(next);
    } catch (e) {
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
            label="Mic"
            tone={prefs.micEnabled ? "active" : "off"}
            icon={prefs.micEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            onClick={() => void toggleMic()}
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
            label="Screen"
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
            label={`Participants${participants.length ? ` (${participants.length})` : ""}`}
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

function LivePreferencesPanel() {
  const { prefs, setPrefs } = useRoomPreferences();
  const local = useLocalParticipant();

  async function toggleMic(v: boolean) {
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
        <ToggleRow label="Camera" checked={prefs.cameraEnabled} onChange={(v) => void toggleCam(v)} />
        <ToggleRow label="Microphone" checked={prefs.micEnabled} onChange={(v) => void toggleMic(v)} />
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
        Host controls (mute all, lock, kick) appear here once you're connected as the room's
        active host.
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

  async function muteAll() {
    setBusy("mute");
    const res = await muteAllFn({ data: { roomId, muted: true } });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Muted ${res.affected} mic(s)`);
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
          onClick={() => void muteAll()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[11px] font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
        >
          <MicOff className="h-3.5 w-3.5" /> Mute all
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
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-gradient-gold" : "bg-secondary"}`}
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
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-6">
      <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> Room Settings
      </span>

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
  icon,
  tone,
  disabled,
  onClick,
  devices,
  activeDeviceId,
  onSelectDevice,
}: {
  label: string;
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
        aria-label={label}
        aria-pressed={tone === "active"}
        className={`flex h-12 w-14 flex-col items-center justify-center border text-[10px] font-medium transition ${
          hasPicker ? "rounded-l-md border-r-0" : "rounded-md"
        } ${toneClasses}`}
      >
        <span aria-hidden>{icon}</span>
        <span className="mt-0.5 truncate">{label}</span>
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
                        checked
                          ? "bg-gold/10 text-gold"
                          : "text-foreground hover:bg-secondary"
                      }`}
                    >
                      <span className="truncate">
                        {d.label || `${label} device`}
                      </span>
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
