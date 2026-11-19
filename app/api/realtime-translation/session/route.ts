import { NextResponse } from "next/server";
import { z } from "zod";

import { rateLimitHeaders, takeRateLimit } from "@/lib/rate-limit";
import { isSameOrigin, requestIdentity } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const bodySchema = z.object({
  targetLanguage: z.literal("en"),
});

type ClientSecretResponse = {
  value?: string;
  expires_at?: number;
  error?: { message?: string; code?: string };
};

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return apiError("origin_rejected", "Request origin was rejected.", 403, false);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return apiError(
      "server_not_configured",
      "Live translation is not configured yet.",
      503,
      false,
    );
  }

  const identity = requestIdentity(request);
  const limit = takeRateLimit(`session:${identity}`, 12, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "rate_limited",
          message: "Too many session attempts. Try again shortly.",
          retryable: true,
        },
      },
      { status: 429, headers: { ...rateLimitHeaders(limit), "Cache-Control": "no-store" } },
    );
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return apiError(
      "invalid_request",
      "Only English translation output is enabled.",
      400,
      false,
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      "https://api.openai.com/v1/realtime/translations/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": identity,
        },
        body: JSON.stringify({
          expires_after: {
            anchor: "created_at",
            seconds: 600,
          },
          session: {
            model: "gpt-realtime-translate",
            audio: {
              input: {
                transcription: { model: "gpt-realtime-whisper" },
                noise_reduction: { type: "near_field" },
              },
              output: { language: parsed.targetLanguage },
            },
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    return apiError(
      "upstream_unavailable",
      "The translation service did not respond in time.",
      503,
      true,
    );
  }

  const payload = (await upstream.json().catch(() => ({}))) as ClientSecretResponse;
  if (!upstream.ok || !payload.value) {
    const isRateLimit = upstream.status === 429;
    return apiError(
      isRateLimit ? "rate_limited" : "session_rejected",
      isRateLimit
        ? "Translation capacity is busy. Try again shortly."
        : "A translation session could not be created.",
      isRateLimit ? 429 : 502,
      true,
    );
  }

  return NextResponse.json(
    {
      clientSecret: payload.value,
      expiresAt: payload.expires_at ?? null,
    },
    {
      headers: {
        ...rateLimitHeaders(limit),
        "Cache-Control": "no-store, max-age=0",
        Pragma: "no-cache",
      },
    },
  );
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
