import { NextResponse } from "next/server";
import { z } from "zod";

import { rateLimitHeaders, takeRateLimit } from "@/lib/rate-limit";
import { isSameOrigin, requestIdentity } from "@/lib/security";
import { SOURCE_LANGUAGES } from "@/lib/source-languages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const metadataSchema = z.object({
  windowId: z.string().min(1).max(120),
  windowStartMs: z.coerce.number().min(0),
  durationMs: z.coerce.number().min(2_000).max(15_000),
});

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;

type UpstreamSegment = {
  id?: string;
  start?: number;
  end?: number;
  speaker?: string;
  text?: string;
};

type UpstreamDiarization = {
  segments?: UpstreamSegment[];
};

export async function POST(request: Request) {
  if (process.env.ENABLE_DIARIZATION === "false") {
    return apiError(
      "feature_disabled",
      "Speaker labels are not enabled on this deployment.",
      404,
      false,
    );
  }

  if (!isSameOrigin(request)) {
    return apiError("origin_rejected", "Request origin was rejected.", 403, false);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return apiError(
      "server_not_configured",
      "Speaker labels are not configured yet.",
      503,
      false,
    );
  }

  const identity = requestIdentity(request);
  const limit = takeRateLimit(`diarize:${identity}`, 24, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: "Speaker analysis is catching up.",
          retryable: true,
        },
      },
      { status: 429, headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("invalid_form", "The audio window was invalid.", 400, false);
  }

  const audio = form.get("file");
  if (!(audio instanceof File) || audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    return apiError(
      "invalid_audio",
      "The audio window was empty or too large.",
      400,
      false,
    );
  }

  const metadataResult = metadataSchema.safeParse({
    windowId: form.get("windowId"),
    windowStartMs: form.get("windowStartMs"),
    durationMs: form.get("durationMs"),
  });
  if (!metadataResult.success) {
    return apiError("invalid_metadata", "The audio timing was invalid.", 400, false);
  }

  const sourceLanguage = z.enum(SOURCE_LANGUAGES).safeParse(form.get("sourceLanguage") ?? "ru");
  if (!sourceLanguage.success) {
    return apiError("invalid_language", "Select Russian or Dutch as the source language.", 400, false);
  }

  const names = parseSpeakerNames(form.get("knownSpeakerNames"));
  if (!names.ok) {
    return apiError("invalid_speakers", names.message, 400, false);
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", audio, `${metadataResult.data.windowId}.wav`);
  upstreamForm.append("model", "gpt-4o-transcribe-diarize");
  upstreamForm.append("response_format", "diarized_json");
  upstreamForm.append("chunking_strategy", "auto");
  upstreamForm.append("language", sourceLanguage.data);

  for (let index = 0; index < names.value.length; index += 1) {
    const reference = form.get(`reference_${index}`);
    if (!(reference instanceof File) || reference.size === 0) continue;
    if (reference.size > MAX_REFERENCE_BYTES) {
      return apiError(
        "reference_too_large",
        "A speaker reference was too large.",
        400,
        false,
      );
    }

    const bytes = Buffer.from(await reference.arrayBuffer());
    const mime = reference.type || "audio/wav";
    upstreamForm.append("known_speaker_names[]", names.value[index] ?? `speaker_${index + 1}`);
    upstreamForm.append(
      "known_speaker_references[]",
      `data:${mime};base64,${bytes.toString("base64")}`,
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "OpenAI-Safety-Identifier": identity,
      },
      body: upstreamForm,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return apiError(
      "upstream_unavailable",
      "Speaker analysis timed out. Live translation is unaffected.",
      503,
      true,
    );
  }

  if (!upstream.ok) {
    return apiError(
      upstream.status === 429 ? "rate_limited" : "diarization_failed",
      upstream.status === 429
        ? "Speaker analysis is busy. Live translation is unaffected."
        : "This speaker window could not be analyzed.",
      upstream.status === 429 ? 429 : 502,
      true,
    );
  }

  const result = (await upstream.json().catch(() => ({}))) as UpstreamDiarization;
  const segments = (result.segments ?? [])
    .filter(
      (segment) =>
        typeof segment.start === "number" &&
        typeof segment.end === "number" &&
        typeof segment.speaker === "string" &&
        typeof segment.text === "string",
    )
    .map((segment, index) => ({
      id: segment.id ?? `segment_${index}`,
      startMs: Math.max(0, Math.round((segment.start ?? 0) * 1_000)),
      endMs: Math.max(0, Math.round((segment.end ?? 0) * 1_000)),
      speaker: segment.speaker ?? "unknown",
      text: segment.text?.trim() ?? "",
    }));

  return NextResponse.json(
    {
      windowId: metadataResult.data.windowId,
      windowStartMs: metadataResult.data.windowStartMs,
      segments,
    },
    {
      headers: {
        ...rateLimitHeaders(limit),
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

function parseSpeakerNames(value: FormDataEntryValue | null):
  | { ok: true; value: string[] }
  | { ok: false; message: string } {
  if (typeof value !== "string" || value === "") return { ok: true, value: [] };

  try {
    const parsed = z
      .array(z.string().trim().min(1).max(32).regex(/^[\p{L}\p{N} _-]+$/u))
      .max(4)
      .parse(JSON.parse(value));
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, message: "Known speaker names were invalid." };
  }
}

function apiError(
  code: string,
  message: string,
  status: number,
  retryable: boolean,
) {
  return NextResponse.json(
    { error: { code, message, retryable } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
