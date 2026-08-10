import { describe, expect, it } from "vitest";
import { formatDuration, formatMinutesLabel } from "./format";

describe("formatDuration", () => {
  it("formats zero as 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("0:00");
  });

  it("formats sub-minute durations as M:SS", () => {
    expect(formatDuration(5000)).toBe("0:05");
    expect(formatDuration(45_000)).toBe("0:45");
  });

  it("formats exactly one minute", () => {
    expect(formatDuration(60_000)).toBe("1:00");
  });

  it("formats under an hour without an hours component", () => {
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("formats exactly one hour with an hours component", () => {
    expect(formatDuration(60 * 60_000)).toBe("1:00:00");
  });

  it("formats an arbitrary multi-hour duration as H:MM:SS", () => {
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000 + 9_000)).toBe("2:05:09");
  });

  it("rounds to the nearest second", () => {
    // 500ms rounds up to 1 second (Math.round rounds .5 up).
    expect(formatDuration(500)).toBe("0:01");
    expect(formatDuration(499)).toBe("0:00");
  });
});

describe("formatMinutesLabel", () => {
  it("formats zero minutes", () => {
    expect(formatMinutesLabel(0)).toBe("0m");
  });

  it("formats under an hour as Nm", () => {
    expect(formatMinutesLabel(45)).toBe("45m");
    expect(formatMinutesLabel(59)).toBe("59m");
  });

  it("formats exactly one hour as 1h with no minutes suffix", () => {
    expect(formatMinutesLabel(60)).toBe("1h");
  });

  it("formats an even multiple of an hour with no minutes suffix", () => {
    expect(formatMinutesLabel(120)).toBe("2h");
  });

  it("formats an hour-plus-minutes combination", () => {
    expect(formatMinutesLabel(90)).toBe("1h 30m");
    expect(formatMinutesLabel(125)).toBe("2h 5m");
  });
});
