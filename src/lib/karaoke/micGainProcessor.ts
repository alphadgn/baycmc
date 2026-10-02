import type { AudioProcessorOptions, Track, TrackProcessor } from "livekit-client";

/**
 * LiveKit audio processor that inserts a real GainNode between the
 * microphone capture and the encoder, so the "mic volume" slider changes
 * what listeners actually receive (not a local playback volume).
 */
export class MicGainProcessor implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = "baycmc-mic-gain";
  processedTrack?: MediaStreamTrack;
  private gain: GainNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private value: number;

  constructor(initial = 1) {
    this.value = clamp(initial);
  }

  async init(opts: AudioProcessorOptions) {
    const ctx = opts.audioContext;
    if (ctx.state === "suspended") {
      // Surface failures instead of silently publishing silence.
      await ctx.resume();
    }
    this.source = ctx.createMediaStreamSource(new MediaStream([opts.track]));
    this.gain = ctx.createGain();
    this.gain.gain.value = this.value;
    this.dest = ctx.createMediaStreamDestination();
    this.source.connect(this.gain).connect(this.dest);
    this.processedTrack = this.dest.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    try {
      this.source?.disconnect();
      this.gain?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.processedTrack?.stop();
    this.source = null;
    this.gain = null;
    this.dest = null;
    this.processedTrack = undefined;
  }

  setGain(v: number) {
    this.value = clamp(v);
    if (this.gain) this.gain.gain.setTargetAtTime(this.value, this.gain.context.currentTime, 0.02);
  }
}

function clamp(v: number) {
  return Math.max(0, Math.min(1, v));
}
