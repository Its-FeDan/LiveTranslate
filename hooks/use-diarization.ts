"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DiarizationCapture } from "@/lib/diarization-capture";
import { reconcileDiarizedWindow } from "@/lib/transcript";
import type {
  DiarizationWindow,
  DiarizedApiSegment,
  KnownSpeaker,
  SpeakerSegment,
} from "@/lib/types";

export type DiarizationStatus =
  | "off"
  | "starting"
  | "listening"
  | "analyzing"
  | "error";

type DiarizationResponse = {
  windowId: string;
  windowStartMs: number;
  segments: DiarizedApiSegment[];
  error?: { message?: string };
};

export function useDiarization(
  stream: MediaStream | null,
  enabled: boolean,
  windowSeconds = 8,
) {
  const captureRef = useRef<DiarizationCapture | null>(null);
  const knownSpeakersRef = useRef<KnownSpeaker[]>([]);
  const segmentsRef = useRef<SpeakerSegment[]>([]);
  const nextSpeakerIndexRef = useRef(0);
  const uploadActiveRef = useRef(false);
  const pendingWindowRef = useRef<DiarizationWindow | null>(null);
  const mountedRef = useRef(true);
  const [status, setStatus] = useState<DiarizationStatus>("off");
  const [message, setMessage] = useState<string | null>(null);
  const [segments, setSegments] = useState<SpeakerSegment[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [knownSpeakers, setKnownSpeakers] = useState<KnownSpeaker[]>([]);
  const [enrolling, setEnrolling] = useState<string | null>(null);

  useEffect(() => {
    knownSpeakersRef.current = knownSpeakers;
  }, [knownSpeakers]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const uploadWindow = useCallback(async (window: DiarizationWindow) => {
    if (uploadActiveRef.current) {
      pendingWindowRef.current = window;
      return;
    }

    uploadActiveRef.current = true;
    if (mountedRef.current) setStatus("analyzing");

    try {
      const form = new FormData();
      form.append("file", window.blob, `${window.id}.wav`);
      form.append("windowId", window.id);
      form.append("windowStartMs", String(window.startMs));
      form.append("durationMs", String(window.durationMs));
      form.append(
        "knownSpeakerNames",
        JSON.stringify(knownSpeakersRef.current.map((speaker) => speaker.name)),
      );
      knownSpeakersRef.current.forEach((speaker, index) => {
        form.append(`reference_${index}`, speaker.reference, `${speaker.id}.wav`);
      });

      const response = await fetch("/api/diarize", {
        method: "POST",
        body: form,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as DiarizationResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ?? "Speaker analysis could not process this window.",
        );
      }

      const reconciled = reconcileDiarizedWindow({
        existing: segmentsRef.current,
        incoming: payload.segments ?? [],
        windowId: payload.windowId,
        windowStartMs: payload.windowStartMs,
        knownSpeakerNames: knownSpeakersRef.current.map((speaker) => speaker.name),
        nextSpeakerIndex: nextSpeakerIndexRef.current,
      });
      nextSpeakerIndexRef.current = reconciled.nextSpeakerIndex;
      segmentsRef.current = reconciled.segments;
      if (mountedRef.current) {
        setSegments(reconciled.segments);
        setStatus("listening");
        setMessage(null);
      }
    } catch (error) {
      if (mountedRef.current) {
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Speaker labels are temporarily unavailable.",
        );
      }
    } finally {
      uploadActiveRef.current = false;
      const pending = pendingWindowRef.current;
      pendingWindowRef.current = null;
      if (pending) void uploadWindow(pending);
    }
  }, []);

  useEffect(() => {
    captureRef.current?.stop();
    captureRef.current = null;

    if (!enabled || !stream) {
      setStatus("off");
      return;
    }

    setStatus("starting");
    const capture = new DiarizationCapture(stream, (window) => {
      void uploadWindow(window);
    }, windowSeconds, 1);
    captureRef.current = capture;
    void capture
      .start()
      .then(() => {
        if (captureRef.current === capture) setStatus("listening");
      })
      .catch((error) => {
        if (captureRef.current !== capture) return;
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "This browser cannot capture speaker windows.",
        );
      });

    return () => {
      capture.stop();
      if (captureRef.current === capture) captureRef.current = null;
    };
  }, [enabled, stream, uploadWindow, windowSeconds]);

  const enrollSpeaker = useCallback(async (rawName: string) => {
    const name = rawName.trim();
    if (!name) throw new Error("Enter a speaker name first.");
    if (knownSpeakersRef.current.length >= 4) {
      throw new Error("You can enroll up to four speakers per session.");
    }
    if (!captureRef.current) {
      throw new Error("Turn on speaker labels before recording a speaker.");
    }

    setEnrolling(name);
    setMessage("Ask this person to speak alone for four seconds.");
    try {
      const reference = await captureRef.current.captureReference(4);
      const speaker: KnownSpeaker = {
        id: crypto.randomUUID(),
        name,
        reference,
        createdAt: Date.now(),
      };
      setKnownSpeakers((current) => {
        const next = [...current, speaker];
        knownSpeakersRef.current = next;
        return next;
      });
      setAliases((current) => ({
        ...current,
        [`known:${normalizeName(name)}`]: name,
      }));
      setMessage(`${name} is enrolled for this session.`);
      return speaker;
    } finally {
      setEnrolling(null);
    }
  }, []);

  const removeKnownSpeaker = useCallback((id: string) => {
    setKnownSpeakers((current) => {
      const next = current.filter((speaker) => speaker.id !== id);
      knownSpeakersRef.current = next;
      return next;
    });
  }, []);

  const renameSpeaker = useCallback((speakerKey: string, name: string) => {
    const trimmed = name.trim();
    setAliases((current) => {
      const next = { ...current };
      if (trimmed) next[speakerKey] = trimmed;
      else delete next[speakerKey];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    pendingWindowRef.current = null;
    segmentsRef.current = [];
    knownSpeakersRef.current = [];
    nextSpeakerIndexRef.current = 0;
    setSegments([]);
    setAliases({});
    setKnownSpeakers([]);
    setMessage(null);
    setEnrolling(null);
    setStatus("off");
  }, []);

  return {
    status,
    message,
    segments,
    aliases,
    knownSpeakers,
    enrolling,
    enrollSpeaker,
    removeKnownSpeaker,
    renameSpeaker,
    reset,
  };
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-");
}
