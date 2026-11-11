import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then blocks", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect([1, 2, 3, 4].map(() => limiter.allow("a", 0))).toEqual([true, true, true, false]);
  });

  it("tracks clients independently and resets after the window", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("a", 500)).toBe(false);
    expect(limiter.allow("b", 500)).toBe(true);
    expect(limiter.allow("a", 1000)).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address, then x-real-ip, then a shared bucket", () => {
    expect(clientKey({ headers: new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }) })).toBe("1.2.3.4");
    expect(clientKey({ headers: new Headers({ "x-real-ip": "5.6.7.8" }) })).toBe("5.6.7.8");
    expect(clientKey({ headers: new Headers() })).toBe("unknown");
  });
});
