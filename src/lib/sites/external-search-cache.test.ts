import { describe, expect, it } from "vitest";
import {
  COOLDOWN_HOURS,
  DAILY_CAP_WINDOW_HOURS,
  DAILY_EXTERNAL_SEARCH_CAP,
  GRID_SIZE_DEGREES,
  checkDailyExternalSearchCap,
  dailyCapWindowStart,
  roundToGridCell,
  shouldSearchExternally,
  type RecentExternalSearchCounter,
} from "./external-search-cache";

describe("roundToGridCell", () => {
  it("rounds to the nearest 0.5 degree cell", () => {
    // 26.77 is nearer to 27.0 (diff 0.23) than to 26.5 (diff 0.27); -80.04
    // is nearer to -80.0 (diff 0.04) than to -80.5.
    expect(roundToGridCell(26.77, -80.04)).toEqual({ gridLat: 27.0, gridLng: -80.0 });
  });

  it("rounds a value already on a grid line to itself", () => {
    expect(roundToGridCell(26.5, -80.0)).toEqual({ gridLat: 26.5, gridLng: -80.0 });
  });

  it("rounds negative coordinates correctly", () => {
    expect(roundToGridCell(-33.87, 151.21)).toEqual({ gridLat: -34.0, gridLng: 151.0 });
  });

  it("puts two nearby searches (a few hundred feet apart) in the same cell", () => {
    // ~0.001 degrees ≈ 300ft — well within the same 0.5-degree cell.
    const a = roundToGridCell(26.7753, -80.0431);
    const b = roundToGridCell(26.7758, -80.0433);
    expect(a).toEqual(b);
  });

  it("uses the exact GRID_SIZE_DEGREES constant, not a hardcoded literal", () => {
    expect(GRID_SIZE_DEGREES).toBe(0.5);
  });

  it("returns clean numbers with no floating-point artifacts", () => {
    const { gridLat, gridLng } = roundToGridCell(26.7753, -80.0431);
    expect(gridLat.toString()).toBe("27");
    expect(gridLng.toString()).toBe("-80");
  });
});

describe("shouldSearchExternally", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");

  it("allows a search when the area has never been searched (null)", () => {
    expect(shouldSearchExternally(null, now)).toBe(true);
  });

  it("blocks a search well within the cooldown window", () => {
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
    expect(shouldSearchExternally(oneHourAgo, now)).toBe(false);
  });

  it(`blocks a search 1 hour short of the ${COOLDOWN_HOURS}h (~30 day) window`, () => {
    const almostOnCooldown = new Date(now.getTime() - (COOLDOWN_HOURS - 1) * 60 * 60 * 1000).toISOString();
    expect(shouldSearchExternally(almostOnCooldown, now)).toBe(false);
  });

  it(`allows a search exactly at the ${COOLDOWN_HOURS}h (~30 day) boundary`, () => {
    const exactlyOnCooldown = new Date(now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    expect(shouldSearchExternally(exactlyOnCooldown, now)).toBe(true);
  });

  it("still blocks a search a few days into the ~30 day window (the corrected, non-24h cadence)", () => {
    const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
    expect(shouldSearchExternally(threeDaysAgo, now)).toBe(false);
  });

  it("allows a search well past the ~30 day cooldown window", () => {
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldSearchExternally(fortyDaysAgo, now)).toBe(true);
  });

  it("fails toward the cooldown (blocks) on an unparseable timestamp", () => {
    expect(shouldSearchExternally("not-a-real-timestamp", now)).toBe(false);
  });

  it("defaults `now` to the real current time when not provided", () => {
    // Sanity check the default-parameter path executes without error and
    // gives a sane answer for a definitely-stale timestamp.
    expect(shouldSearchExternally("2020-01-01T00:00:00.000Z")).toBe(true);
  });
});

