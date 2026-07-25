import { createHmac } from "node:crypto";

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function requestIdentity(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    "anonymous";
  const ip = forwarded.split(",")[0]?.trim() || "anonymous";
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const salt =
    process.env.SAFETY_HASH_SALT ??
    process.env.OPENAI_API_KEY ??
    "relay-development-only";

  return createHmac("sha256", salt)
    .update(`${ip}:${userAgent}`)
    .digest("hex");
}
