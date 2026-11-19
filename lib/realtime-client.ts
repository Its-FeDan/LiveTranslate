import type {
  TranslationError,
  TranslationMetrics,
  TranslationStatus,
} from "@/lib/types";

type SessionSecret = {
  clientSecret: string;
  expiresAt: number | null;
};

type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string; code?: string };
};

export type RealtimeClientCallbacks = {
  onStatus: (status: TranslationStatus) => void;
  onError: (error: TranslationError | null) => void;
  onSourceDelta: (delta: string) => void;
  onOutputDelta: (delta: string) => void;
  onStream: (stream: MediaStream | null) => void;
  onMetrics: (metrics: TranslationMetrics) => void;
};

const EMPTY_METRICS: TranslationMetrics = {
  startedAt: null,
  connectedAt: null,
  firstSourceTranscriptAt: null,
  firstOutputTranscriptAt: null,
  firstOutputAudioAt: null,
  reconnectCount: 0,
};

export class RealtimeTranslationClient {
  private peer: RTCPeerConnection | null = null;
  private events: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private translatedAudio: HTMLAudioElement | null = null;
  private remoteStream: MediaStream | null = null;
  private silent = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private connecting = false;
  private volume = 1;
  private metrics: TranslationMetrics = { ...EMPTY_METRICS };

  constructor(private readonly callbacks: RealtimeClientCallbacks) {}

  async start() {
    this.stop(false);
    this.stopped = false;
    this.metrics = { ...EMPTY_METRICS, startedAt: performance.now() };
    this.callbacks.onMetrics({ ...this.metrics });
    this.callbacks.onError(null);

    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      this.fail({
        code: "unsupported_browser",
        message: "This browser cannot start live microphone translation.",
        retryable: false,
      });
      return;
    }

    this.callbacks.onStatus("requesting_permission");

    let discardRequestedStream = false;
    const streamPromise = navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      .then((stream) => {
        if (discardRequestedStream) {
          stream.getTracks().forEach((track) => track.stop());
        }
        return stream;
      });

