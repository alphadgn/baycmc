import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Check, RefreshCw } from "lucide-react";
import { listAudioDevices } from "@/lib/karaoke/audioMixBus";
import { AudioMeter } from "./AudioMeter";

interface AudioDiagnosticsPanelProps {
  micAnalyser: AnalyserNode | null;
  mixAnalyser: AnalyserNode | null;
  micDeviceId?: string;
  outputDeviceId?: string;
  onSelectMic?: (id: string) => void;
  onSelectOutput?: (id: string) => void;
  onReconnect?: () => void;
  contextState?: AudioContextState | null;
  recorderMime?: string;
}

/**
 * Diagnostics card for karaoke rooms. Shows the audio context state,
 * lets the user re-pick input/output devices, displays live level meters
 * for the mic and the broadcast mix, and exposes a reconnect button.
 */
export function AudioDiagnosticsPanel({
  micAnalyser,
  mixAnalyser,
  micDeviceId,
  outputDeviceId,
  onSelectMic,
  onSelectOutput,
  onReconnect,
  contextState,
  recorderMime,
}: AudioDiagnosticsPanelProps) {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [permission, setPermission] = useState<PermissionState | "unknown">("unknown");

  async function loadDevices() {
    const { inputs, outputs } = await listAudioDevices();
    setInputs(inputs);
    setOutputs(outputs);
  }

  useEffect(() => {
    void loadDevices();
    let mounted = true;
    if (typeof navigator !== "undefined" && navigator.permissions) {
      navigator.permissions
        .query({ name: "microphone" as PermissionName })
        .then((p) => {
          if (!mounted) return;
          setPermission(p.state);
          p.onchange = () => mounted && setPermission(p.state);
        })
        .catch(() => undefined);
    }
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
      const onChange = () => void loadDevices();
      navigator.mediaDevices.addEventListener("devicechange", onChange);
      return () => {
        mounted = false;
        navigator.mediaDevices.removeEventListener("devicechange", onChange);
      };
    }
    return () => {
      mounted = false;
    };
  }, []);

  const supportsSinkId =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype;

  return (
    <div className="glass rounded-xl border border-border/60 p-3 shadow-card">
      <h4 className="flex items-center gap-1.5 font-display text-[11px] uppercase tracking-wider text-gold">
        <Activity className="h-3.5 w-3.5" /> Audio diagnostics
      </h4>

      <div className="mt-2 space-y-2 text-[11px]">
        <Row
          label="Context"
          value={
            <span className={contextState === "running" ? "text-emerald-300" : "text-amber-300"}>
              {contextState ?? "—"}
            </span>
          }
        />
        <Row
          label="Mic permission"
          value={
            permission === "granted" ? (
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <Check className="h-3 w-3" /> granted
              </span>
            ) : permission === "denied" ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" /> denied
              </span>
            ) : (
              <span className="text-muted-foreground">{permission}</span>
            )
          }
        />
        <Row label="Recorder" value={<span className="text-muted-foreground">{recorderMime ?? "—"}</span>} />
      </div>

      <div className="mt-3 space-y-2">
        <AudioMeter analyser={micAnalyser} label="Mic input" />
        <AudioMeter analyser={mixAnalyser} label="Broadcast mix" />
      </div>

      {onSelectMic && (
        <div className="mt-3">
          <label className="block text-[10px] uppercase tracking-widest text-muted-foreground">
            Input device
          </label>
          <select
            value={micDeviceId ?? ""}
            onChange={(e) => onSelectMic(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px] text-foreground"
          >
            <option value="">Default</option>
            {inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {onSelectOutput && supportsSinkId && (
        <div className="mt-2">
          <label className="block text-[10px] uppercase tracking-widest text-muted-foreground">
            Output device
          </label>
          <select
            value={outputDeviceId ?? ""}
            onChange={(e) => onSelectOutput(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px] text-foreground"
          >
            <option value="">Default</option>
            {outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Speaker ${d.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {onReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-2 py-1.5 text-[11px] font-semibold text-gold hover:bg-gold/20"
        >
          <RefreshCw className="h-3 w-3" /> Reconnect audio
        </button>
      )}

      {permission === "denied" && (
        <p className="mt-2 text-[10px] text-destructive">
          Microphone access is blocked. Open your browser's site settings and allow microphone, then click Reconnect.
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
