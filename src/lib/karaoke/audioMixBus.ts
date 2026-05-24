/**
 * Karaoke Audio Mix Bus
 * ─────────────────────
 * Centralized Web Audio pipeline for karaoke. Owns ONE AudioContext per page
 * (singleton), and routes:
 *
 *   Microphone ─► micGain ─► micCompressor ─┐
 *                                            ├─► mixGain ─┬─► broadcastDest (MediaStream → LiveKit)
 *   Music <audio> ─► musicGain ──────────────┘            ├─► recordDest    (MediaStream → MediaRecorder)
 *                                                          └─► monitorGain  (→ destination, singer's headphones)
 *
 * Aggressive browser DSP (echoCancellation, noiseSuppression, autoGainControl)
 * is intentionally DISABLED on the mic capture so the singer's voice isn't
 * suppressed when music is playing simultaneously.
 *
 * This module is environment-safe: it never touches `window` / `navigator` at
 * module scope, only inside methods that callers invoke from the browser.
 */

export type MixBusState = "idle" | "ready" | "error";

export interface AudioMeterReading {
  /** Linear 0..1 RMS level. */
  level: number;
  /** Peak hold 0..1. */
  peak: number;
}

export interface MixBusConfig {
  /** When true, monitor the mix back to the singer's speakers (default: false to avoid feedback). */
  monitor?: boolean;
  /** Mic gain (default 1.0). */
  micGainValue?: number;
  /** Music gain (default 0.55 — sits under the vocal). */
  musicGainValue?: number;
}

let _ctx: AudioContext | null = null;

/** Singleton AudioContext getter. Resumes if suspended (autoplay policy). */
export function getAudioContext(): AudioContext {
  if (typeof window === "undefined") {
    throw new Error("AudioContext is browser-only");
  }
  if (!_ctx) {
    const Ctor: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _ctx = new Ctor({ latencyHint: "interactive" });
  }
  return _ctx;
}

/** Resume the AudioContext from a user-gesture handler. Safe to call repeatedly. */
export async function ensureAudioContextRunning(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => undefined);
  }
}

/**
 * Karaoke mix bus. Construct once per karaoke session, dispose on room exit.
 *
 * Lifecycle:
 *   const bus = new KaraokeMixBus();
 *   await bus.attachMic(deviceId?);          // gets singer's mic w/ DSP off
 *   bus.attachMusicElement(audioEl);         // capture the karaoke <audio>
 *   const stream = bus.broadcastStream();    // hand to LiveKit publishTrack
 *   bus.startRecording();                    // → MediaRecorder on record bus
 *   const blob = await bus.stopRecording();  // mixed webm/mp4 blob
 *   await bus.dispose();
 */
export class KaraokeMixBus {
  readonly ctx: AudioContext;

  // Mic chain
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  readonly micGain: GainNode;
  readonly micCompressor: DynamicsCompressorNode;

  // Music chain
  private musicSource: MediaElementAudioSourceNode | null = null;
  private musicElement: HTMLMediaElement | null = null;
  readonly musicGain: GainNode;

  // Mix bus
  readonly mixGain: GainNode;
  private readonly broadcastDest: MediaStreamAudioDestinationNode;
  private readonly recordDest: MediaStreamAudioDestinationNode;
  readonly monitorGain: GainNode;

  // Recorder
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recorderMime = "audio/webm";
  private recordStartedAt: number | null = null;

  // Level metering
  private micAnalyser: AnalyserNode | null = null;
  private mixAnalyser: AnalyserNode | null = null;

  state: MixBusState = "idle";
  lastError: string | null = null;

  constructor(config: MixBusConfig = {}) {
    this.ctx = getAudioContext();

    this.micGain = this.ctx.createGain();
    this.micGain.gain.value = config.micGainValue ?? 1.0;

    // Light vocal compressor — tames peaks without squashing dynamics.
    this.micCompressor = this.ctx.createDynamicsCompressor();
    this.micCompressor.threshold.value = -18;
    this.micCompressor.knee.value = 12;
    this.micCompressor.ratio.value = 3;
    this.micCompressor.attack.value = 0.005;
    this.micCompressor.release.value = 0.12;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = config.musicGainValue ?? 0.55;

    this.mixGain = this.ctx.createGain();
    this.mixGain.gain.value = 1.0;

    this.broadcastDest = this.ctx.createMediaStreamDestination();
    this.recordDest = this.ctx.createMediaStreamDestination();

    this.monitorGain = this.ctx.createGain();
    this.monitorGain.gain.value = config.monitor ? 0.4 : 0.0;

    // Wire mic chain
    this.micGain.connect(this.micCompressor);
    this.micCompressor.connect(this.mixGain);

    // Wire music chain
    this.musicGain.connect(this.mixGain);

    // Mix → broadcast + record + (optional) monitor
    this.mixGain.connect(this.broadcastDest);
    this.mixGain.connect(this.recordDest);
    this.mixGain.connect(this.monitorGain);
    this.monitorGain.connect(this.ctx.destination);

    this.state = "ready";
  }

