import { describe, expect, it } from "vitest";
import {
  HAZARD_RECENCY_FRESH_DAYS,
  HAZARD_RECENCY_STALE_DAYS,
  hazardReportRecency,
} from "./hazard-recency";

/**
 * Pure-logic coverage for hazard-report age classification (plan.md's Task
 * 13 v5 addition). Every case uses a fixed injected `now` — never the real
 * clock — matching `src/lib/dive-plans/pretrip-entries.test.ts`'s own
 * convention for testing a `now`-injectable function.
 */

const NOW = new Date("2026-08-21T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("hazardReportRecency", () => {
  it("classifies a report from moments ago as fresh", () => {
    expect(hazardReportRecency(NOW.toISOString(), NOW)).toBe("fresh");
  });

  it("classifies a report just under the fresh threshold as fresh", () => {
    expect(hazardReportRecency(daysAgo(HAZARD_RECENCY_FRESH_DAYS - 0.01), NOW)).toBe("fresh");
  });

  it("classifies a report exactly at the fresh threshold as aging (the boundary belongs to the next tier up)", () => {
    expect(hazardReportRecency(daysAgo(HAZARD_RECENCY_FRESH_DAYS), NOW)).toBe("aging");
  });

  it("classifies a report in the middle of the aging window as aging", () => {
    const midpoint = (HAZARD_RECENCY_FRESH_DAYS + HAZARD_RECENCY_STALE_DAYS) / 2;
    expect(hazardReportRecency(daysAgo(midpoint), NOW)).toBe("aging");
  });

  it("classifies a report just under the stale threshold as aging", () => {
    expect(hazardReportRecency(daysAgo(HAZARD_RECENCY_STALE_DAYS - 0.01), NOW)).toBe("aging");
  });

  it("classifies a report exactly at the stale threshold as stale", () => {
    expect(hazardReportRecency(daysAgo(HAZARD_RECENCY_STALE_DAYS), NOW)).toBe("stale");
  });

  it("classifies a report well past the stale threshold as stale", () => {
    expect(hazardReportRecency(daysAgo(365), NOW)).toBe("stale");
  });

  it("accepts a Date instance as well as an ISO string", () => {
    expect(hazardReportRecency(new Date(daysAgo(1)), NOW)).toBe("fresh");
  });

  it("defaults now to the real clock when not injected", () => {
    // Not asserting a specific tier (that would depend on the real date) —
    // only that the default path runs without needing a caller to pass
    // `now`, and a just-created timestamp reads as fresh against whatever
    // "now" actually is.
    expect(hazardReportRecency(new Date().toISOString())).toBe("fresh");
  });

  describe("fails toward the least-trusted tier on bad input", () => {
    it("treats an unparseable timestamp as stale, never as fresh", () => {
      expect(hazardReportRecency("not-a-real-date", NOW)).toBe("stale");
    });

    it("treats an empty string as stale", () => {
      expect(hazardReportRecency("", NOW)).toBe("stale");
    });
  });

  it("treats a future-dated report (clock skew) as fresh, same non-guard as FreshnessBadge's analogous case", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    expect(hazardReportRecency(future, NOW)).toBe("fresh");
  });
});
