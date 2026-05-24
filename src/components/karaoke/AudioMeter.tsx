import { useEffect, useRef, useState } from "react";
import { readMeter, type AudioMeterReading } from "@/lib/karaoke/audioMixBus";

interface AudioMeterProps {
  analyser: AnalyserNode | null;
  /** Visual orientation. */
  orientation?: "horizontal" | "vertical";
  /** Optional label shown above the meter. */
  label?: string;
  className?: string;
}

/**
 * Real-time level meter. Reads from an AnalyserNode (e.g. mic tap or
 * mix-bus tap) and draws an RMS bar plus a peak-hold indicator. Pure CSS
 * — no canvas dependency.
 */
export function AudioMeter({
  analyser,
  orientation = "horizontal",
  label,
  className,
}: AudioMeterProps) {
  const [reading, setReading] = useState<AudioMeterReading>({ level: 0, peak: 0 });
  const peakHoldRef = useRef({ value: 0, holdUntil: 0 });
  const rafRef = useRef<number | null>(null);
  const scratchRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!analyser) return;
    if (!scratchRef.current || scratchRef.current.length !== analyser.fftSize) {
      scratchRef.current = new Uint8Array(analyser.fftSize);
    }
    function tick() {
      if (!analyser || !scratchRef.current) return;
      const r = readMeter(analyser, scratchRef.current);
      const now = performance.now();
      const ph = peakHoldRef.current;
      if (r.peak > ph.value || now > ph.holdUntil) {
        ph.value = Math.max(r.peak, ph.value * 0.92);
        if (r.peak > ph.value * 0.95) ph.holdUntil = now + 600;
      } else {
        ph.value *= 0.96;
      }
      setReading({ level: r.level, peak: ph.value });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser]);

  // Use a slight nonlinear scale so quiet voices still show movement.
  const levelPct = Math.min(100, Math.pow(reading.level * 2.2, 0.7) * 100);
  const peakPct = Math.min(100, Math.pow(reading.peak * 2.2, 0.7) * 100);
  const clipping = reading.peak > 0.95;

  if (orientation === "vertical") {
    return (
      <div className={className}>
        {label && (
          <div className="mb-1 text-[9px] uppercase tracking-widest text-muted-foreground">
            {label}
          </div>
        )}
        <div className="relative h-24 w-2.5 overflow-hidden rounded-sm bg-border/40">
          <div
            className={`absolute bottom-0 left-0 right-0 rounded-sm transition-[height] duration-75 ${
              clipping ? "bg-destructive" : "bg-gradient-to-t from-emerald-500 via-amber-400 to-rose-500"
            }`}
            style={{ height: `${levelPct}%` }}
          />
          <div
            className="absolute left-0 right-0 h-[2px] bg-white/90"
            style={{ bottom: `${peakPct}%` }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 text-[9px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      )}
      <div className="relative h-2 w-full overflow-hidden rounded-sm bg-border/40">
        <div
          className={`absolute left-0 top-0 bottom-0 rounded-sm transition-[width] duration-75 ${
            clipping ? "bg-destructive" : "bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500"
          }`}
          style={{ width: `${levelPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-white/90"
          style={{ left: `${peakPct}%` }}
        />
      </div>
    </div>
  );
}
