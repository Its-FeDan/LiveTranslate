# Relay Live Translate

Relay is a mobile-first, one-way live interpreter: nearby Russian speech is
translated into English audio and captions, while the user replies naturally
in English. The P1 implementation adds optional speaker-aware transcript labels
without putting diarization on the latency-critical translation path.

## Architecture

- The browser requests microphone access and opens WebRTC directly to OpenAI's
  Realtime Translation API. Audio does not proxy through Vercel.
- `POST /api/realtime-translation/session` runs on Vercel only long enough to
  mint a short-lived client secret. The OpenAI API key never reaches the browser.
- Optional speaker labels capture rolling 8-second PCM windows with 1-second
  overlap. `POST /api/diarize` forwards those windows to
  `gpt-4o-transcribe-diarize` and reconciles provisional identities in the
  browser. A busy diarization request replaces its backlog with only the newest
  window, so labels cannot slow live translation.
- Up to four people can record a 4-second, session-only reference. Names and
  samples remain in browser memory and are cleared when the session stops.

The product and technical decisions are in
[`docs/realtime-translation-spec.md`](docs/realtime-translation-spec.md).

## Run locally

Requirements: Node.js 22+ and an OpenAI API key with access to the Realtime
Translation and transcription models.

```bash
npm install
cp .env.example .env.local
# Add OPENAI_API_KEY to .env.local
npm run dev
```

Open `http://localhost:3000` from a secure browser context. Localhost counts as
secure; a phone on your LAN normally requires HTTPS before microphone access is
available.

## Deploy to Vercel

1. Import this repository as a Next.js project.
2. Add `OPENAI_API_KEY` as a server-only environment variable.
3. Add a long random `SAFETY_HASH_SALT`.
4. Leave `ENABLE_DIARIZATION=true`, or set it to `false` to disable the P1 route.
5. Deploy. No persistent server or WebSocket host is required on Vercel.

For production abuse protection, replace the included best-effort per-instance
rate limiter with a shared Vercel-compatible store before opening the app to
untrusted traffic.

## Verification

```bash
npm run typecheck
npm run test:run
npm run build
```

Live end-to-end verification additionally needs microphone permission, a real
API key, and Russian speech input. Speaker labels intentionally lag the live
translation by one analysis window.

## Privacy boundary

The application does not write transcripts, raw audio, known-speaker names, or
voice references to application storage. OpenAI still processes the live media
needed to provide the service; deployment owners should present appropriate
consent and update the privacy notice for their jurisdiction before public use.