  /** Acquire the microphone with DSP off (karaoke mode). */
  async attachMic(deviceId?: string): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone API unavailable in this browser");
    }
    await ensureAudioContextRunning();

    const constraints: MediaStreamConstraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Hint browser to preserve full vocal frequency range.
        sampleRate: 48000,
        channelCount: 1,
      },
      video: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      // Detach any previous mic
      this.detachMic();
      this.micStream = stream;
      this.micSource = this.ctx.createMediaStreamSource(stream);

      // Mic → analyser → micGain → ... (analyser is a tap)
      this.micAnalyser = this.ctx.createAnalyser();
      this.micAnalyser.fftSize = 1024;
      this.micSource.connect(this.micAnalyser);

      this.micSource.connect(this.micGain);
    } catch (e) {
      this.state = "error";
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  detachMic(): void {
    try {
      this.micSource?.disconnect();
    } catch {
      /* noop */
    }
    this.micSource = null;
    this.micAnalyser = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
  }

  /** Get the currently attached mic's MediaStream (for diagnostics). */
  getMicStream(): MediaStream | null {
    return this.micStream;
  }

  /**
   * Capture an HTMLMediaElement (the karaoke `<audio>`) into the mix.
   * Calling this multiple times with the same element is a no-op. A given
   * media element can only have ONE MediaElementSource for its lifetime,
   * per the Web Audio spec.
   */
  attachMusicElement(el: HTMLMediaElement): void {
    if (this.musicElement === el && this.musicSource) return;
    if (this.musicElement && this.musicElement !== el) {
      try {
        this.musicSource?.disconnect();
      } catch {
        /* noop */
      }
      this.musicSource = null;
    }
    this.musicElement = el;
    try {
      this.musicSource = this.ctx.createMediaElementSource(el);
      this.musicSource.connect(this.musicGain);
      // Mute the element's direct output so the audience doesn't get
      // it twice (once via element default route, once via mix bus).
      // The mix is routed back through monitor for local audibility.
    } catch (e) {
      // Already wired (some browsers throw if createMediaElementSource was
      // called previously on this element). Ignore.
      console.warn("[mix-bus] attachMusicElement", e);
    }
  }

  /** Set mic gain (0..2 typical). */
  setMicGain(v: number): void {
    this.micGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  setMusicGain(v: number): void {
    this.musicGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  setMonitor(on: boolean): void {
    this.monitorGain.gain.setTargetAtTime(on ? 0.4 : 0, this.ctx.currentTime, 0.05);
  }

  /** Mixed stream for the conference. Single audio track. */
  broadcastStream(): MediaStream {
    return this.broadcastDest.stream;
  }
  broadcastTrack(): MediaStreamTrack | null {
    return this.broadcastDest.stream.getAudioTracks()[0] ?? null;
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  pickRecorderMime(): string {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/mp4",
    ];
    if (typeof MediaRecorder === "undefined") return "audio/webm";
    for (const m of candidates) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return "audio/webm";
  }

  startRecording(): void {
    if (this.recorder && this.recorder.state === "recording") return;
    this.recordedChunks = [];
    this.recorderMime = this.pickRecorderMime();
    this.recorder = new MediaRecorder(this.recordDest.stream, {
      mimeType: this.recorderMime,
      audioBitsPerSecond: 128_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
    };
    this.recorder.start(1000); // 1s chunks → smooth uploads, low memory
    this.recordStartedAt = Date.now();
  }

  isRecording(): boolean {
    return this.recorder?.state === "recording";
  }

  recordingDurationMs(): number {
    return this.recordStartedAt ? Date.now() - this.recordStartedAt : 0;
  }

  recordingMime(): string {
    return this.recorderMime;
  }

  async stopRecording(): Promise<{ blob: Blob; durationMs: number; mime: string } | null> {
    const rec = this.recorder;
    if (!rec || rec.state === "inactive") return null;
    const durationMs = this.recordingDurationMs();
    const mime = this.recorderMime;
    const blob = await new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(this.recordedChunks, { type: mime }));
      rec.stop();
    });
    this.recorder = null;
    this.recordStartedAt = null;
    return { blob, durationMs, mime };
  }

  // ── Level meters ──────────────────────────────────────────────────────────

  attachMixAnalyser(): AnalyserNode {
    if (this.mixAnalyser) return this.mixAnalyser;
    const a = this.ctx.createAnalyser();
    a.fftSize = 1024;
    this.mixGain.connect(a);
    this.mixAnalyser = a;
    return a;
  }
  getMicAnalyser(): AnalyserNode | null {
    return this.micAnalyser;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* noop */
      }
    }
    this.detachMic();
    try {
      this.musicSource?.disconnect();
    } catch {
      /* noop */
    }
    this.musicSource = null;
    this.musicElement = null;
    try {
      this.broadcastDest.disconnect();
      this.recordDest.disconnect();
      this.mixGain.disconnect();
      this.micGain.disconnect();
      this.musicGain.disconnect();
      this.monitorGain.disconnect();
      this.micCompressor.disconnect();
    } catch {
      /* noop */
    }
    this.state = "idle";
  }
}

/** Read a meter level from an AnalyserNode (call inside requestAnimationFrame). */
export function readMeter(analyser: AnalyserNode, scratch: Uint8Array): AudioMeterReading {
  // Cast: lib.dom types narrow to Uint8Array<ArrayBuffer> in some TS versions,
  // but a plain Uint8Array (over ArrayBufferLike) is fine for the Web Audio API.
  (analyser.getByteTimeDomainData as (a: Uint8Array) => void)(scratch);
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < scratch.length; i++) {
    const v = (scratch[i] - 128) / 128;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / scratch.length);
  return { level: rms, peak };
}

/** List input/output devices, requesting permission first if labels are empty. */
export async function listAudioDevices(): Promise<{
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return { inputs: [], outputs: [] };
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    inputs: all.filter((d) => d.kind === "audioinput"),
    outputs: all.filter((d) => d.kind === "audiooutput"),
  };
}
