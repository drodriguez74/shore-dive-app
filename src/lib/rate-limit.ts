/**
 * Best-effort per-client rate limit for public, unauthenticated routes.
 * In-memory, so it is per server instance: on serverless it blunts a burst
 * from one client rather than enforcing a global quota. Routes that spend
 * real money or third-party quota use the database-backed caps instead.
 */

interface Window {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 5000;

export interface RateLimiter {
  /** True when this call is allowed; false when the client is over its limit. */
  allow: (key: string, now?: number) => boolean;
}

export function createRateLimiter(options: { limit: number; windowMs: number }): RateLimiter {
  const windows = new Map<string, Window>();

  return {
    allow(key, now = Date.now()) {
      const current = windows.get(key);
      if (!current || now >= current.resetAt) {
        if (windows.size >= MAX_TRACKED_KEYS) {
          for (const [existingKey, window] of windows) {
            if (now >= window.resetAt) windows.delete(existingKey);
          }
          // Still full of live windows: drop the oldest rather than grow without bound.
          if (windows.size >= MAX_TRACKED_KEYS) windows.delete(windows.keys().next().value as string);
        }
        windows.set(key, { count: 1, resetAt: now + options.windowMs });
        return true;
      }
      current.count += 1;
      return current.count <= options.limit;
    },
  };
}

/** Client address as reported by the hosting proxy; "unknown" clients share one bucket. */
export function clientKey(request: { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
