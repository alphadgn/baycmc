import { Mic, Circle } from "lucide-react";

interface SingerLiveIndicatorProps {
  /** Display name of the active singer. */
  singerName: string;
  /** Whether their mic is currently transmitting. */
  live: boolean;
  /** Whether their take is being recorded right now. */
  recording: boolean;
}

/**
 * Top-left "ON AIR" style banner for karaoke rooms — pulses while the
 * singer's mic is open, shows a red REC dot when their take is being
 * captured to the recording pipeline.
 */
export function SingerLiveIndicator({ singerName, live, recording }: SingerLiveIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 4.5rem)" }}
      className="pointer-events-none fixed right-4 z-40 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-background/85 px-3 py-1.5 text-[11px] font-semibold backdrop-blur shadow-gold"
    >
      <span className="relative inline-flex h-2 w-2">
        <span
          className={`absolute inset-0 rounded-full ${
            live ? "animate-ping bg-emerald-400" : "bg-muted-foreground/40"
          }`}
        />
        <span
          className={`relative inline-block h-2 w-2 rounded-full ${
            live ? "bg-emerald-500" : "bg-muted-foreground"
          }`}
        />
      </span>
      <Mic className={`h-3 w-3 ${live ? "text-emerald-300" : "text-muted-foreground"}`} />
      <span className={live ? "text-emerald-200" : "text-muted-foreground"}>
        {live ? "Singer Live" : "Mic muted"}
      </span>
      <span className="text-muted-foreground/70">·</span>
      <span className="truncate max-w-[8rem] text-foreground">{singerName}</span>
      {recording && (
        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-destructive">
          <Circle className="h-1.5 w-1.5 fill-current" /> REC
        </span>
      )}
    </div>
  );
}
