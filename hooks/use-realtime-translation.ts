"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { RealtimeTranslationClient } from "@/lib/realtime-client";
import { appendTranscript } from "@/lib/transcript";
import type {
  TranslationError,
  TranslationMetrics,
  TranslationStatus,
} from "@/lib/types";

const INITIAL_METRICS: TranslationMetrics = {
  startedAt: null,
  connectedAt: null,
  firstSourceTranscriptAt: null,
  firstOutputTranscriptAt: null,
  firstOutputAudioAt: null,
  reconnectCount: 0,
};

export function useRealtimeTranslation() {
  const clientRef = useRef<RealtimeTranslationClient | null>(null);
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [error, setError] = useState<TranslationError | null>(null);
  const [sourceTranscript, setSourceTranscript] = useState("");
  const [translatedTranscript, setTranslatedTranscript] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [metrics, setMetrics] = useState<TranslationMetrics>(INITIAL_METRICS);

  useEffect(() => {
    const client = new RealtimeTranslationClient({
      onStatus: setStatus,
      onError: setError,
      onSourceDelta: (delta) =>
        setSourceTranscript((current) => appendTranscript(current, delta)),
      onOutputDelta: (delta) =>
        setTranslatedTranscript((current) => appendTranscript(current, delta)),
      onStream: setStream,
      onMetrics: setMetrics,
    });
    clientRef.current = client;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") client.reconnectIfNeeded();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      client.stop(false);
      clientRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    setSourceTranscript("");
    setTranslatedTranscript("");
    setError(null);
    setMutedState(false);
    setMetrics(INITIAL_METRICS);
    await clientRef.current?.start();
  }, []);

  const stop = useCallback(() => {
    clientRef.current?.stop();
    setMutedState(false);
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    clientRef.current?.setMuted(next);
  }, []);

  const setVolume = useCallback((next: number) => {
    const normalized = Math.max(0, Math.min(1, next));
    setVolumeState(normalized);
    clientRef.current?.setVolume(normalized);
  }, []);

  const resumeAudio = useCallback(async () => {
    return (await clientRef.current?.resumeAudio()) ?? false;
  }, []);

  return {
    status,
    error,
    sourceTranscript,
    translatedTranscript,
    stream,
    muted,
    volume,
    metrics,
    start,
    stop,
    setMuted,
    setVolume,
    resumeAudio,
    isActive: !["idle", "stopped"].includes(status),
  };
}
