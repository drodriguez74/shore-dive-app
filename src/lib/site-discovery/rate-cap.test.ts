import { afterEach, describe, expect, it } from "vitest";
import { DAILY_CALL_CAP, checkRateCap, resolveDailyCap, type TodayCallCounter } from "./rate-cap";

const ENV_KEY = "AREA_RESEARCH_DAILY_CALL_CAP";

describe("resolveDailyCap", () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
  });

  it("falls back to the hardcoded default when unset", () => {
    delete process.env[ENV_KEY];
    expect(resolveDailyCap()).toBe(DAILY_CALL_CAP);
  });

  it("uses a valid positive integer override", () => {
    process.env[ENV_KEY] = "25";
    expect(resolveDailyCap()).toBe(25);
  });

  it("falls back to the default on a non-numeric override", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(resolveDailyCap()).toBe(DAILY_CALL_CAP);
  });

  it("falls back to the default on a zero override", () => {
    process.env[ENV_KEY] = "0";
    expect(resolveDailyCap()).toBe(DAILY_CALL_CAP);
  });

  it("falls back to the default on a negative override", () => {
    process.env[ENV_KEY] = "-5";
    expect(resolveDailyCap()).toBe(DAILY_CALL_CAP);
  });

  it("falls back to the default on a blank override", () => {
    process.env[ENV_KEY] = "";
    expect(resolveDailyCap()).toBe(DAILY_CALL_CAP);
  });
});

describe("checkRateCap", () => {
  it("allows the call when under the cap", async () => {
    const countToday: TodayCallCounter = async () => 3;
    const result = await checkRateCap(countToday, 10);
    expect(result).toEqual({ allowed: true, callsToday: 3, cap: 10 });
  });

  it("refuses when the count equals the cap", async () => {
    const countToday: TodayCallCounter = async () => 10;
    const result = await checkRateCap(countToday, 10);
    expect(result).toEqual({ allowed: false, callsToday: 10, cap: 10, reason: "cap-reached" });
  });

  it("refuses when the count exceeds the cap", async () => {
    const countToday: TodayCallCounter = async () => 15;
    const result = await checkRateCap(countToday, 10);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cap-reached");
  });

  it("fails closed when the counter throws (count-unavailable)", async () => {
    const countToday: TodayCallCounter = async () => {
      throw new Error("supabase query failed");
    };
    const result = await checkRateCap(countToday, 10);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("count-unavailable");
    expect(result.callsToday).toBe(Number.POSITIVE_INFINITY);
    expect(result.cap).toBe(10);
  });

  it("defaults the cap to resolveDailyCap() when not passed explicitly", async () => {
    delete process.env[ENV_KEY];
    const countToday: TodayCallCounter = async () => 0;
    const result = await checkRateCap(countToday);
    expect(result.cap).toBe(DAILY_CALL_CAP);
    expect(result.allowed).toBe(true);
  });
});
