import { useCallback, useEffect, useRef, useState } from "react";
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
  useParticipants,
  useRoomContext,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { toast } from "sonner";
import {
  AlertTriangle,
  Loader2,
  Lock,
  LogOut,
  MicOff,
  RefreshCw,
  UserMinus,
} from "lucide-react";
import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";

interface ConferenceRoomProps {
  roomId: string;
  roomName: string;
  backgroundImage?: string | null;
  kind?: "conference" | "game";
}

type JoinState =
  | { phase: "idle" }
  | { phase: "connecting"; progress: number }
  | { phase: "live"; token: string; url: string; isHost: boolean }
  | { phase: "error"; message: string; recoverable: boolean; accessLoss?: boolean };

export function ConferenceRoom({
  roomId,
  roomName,
  backgroundImage = null,
  kind = "conference",
}: ConferenceRoomProps) {
  const [state, setState] = useState<JoinState>({ phase: "idle" });
  const { prefs } = useRoomPreferences();
  const getToken = useServerFn(getLivekitToken);
  const revalidateAccess = useServerFn(revalidateLivekitRoomAccess);

  const progressTimer = useRef<number | null>(null);

  const join = useCallback(async () => {
    setState({ phase: "connecting", progress: 5 });
    // Visual progress ticker — caps short of 100 until LiveKit actually opens.
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
        setState({
          phase: "error",
          message: res.error,
          recoverable: !accessLoss,
          accessLoss,
        });
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

  // Cleanup the ticker if the component unmounts mid-connect.
  useEffect(() => {
    return () => {
      if (progressTimer.current) {
        window.clearInterval(progressTimer.current);
        progressTimer.current = null;
      }
    };
  }, []);

  // Reset when navigating to a different room.
  useEffect(() => {
    setState({ phase: "idle" });
  }, [roomId]);

  // Background re-validation every 30s while live — drop the user if their
  // BAYC/MAYC delegation got revoked or the room was locked.
  useEffect(() => {
    if (state.phase !== "live") return;
    let cancelled = false;
    async function checkAccess() {
      const res = await revalidateAccess({ data: { roomId } }).catch(() => null);
      if (cancelled || !res || res.ok) return;
      setState({
        phase: "error",
        message: res.error,
        recoverable: false,
        accessLoss: true,
      });
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

  // Themed background wrapper used across every state — keeps the room
  // ambience consistent before, during, and after the LiveKit connection.
  const wrapperStyle: React.CSSProperties = backgroundImage
    ? {
        backgroundImage: `linear-gradient(rgba(8,8,12,0.72), rgba(8,8,12,0.88)), url(${backgroundImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {};

  if (state.phase === "live") {
    return (
      <LiveRoom
        token={state.token}
        url={state.url}
        roomId={roomId}
        roomName={roomName}
        isHost={state.isHost}
        backgroundImage={backgroundImage}
        kind={kind}
        prefsMicEnabled={prefs.micEnabled}
        prefsCameraEnabled={prefs.cameraEnabled}
        onLeave={() => setState({ phase: "idle" })}
      />
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border/60 shadow-card"
      style={wrapperStyle}
    >
      <div className="grid gap-4 p-5 sm:p-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-h-[60vh] rounded-xl bg-background/40 p-6 backdrop-blur-sm sm:p-10">
          {state.phase === "connecting" && (
            <ConnectingPanel progress={state.progress} roomName={roomName} />
          )}
          {state.phase === "error" && (
            <ErrorPanel
              roomName={roomName}
              message={state.message}
              recoverable={state.recoverable}
              accessLoss={state.accessLoss}
              onRetry={() => void join()}
            />
          )}
          {state.phase === "idle" && (
            <IdlePanel roomName={roomName} kind={kind} onJoin={() => void join()} />
          )}
        </div>

        <RightRail state={state} />
      </div>
    </div>
  );
}

function IdlePanel({
  roomName,
  kind,
  onJoin,
}: {
  roomName: string;
  kind: "conference" | "game";
  onJoin: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <h2 className="font-display text-3xl text-gradient-gold sm:text-5xl">{roomName}</h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground font-sans-display">
        {kind === "game"
          ? "Real-time PvP arena. Pair up with another verified member and play head-to-head."
          : "Live audio + video conference. Your saved camera and microphone preferences will be applied as soon as you connect."}
      </p>
      <button
        type="button"
        data-testid="enter-exclusive-room"
        onClick={onJoin}
        className="mt-6 rounded-md bg-gradient-gold px-6 py-3 text-sm font-semibold text-gold-foreground shadow-gold font-sans-display"
      >
        {kind === "game" ? "Enter game room" : "Enter room"}
      </button>
    </div>
  );
}

function ConnectingPanel({
  progress,
  roomName,
}: {
  progress: number;
  roomName: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full flex-col items-center justify-center text-center"
    >
      <Loader2 className="h-10 w-10 animate-spin text-gold" />
      <h2 className="mt-4 font-display text-2xl text-foreground sm:text-3xl">
        Connecting to {roomName}…
      </h2>
      <p className="mt-2 text-xs text-muted-foreground font-sans-display sm:text-sm">
        Verifying access, minting your LiveKit token, and joining the conference.
      </p>
      <div className="mt-5 w-full max-w-sm">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
          <div
            className="h-full rounded-full bg-gradient-gold transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">
          {progress < 30
            ? "Verifying holder…"
            : progress < 60
              ? "Minting token…"
              : "Opening room…"}
        </p>
      </div>
    </div>
  );
}

function ErrorPanel({
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
      aria-labelledby="conf-error-title"
      data-testid={accessLoss ? "exclusive-access-loss" : "conf-error"}
      className="flex h-full flex-col items-center justify-center text-center"
    >
      <div className="rounded-full border border-destructive/40 bg-destructive/10 p-3">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <h2 id="conf-error-title" className="mt-4 font-display text-2xl text-foreground sm:text-3xl">
        Connection failed
      </h2>
      <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
        Couldn't connect to {roomName}
      </p>
      <p className="mt-3 max-w-md text-sm text-foreground font-sans-display">{message}</p>
      {accessLoss && (
        <p className="mt-2 max-w-md text-xs text-muted-foreground font-sans-display">
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
        <a
          href="/rooms"
          className="rounded-md border border-border bg-secondary/40 px-4 py-2 text-xs font-medium hover:bg-secondary"
        >
          Back to rooms
        </a>
      </div>
    </div>
  );
}

function RightRail({ state }: { state: JoinState }) {
  const { prefs, setPrefs } = useRoomPreferences();
  return (
    <aside className="space-y-3">
      {state.phase === "error" && (
        <Panel tone="destructive" title="Connection Failed" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
          <p className="text-[11px] text-muted-foreground">{state.message}</p>
        </Panel>
      )}
      {state.phase === "connecting" && (
        <Panel title="Connecting to room…" icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border/40">
            <div
              className="h-full rounded-full bg-gradient-gold transition-[width]"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </Panel>
      )}
      <Panel title="Your Preferences">
        <div className="space-y-2 text-xs">
          <Row
            label="Camera"
            checked={prefs.cameraEnabled}
            onChange={(v) => setPrefs({ cameraEnabled: v })}
          />
          <Row
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
    </aside>
  );
}

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

function Row({
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

/**
 * Live LiveKit conference view. Renders the themed background as a faint
 * backdrop behind the VideoConference UI so the room ambience persists.
 */
function LiveRoom({
  token,
  url,
  roomId,
  roomName,
  isHost,
  backgroundImage,
  kind,
  prefsMicEnabled,
  prefsCameraEnabled,
  onLeave,
}: {
  token: string;
  url: string;
  roomId: string;
  roomName: string;
  isHost: boolean;
  backgroundImage: string | null;
  kind: "conference" | "game";
  prefsMicEnabled: boolean;
  prefsCameraEnabled: boolean;
  onLeave: () => void;
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
      className="relative overflow-hidden rounded-2xl border border-border/60 shadow-card"
      style={wrapperStyle}
    >
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect={true}
        audio={prefsMicEnabled}
        video={prefsCameraEnabled}
        data-lk-theme="default"
        onDisconnected={() => {
          onLeave();
        }}
        style={{ background: "transparent" }}
      >
        <div className="grid gap-3 p-2 sm:gap-4 sm:p-3 lg:grid-cols-[1fr_18rem] lg:p-4">
          <div
            className="overflow-hidden rounded-xl border border-border/40 bg-background/40 backdrop-blur-sm"
            style={{ minHeight: "70vh" }}
          >
            {kind === "game" ? (
              <GameRoomScaffold roomName={roomName} />
            ) : (
              <VideoConference />
            )}
            <RoomAudioRenderer />
            <InRoomLeaveBar onLeave={onLeave} />
          </div>

          <aside className="space-y-3">
            <Panel title="Your Preferences">
              <LivePreferenceToggles />
            </Panel>
            {isHost && <HostControlsPanel roomId={roomId} />}
          </aside>
        </div>
      </LiveKitRoom>
    </div>
  );
}

function LivePreferenceToggles() {
  const { prefs, setPrefs } = useRoomPreferences();
  const local = useLocalParticipant();

  // Reflect the user's actual mic/camera state in the toggle and persist
  // the change back to preferences so the next room inherits it.
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
    <div className="space-y-2 text-xs">
      <Row label="Camera" checked={prefs.cameraEnabled} onChange={(v) => void toggleCam(v)} />
      <Row label="Microphone" checked={prefs.micEnabled} onChange={(v) => void toggleMic(v)} />
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

  // The local participant is the host themselves — they shouldn't see a
  // "kick yourself" button. LiveKit gives every participant `identity`.
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

function InRoomLeaveBar({ onLeave }: { onLeave: () => void }) {
  const room = useRoomContext();
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/40 bg-background/70 px-3 py-2 backdrop-blur-sm">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Room Settings
      </span>
      <button
        type="button"
        onClick={() => {
          void room?.disconnect();
          onLeave();
        }}
        className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-[11px] font-semibold text-destructive-foreground hover:opacity-90"
      >
        <LogOut className="h-3.5 w-3.5" /> Leave Room
      </button>
    </div>
  );
}

/**
 * Game Room scaffold — placeholder PvP surface.
 *
 * The room joins LiveKit so we have a low-latency data channel ready
 * (`canPublishData: true` in the access token). A real game's state will
 * ride that channel later; for now the scaffold just shows the connected
 * participants so it's clear the room is "live and ready for PvP".
 */
function GameRoomScaffold({ roomName }: { roomName: string }) {
  const participants = useParticipants();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
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
      <p className="mt-2 text-[10px] text-muted-foreground italic">
        Background art coming soon · game wiring scaffolded.
      </p>
    </div>
  );
}