describe("dailyCapWindowStart", () => {
  it("is exactly DAILY_CAP_WINDOW_HOURS before `now`", () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    expect(dailyCapWindowStart(now).toISOString()).toBe(
      new Date(now.getTime() - DAILY_CAP_WINDOW_HOURS * 60 * 60 * 1000).toISOString(),
    );
  });

  it("uses a 24h window", () => {
    expect(DAILY_CAP_WINDOW_HOURS).toBe(24);
  });

  it("defaults `now` to the real current time when not provided", () => {
    expect(dailyCapWindowStart().getTime()).toBeLessThan(Date.now());
  });
});

describe("checkDailyExternalSearchCap", () => {
  const counter = (count: number): RecentExternalSearchCounter => async () => count;

  it("allows a search well under the cap", async () => {
    const result = await checkDailyExternalSearchCap(counter(3), 100);
    expect(result).toEqual({ allowed: true, searchesInWindow: 3, cap: 100 });
  });

  it("allows a search one below the cap (the last allowed one)", async () => {
    const result = await checkDailyExternalSearchCap(counter(99), 100);
    expect(result.allowed).toBe(true);
  });

  it("blocks a search exactly at the cap", async () => {
    const result = await checkDailyExternalSearchCap(counter(100), 100);
    expect(result).toEqual({ allowed: false, searchesInWindow: 100, cap: 100, reason: "cap-reached" });
  });

  it("blocks a search past the cap", async () => {
    const result = await checkDailyExternalSearchCap(counter(250), 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cap-reached");
  });

  it("allows the very first search of a window (zero count)", async () => {
    const result = await checkDailyExternalSearchCap(counter(0), 100);
    expect(result.allowed).toBe(true);
  });

  it("fails closed when the counter throws — an unknown count is never 'under the cap'", async () => {
    const result = await checkDailyExternalSearchCap(async () => {
      throw new Error("count query failed");
    }, 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("count-unavailable");
    expect(result.searchesInWindow).toBe(Number.POSITIVE_INFINITY);
  });

  it("fails closed on a NaN count (a broken counter, not a low count)", async () => {
    const result = await checkDailyExternalSearchCap(counter(Number.NaN), 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("count-unavailable");
  });

  it("fails closed on a negative count", async () => {
    const result = await checkDailyExternalSearchCap(counter(-1), 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("count-unavailable");
  });

  it("defaults to DAILY_EXTERNAL_SEARCH_CAP when no cap is passed", async () => {
    const atCap = await checkDailyExternalSearchCap(counter(DAILY_EXTERNAL_SEARCH_CAP));
    expect(atCap.allowed).toBe(false);
    expect(atCap.cap).toBe(DAILY_EXTERNAL_SEARCH_CAP);

    const underCap = await checkDailyExternalSearchCap(counter(DAILY_EXTERNAL_SEARCH_CAP - 1));
    expect(underCap.allowed).toBe(true);
  });

  it("keeps the default cap finite, positive, and conservative", () => {
    // The exact number isn't sacred (see the constant's comment), but it
    // must stay a real bound — a missing/zero/absurd cap would silently
    // remove the only global volume limit on Overpass calls.
    expect(Number.isInteger(DAILY_EXTERNAL_SEARCH_CAP)).toBe(true);
    expect(DAILY_EXTERNAL_SEARCH_CAP).toBeGreaterThan(0);
    expect(DAILY_EXTERNAL_SEARCH_CAP).toBeLessThanOrEqual(1000);
  });

  it("is independent of the per-cell cooldown — a fresh cell still can't exceed the global cap", async () => {
    // The abuse case this cap exists for: a never-searched grid cell
    // (shouldSearchExternally -> true) must still be refused once the
    // global window is exhausted.
    expect(shouldSearchExternally(null)).toBe(true);
    const result = await checkDailyExternalSearchCap(counter(DAILY_EXTERNAL_SEARCH_CAP), DAILY_EXTERNAL_SEARCH_CAP);
    expect(result.allowed).toBe(false);
  });
});
