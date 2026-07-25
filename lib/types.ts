export type TranslationStatus =
  | "idle"
  | "requesting_permission"
  | "connecting"
  | "listening"
  | "delayed"
  | "reconnecting"
  | "stopped"
  | "error";

export type TranslationErrorCode =
  | "permission_denied"
  | "unsupported_browser"
  | "audio_output_blocked"
  | "session_rejected"
  | "network_unavailable"
  | "rate_limited"
  | "unknown";

export type TranslationError = {
  code: TranslationErrorCode;
  message: string;
  retryable: boolean;
};

export type TranslationMetrics = {
  startedAt: number | null;
  connectedAt: number | null;
  firstSourceTranscriptAt: number | null;
  firstOutputTranscriptAt: number | null;
  firstOutputAudioAt: number | null;
  reconnectCount: number;
};

export type KnownSpeaker = {
  id: string;
  name: string;
  reference: Blob;
  createdAt: number;
};

export type DiarizedApiSegment = {
  id: string;
  startMs: number;
  endMs: number;
  speaker: string;
  text: string;
};

export type SpeakerSegment = {
  id: string;
  startMs: number;
  endMs: number;
  speakerKey: string;
  rawSpeaker: string;
  text: string;
  windowId: string;
  provisional: boolean;
};

export type DiarizationWindow = {
  id: string;
  blob: Blob;
  startMs: number;
  durationMs: number;
};
