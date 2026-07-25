import { encodePcm16Wav, joinFloat32Chunks } from "@/lib/audio";
import type { DiarizationWindow } from "@/lib/types";

type PendingReference = {
  targetSamples: number;
  chunks: Float32Array[];
  sampleCount: number;
  resolve: (blob: Blob) => void;
  reject: (error: Error) => void;
};

export class DiarizationCapture {
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private rollingSamples = 0;
  private absoluteSamples = 0;
  private lastEmissionAt = 0;
  private pendingReference: PendingReference | null = null;
  private stopped = false;

  constructor(
    private readonly stream: MediaStream,
    private readonly onWindow: (window: DiarizationWindow) => void,
    private readonly windowSeconds = 8,
    private readonly overlapSeconds = 1,
  ) {}

  async start() {
    if (!window.AudioContext || !window.AudioWorkletNode) {
      throw new Error("AudioWorklet is not supported in this browser.");
    }

    this.context = new AudioContext({ latencyHint: "interactive" });
    await this.context.audioWorklet.addModule("/pcm-capture-worklet.js");
    await this.context.resume();

    this.source = this.context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.context, "relay-pcm-capture");
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.worklet.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (this.stopped) return;
      this.handleSamples(new Float32Array(data));
    };

    this.source.connect(this.worklet);
    this.worklet.connect(this.sink);
    this.sink.connect(this.context.destination);
  }

  captureReference(seconds = 4): Promise<Blob> {
    if (!this.context || this.stopped) {
      return Promise.reject(new Error("Speaker capture is not running."));
    }
    if (this.pendingReference) {
      return Promise.reject(new Error("Another speaker is already being recorded."));
    }

    return new Promise<Blob>((resolve, reject) => {
      this.pendingReference = {
        targetSamples: Math.round(this.context!.sampleRate * seconds),
        chunks: [],
        sampleCount: 0,
        resolve,
        reject,
      };
    });
  }

  stop() {
    this.stopped = true;
    this.pendingReference?.reject(new Error("Speaker capture stopped."));
    this.pendingReference = null;
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.sink?.disconnect();
    this.worklet = null;
    this.source = null;
    this.sink = null;
    void this.context?.close();
    this.context = null;
    this.chunks = [];
    this.rollingSamples = 0;
  }

  private handleSamples(samples: Float32Array) {
    if (!this.context) return;
    this.absoluteSamples += samples.length;
    this.chunks.push(samples);
    this.rollingSamples += samples.length;

    const maxSamples = Math.round(this.context.sampleRate * this.windowSeconds);
    while (this.rollingSamples - (this.chunks[0]?.length ?? 0) >= maxSamples) {
      const removed = this.chunks.shift();
      if (removed) this.rollingSamples -= removed.length;
    }

    if (this.rollingSamples > maxSamples && this.chunks[0]) {
      const excess = this.rollingSamples - maxSamples;
      this.chunks[0] = this.chunks[0].subarray(excess);
      this.rollingSamples -= excess;
    }

    this.collectReference(samples);

    const stepSamples = Math.round(
      this.context.sampleRate * (this.windowSeconds - this.overlapSeconds),
    );
    const ready = this.rollingSamples >= maxSamples;
    const due =
      this.lastEmissionAt === 0 ||
      this.absoluteSamples - this.lastEmissionAt >= stepSamples;

    if (!ready || !due) return;

    const pcm = joinFloat32Chunks(this.chunks, maxSamples);
    const durationMs = Math.round((pcm.length / this.context.sampleRate) * 1_000);
    const startMs = Math.max(
      0,
      Math.round(
        ((this.absoluteSamples - pcm.length) / this.context.sampleRate) * 1_000,
      ),
    );
    this.lastEmissionAt = this.absoluteSamples;
    this.onWindow({
      id: crypto.randomUUID(),
      blob: encodePcm16Wav(pcm, this.context.sampleRate),
      startMs,
      durationMs,
    });
  }

  private collectReference(samples: Float32Array) {
    const pending = this.pendingReference;
    if (!pending || !this.context) return;

    pending.chunks.push(samples);
    pending.sampleCount += samples.length;
    if (pending.sampleCount < pending.targetSamples) return;

    const joined = joinFloat32Chunks(pending.chunks);
    const exact = joined.subarray(0, pending.targetSamples);
    const blob = encodePcm16Wav(exact, this.context.sampleRate);
    this.pendingReference = null;
    pending.resolve(blob);
  }
}