    try {
      const [stream, secret] = await Promise.all([streamPromise, this.createSecret()]);

      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      this.callbacks.onStream(stream);
      await this.openPeer(secret);
    } catch (error) {
      discardRequestedStream = true;
      void streamPromise
        .then((stream) => stream.getTracks().forEach((track) => track.stop()))
        .catch(() => undefined);
      if (this.stopped) return;
      this.fail(normalizeStartError(error));
    }
  }

  stop(updateStatus = true) {
    this.stopped = true;
    this.connecting = false;
    this.clearTimers();
    this.events?.close();
    this.events = null;
    this.peer?.close();
    this.peer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.callbacks.onStream(null);

    this.remoteStream = null;
    this.stopAudio();

    if (updateStatus) this.callbacks.onStatus("stopped");
  }

  setMuted(muted: boolean) {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.translatedAudio) this.translatedAudio.volume = this.volume;
  }

  setSilent(silent: boolean) {
    this.silent = silent;
    if (silent) {
      this.stopAudio();
    } else if (this.remoteStream) {
      void this.playAudio();
    }
  }

  async resumeAudio(): Promise<boolean> {
    if (this.silent || !this.remoteStream) return false;
    const audio = this.translatedAudio ?? new Audio();
    this.translatedAudio = audio;
    audio.volume = this.volume;
    if (audio.srcObject !== this.remoteStream) audio.srcObject = this.remoteStream;
    try {
      await audio.play();
      return audio === this.translatedAudio;
    } catch {
      return false;
    }
  }

  private stopAudio() {
    if (!this.translatedAudio) return;
    this.translatedAudio.pause();
    this.translatedAudio.srcObject = null;
    this.translatedAudio = null;
  }

  private async playAudio() {
    const playback = this.resumeAudio();
    const audio = this.translatedAudio;
    const played = await playback;
    if (!played && audio && audio === this.translatedAudio) {
      this.callbacks.onError({
        code: "audio_output_blocked",
        message: "Tap the audio control to hear the translation.",
        retryable: true,
      });
    }
  }

  reconnectIfNeeded() {
    if (this.stopped || this.connecting) return;
    if (this.peer?.connectionState === "connected") return;
    this.scheduleReconnect(true);
  }

  private async createSecret(): Promise<SessionSecret> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch("/api/realtime-translation/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLanguage: "en" }),
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        clientSecret?: string;
        expiresAt?: number | null;
        error?: TranslationError;
      };

      if (!response.ok || !payload.clientSecret) {
        const serverError = payload.error;
        throw Object.assign(
          new Error(serverError?.message ?? "A session could not be created."),
          {
            code:
              response.status === 429
                ? "rate_limited"
                : serverError?.code ?? "session_rejected",
            retryable: serverError?.retryable ?? response.status >= 500,
          },
        );
      }

      return {
        clientSecret: payload.clientSecret,
        expiresAt: payload.expiresAt ?? null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async openPeer(secret: SessionSecret) {
    if (!this.stream || this.stopped || this.connecting) return;
    this.connecting = true;
    this.callbacks.onStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    this.events?.close();
    this.peer?.close();
    this.remoteStream = null;
    this.stopAudio();

    const peer = new RTCPeerConnection();
    this.peer = peer;
    const track = this.stream.getAudioTracks()[0];
    if (!track) throw new Error("The microphone track ended.");
    peer.addTrack(track, this.stream);

    const events = peer.createDataChannel("oai-events");
    this.events = events;
    events.addEventListener("message", (message) => this.handleEvent(message.data));
    events.addEventListener("error", () => {
      if (!this.stopped) this.callbacks.onStatus("delayed");
    });

    peer.addEventListener("track", ({ streams }) => {
      const [remoteStream] = streams;
      if (!remoteStream || this.stopped || peer !== this.peer) return;
      this.remoteStream = remoteStream;
      if (this.metrics.firstOutputAudioAt === null) {
        this.metrics.firstOutputAudioAt = performance.now();
        this.callbacks.onMetrics({ ...this.metrics });
      }
      if (!this.silent) void this.playAudio();
    });

    peer.addEventListener("connectionstatechange", () => {
      if (this.stopped || peer !== this.peer) return;
      const state = peer.connectionState;
      if (state === "connected") {
        this.connecting = false;
        this.reconnectAttempt = 0;
        this.clearDisconnectTimer();
        if (this.metrics.connectedAt === null) {
          this.metrics.connectedAt = performance.now();
          this.callbacks.onMetrics({ ...this.metrics });
        }
        this.callbacks.onError(null);
        this.callbacks.onStatus("listening");
      } else if (state === "disconnected") {
        this.callbacks.onStatus("delayed");
        this.clearDisconnectTimer();
        this.disconnectTimer = setTimeout(() => {
          if (peer.connectionState !== "connected") this.scheduleReconnect();
        }, 2_000);
      } else if (state === "failed") {
        this.connecting = false;
        this.scheduleReconnect();
      } else if (state === "closed") {
        this.connecting = false;
      }
    });

    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(
          "https://api.openai.com/v1/realtime/translations/calls",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secret.clientSecret}`,
              "Content-Type": "application/sdp",
            },
            body: offer.sdp,
            signal: controller.signal,
          },
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw Object.assign(new Error("OpenAI rejected the live connection."), {
          code: response.status === 429 ? "rate_limited" : "session_rejected",
          retryable: true,
        });
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      });
      this.connecting = false;
    } catch (error) {
      this.connecting = false;
      if (peer === this.peer) peer.close();
      throw error;
    }
  }

  private handleEvent(data: unknown) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(String(data)) as RealtimeEvent;
    } catch {
      return;
    }

    if (event.type === "session.input_transcript.delta" && event.delta) {
      if (this.metrics.firstSourceTranscriptAt === null) {
        this.metrics.firstSourceTranscriptAt = performance.now();
        this.callbacks.onMetrics({ ...this.metrics });
      }
      this.callbacks.onSourceDelta(event.delta);
    }

    if (event.type === "session.output_transcript.delta" && event.delta) {
      if (this.metrics.firstOutputTranscriptAt === null) {
        this.metrics.firstOutputTranscriptAt = performance.now();
        this.callbacks.onMetrics({ ...this.metrics });
      }
      this.callbacks.onOutputDelta(event.delta);
    }

    if (event.type === "error" || event.type === "session.error") {
      this.callbacks.onError({
        code: "session_rejected",
        message: event.error?.message ?? "The live translation session reported an error.",
        retryable: true,
      });
    }
  }

  private scheduleReconnect(immediate = false) {
    if (this.stopped || !this.stream || this.reconnectTimer) return;
    if (this.reconnectAttempt >= 4) {
      this.fail({
        code: "network_unavailable",
        message: "The connection could not recover. Tap retry when the network is stable.",
        retryable: true,
      });
      return;
    }

    this.reconnectAttempt += 1;
    this.metrics.reconnectCount += 1;
    this.callbacks.onMetrics({ ...this.metrics });
    this.callbacks.onStatus("reconnecting");
    const delay = immediate ? 0 : Math.min(4_000, 600 * 2 ** (this.reconnectAttempt - 1));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.createSecret()
        .then((secret) => this.openPeer(secret))
        .catch((error) => {
          this.callbacks.onError(normalizeStartError(error));
          this.scheduleReconnect();
        });
    }, delay);
  }

  private fail(error: TranslationError) {
    this.stop(false);
    this.callbacks.onError(error);
    this.callbacks.onStatus("error");
  }

  private clearTimers() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearDisconnectTimer();
  }

  private clearDisconnectTimer() {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }
}

function normalizeStartError(error: unknown): TranslationError {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return {
      code: "permission_denied",
      message: "Microphone access is needed to translate nearby speech.",
      retryable: true,
    };
  }

  const candidate = error as {
    message?: string;
    code?: string;
    retryable?: boolean;
    name?: string;
  };
  const code = candidate.code;
  return {
    code:
      code === "rate_limited"
        ? "rate_limited"
        : code === "session_rejected"
          ? "session_rejected"
          : candidate.name === "AbortError"
            ? "network_unavailable"
            : "unknown",
    message:
      candidate.name === "AbortError"
        ? "The connection took too long. Check the network and retry."
        : candidate.message ?? "Live translation could not start.",
    retryable: candidate.retryable ?? true,
  };
}
