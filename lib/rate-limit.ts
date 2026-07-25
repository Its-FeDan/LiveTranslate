type RateBucket = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, RateBucket>;

const globalRateLimit = globalThis as typeof globalThis & {
  __relayRateLimits?: RateLimitStore;
};

const store =
  globalRateLimit.__relayRateLimits ??
  (globalRateLimit.__relayRateLimits = new Map<string, RateBucket>());

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (current.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;

  if (store.size > 2_000) {
    for (const [bucketKey, bucket] of store) {
      if (bucket.resetAt <= now) store.delete(bucketKey);
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt,
  };
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
