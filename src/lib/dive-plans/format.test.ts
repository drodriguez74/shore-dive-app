import { describe, expect, it } from "vitest";
import { formatPlannedDate, isPastPlannedDate } from "./format";

describe("formatPlannedDate", () => {
  it("formats a real date string in long form", () => {
    expect(formatPlannedDate("2026-09-01")).toBe(
      new Date(2026, 8, 1).toLocaleDateString(undefined, { dateStyle: "long" }),
    );
  });

  it("never shifts to the day before, regardless of local timezone (the bug this exists to prevent)", () => {
    // The regression this file exists to prevent: `new Date("2026-09-01")`
    // parses as UTC midnight, which `toLocaleDateString` renders in the
    // *local* zone — for anyone west of UTC that silently becomes Aug 31.
    // Asserting against the local Date constructor directly (not the ISO
    // string constructor) is what actually pins the fix.
    const result = formatPlannedDate("2026-01-01");
    const wrongUtcParse = new Date("2026-01-01").toLocaleDateString(undefined, { dateStyle: "long" });
    const correctLocalParse = new Date(2026, 0, 1).toLocaleDateString(undefined, { dateStyle: "long" });
    expect(result).toBe(correctLocalParse);
    // Only meaningfully asserts something in a timezone west of UTC (where
    // the two parses actually disagree) — harmless no-op elsewhere, but
    // real coverage for exactly the case that motivated this file.
    if (wrongUtcParse !== correctLocalParse) {
      expect(result).not.toBe(wrongUtcParse);
    }
  });

  it("falls back to the raw string for a malformed date rather than throwing", () => {
    expect(formatPlannedDate("not-a-date")).toBe("not-a-date");
    expect(formatPlannedDate("")).toBe("");
  });
});

describe("isPastPlannedDate", () => {
  const TODAY = new Date(2026, 7, 13); // 2026-08-13, matching this session's date

  it("treats a date before today as past", () => {
    expect(isPastPlannedDate("2026-08-12", TODAY)).toBe(true);
  });

  it("treats today itself as not past", () => {
    expect(isPastPlannedDate("2026-08-13", TODAY)).toBe(false);
  });

  it("treats a future date as not past", () => {
    expect(isPastPlannedDate("2026-08-14", TODAY)).toBe(false);
  });

  it("ignores the time-of-day component of 'now' — only the calendar date matters", () => {
    const lateInTheDay = new Date(2026, 7, 13, 23, 59);
    expect(isPastPlannedDate("2026-08-13", lateInTheDay)).toBe(false);
  });

  it("treats a malformed date as not past rather than throwing", () => {
    expect(isPastPlannedDate("garbage", TODAY)).toBe(false);
  });
});
