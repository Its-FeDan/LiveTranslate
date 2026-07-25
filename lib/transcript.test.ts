import { describe, expect, it } from "vitest";

import {
  appendTranscript,
  reconcileDiarizedWindow,
  speakerDisplayName,
} from "@/lib/transcript";
import type { SpeakerSegment } from "@/lib/types";

describe("appendTranscript", () => {
  it("normalizes whitespace across streaming deltas", () => {
    expect(appendTranscript("Hello  ", "  world")).toBe("Hello world");
  });

  it("bounds the rolling transcript", () => {
    const result = appendTranscript("First sentence. ", "x".repeat(1_500));
    expect(result.length).toBeLessThanOrEqual(1_400);
  });
});

describe("reconcileDiarizedWindow", () => {
  const existing: SpeakerSegment[] = [
    {
      id: "window-1:segment-1",
      startMs: 1_000,
      endMs: 4_000,
      speakerKey: "auto:0",
      rawSpeaker: "A",
      text: "Добрый день как ваши дела",
      windowId: "window-1",
      provisional: true,
    },
  ];

  it("keeps a stable speaker through overlapping windows and removes duplicate text", () => {
    const result = reconcileDiarizedWindow({
      existing,
      incoming: [
        {
          id: "segment-2",
          startMs: 0,
          endMs: 2_000,
          speaker: "speaker_0",
          text: "Добрый день как ваши дела",
        },
      ],
      windowId: "window-2",
      windowStartMs: 1_200,
      knownSpeakerNames: [],
      nextSpeakerIndex: 1,
    });

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.speakerKey).toBe("auto:0");
    expect(result.nextSpeakerIndex).toBe(1);
  });

  it("maps enrolled names to stable known-speaker keys", () => {
    const result = reconcileDiarizedWindow({
      existing: [],
      incoming: [
        {
          id: "segment-1",
          startMs: 0,
          endMs: 2_000,
          speaker: "Alexei",
          text: "Здравствуйте",
        },
      ],
      windowId: "window-1",
      windowStartMs: 0,
      knownSpeakerNames: ["Alexei"],
      nextSpeakerIndex: 0,
    });

    expect(result.segments[0]?.speakerKey).toBe("known:alexei");
    expect(result.nextSpeakerIndex).toBe(0);
  });

  it("marks speech from overlapping speakers without claiming identity", () => {
    const result = reconcileDiarizedWindow({
      existing: [],
      incoming: [
        {
          id: "segment-1",
          startMs: 0,
          endMs: 2_000,
          speaker: "A",
          text: "Первый голос",
        },
        {
          id: "segment-2",
          startMs: 1_500,
          endMs: 3_000,
          speaker: "B",
          text: "Второй голос",
        },
      ],
      windowId: "window-1",
      windowStartMs: 0,
      knownSpeakerNames: [],
      nextSpeakerIndex: 0,
    });

    expect(result.segments.map((segment) => segment.speakerKey)).toEqual([
      "overlap",
      "overlap",
    ]);
    expect(result.nextSpeakerIndex).toBe(0);
    expect(speakerDisplayName("overlap", {})).toBe("Multiple speakers");
  });
});

describe("speakerDisplayName", () => {
  it("supports generated, known, and renamed speakers", () => {
    expect(speakerDisplayName("auto:0", {})).toBe("Speaker A");
    expect(speakerDisplayName("auto:27", {})).toBe("Speaker AB");
    expect(speakerDisplayName("known:anna-maria", {})).toBe("Anna Maria");
    expect(speakerDisplayName("auto:0", { "auto:0": "Dmitri" })).toBe(
      "Dmitri",
    );
  });
});
