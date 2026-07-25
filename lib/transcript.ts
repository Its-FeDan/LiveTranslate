import type { DiarizedApiSegment, SpeakerSegment } from "@/lib/types";

const MAX_TRANSCRIPT_CHARS = 1_400;

export function appendTranscript(current: string, delta: string): string {
  const next = `${current}${delta}`.replace(/\s+/g, " ");
  if (next.length <= MAX_TRANSCRIPT_CHARS) return next;

  const clipped = next.slice(next.length - MAX_TRANSCRIPT_CHARS);
  const firstBoundary = clipped.search(/[.!?]\s/);
  return firstBoundary >= 0 ? clipped.slice(firstBoundary + 2) : clipped;
}

export type ReconcileResult = {
  segments: SpeakerSegment[];
  nextSpeakerIndex: number;
};

export function reconcileDiarizedWindow({
  existing,
  incoming,
  windowId,
  windowStartMs,
  knownSpeakerNames,
  nextSpeakerIndex,
}: {
  existing: SpeakerSegment[];
  incoming: DiarizedApiSegment[];
  windowId: string;
  windowStartMs: number;
  knownSpeakerNames: string[];
  nextSpeakerIndex: number;
}): ReconcileResult {
  const localSpeakerMap = new Map<string, string>();
  const known = new Set(knownSpeakerNames.map(normalizeName));
  const overlappingSegmentIndexes = new Set<number>();
  let nextIndex = nextSpeakerIndex;

  for (const [segmentIndex, segment] of incoming.entries()) {
    if (
      incoming.some(
        (candidate, candidateIndex) =>
          candidateIndex !== segmentIndex &&
          candidate.speaker !== segment.speaker &&
          strictOverlapMs(
            segment.startMs,
            segment.endMs,
            candidate.startMs,
            candidate.endMs,
          ) >= 200,
      )
    ) {
      overlappingSegmentIndexes.add(segmentIndex);
      continue;
    }

    const normalizedRaw = normalizeName(segment.speaker);
    if (known.has(normalizedRaw)) {
      localSpeakerMap.set(segment.speaker, `known:${normalizedRaw}`);
      continue;
    }

    const absoluteStart = windowStartMs + segment.startMs;
    const absoluteEnd = windowStartMs + segment.endMs;
    const match = existing.find(
      (candidate) =>
        rangesOverlap(
          candidate.startMs,
          candidate.endMs,
          absoluteStart,
          absoluteEnd,
        ) && textSimilarity(candidate.text, segment.text) >= 0.5,
    );

    if (match && match.speakerKey !== "overlap") {
      localSpeakerMap.set(segment.speaker, match.speakerKey);
    }
  }

  for (const [segmentIndex, segment] of incoming.entries()) {
    if (
      !overlappingSegmentIndexes.has(segmentIndex) &&
      !localSpeakerMap.has(segment.speaker)
    ) {
      localSpeakerMap.set(segment.speaker, `auto:${nextIndex}`);
      nextIndex += 1;
    }
  }

  const merged = [...existing];

  for (const [segmentIndex, segment] of incoming.entries()) {
    const speakerKey = overlappingSegmentIndexes.has(segmentIndex)
      ? "overlap"
      : (localSpeakerMap.get(segment.speaker) ?? `auto:${nextIndex}`);
    const next: SpeakerSegment = {
      id: `${windowId}:${segment.id}`,
      startMs: windowStartMs + segment.startMs,
      endMs: windowStartMs + segment.endMs,
      speakerKey,
      rawSpeaker: segment.speaker,
      text: segment.text.trim(),
      windowId,
      provisional: !speakerKey.startsWith("known:"),
    };

    const duplicateIndex = merged.findIndex(
      (candidate) =>
        Math.abs(candidate.startMs - next.startMs) < 1_500 &&
        textSimilarity(candidate.text, next.text) >= 0.72,
    );

    if (duplicateIndex >= 0) {
      const previous = merged[duplicateIndex];
      if (!previous) continue;
      merged[duplicateIndex] = {
        ...previous,
        ...next,
        id: previous.id,
        speakerKey: previous.speakerKey.startsWith("known:")
          ? previous.speakerKey
          : next.speakerKey,
        text: next.text.length >= previous.text.length ? next.text : previous.text,
      };
    } else if (next.text) {
      merged.push(next);
    }
  }

  const latestTime = Math.max(0, ...merged.map((segment) => segment.endMs));
  const keepAfter = latestTime - 120_000;

  return {
    segments: merged
      .filter((segment) => segment.endMs >= keepAfter)
      .sort((left, right) => left.startMs - right.startMs),
    nextSpeakerIndex: nextIndex,
  };
}

export function speakerDisplayName(
  speakerKey: string,
  aliases: Record<string, string>,
): string {
  if (aliases[speakerKey]) return aliases[speakerKey];
  if (speakerKey.startsWith("known:")) {
    return titleCase(speakerKey.slice("known:".length));
  }
  if (speakerKey.startsWith("auto:")) {
    const index = Number(speakerKey.slice("auto:".length));
    return `Speaker ${alphabetLabel(index)}`;
  }
  if (speakerKey === "overlap") return "Multiple speakers";
  return "Unknown speaker";
}

function alphabetLabel(index: number): string {
  let value = Math.max(0, index);
  let label = "";
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "-");
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\p{L}/gu, (character) => character.toLocaleUpperCase());
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd) + 400;
}

function strictOverlapMs(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function textSimilarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.length === 0 || b.length === 0) return 0;
  const bCounts = new Map<string, number>();
  for (const token of b) bCounts.set(token, (bCounts.get(token) ?? 0) + 1);
  let intersection = 0;
  for (const token of a) {
    const count = bCounts.get(token) ?? 0;
    if (count > 0) {
      intersection += 1;
      bCounts.set(token, count - 1);
    }
  }
  return (2 * intersection) / (a.length + b.length);
}

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}
