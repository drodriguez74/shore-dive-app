import { describe, expect, it } from "vitest";
import {
  formatDepthFt,
  formatElapsedClock,
  formatExposureSuit,
  formatRecordingSummary,
  formatRuntimeMinutes,
  formatTankPressure,
  formatWaterTempF,
} from "./format";

describe("formatElapsedClock", () => {
  it("matches mockup 02's zero-padded live display", () => {
    expect(formatElapsedClock(47_000)).toBe("00:47");
  });

  it("keeps a constant width past ten minutes", () => {
    // The reason this exists rather than reusing the Safe-Return helper:
    // DESIGN_SYSTEM.md §3 requires tabular figures so a changing number
    // doesn't re-flow the layout, and an unpadded minute field defeats that
    // the moment a recording crosses ten minutes.
    expect(formatElapsedClock(9 * 60_000 + 59_000)).toHaveLength(5);
    expect(formatElapsedClock(10 * 60_000)).toHaveLength(5);
  });

  it("floors rather than rounds, so the clock never shows time not yet elapsed", () => {
    expect(formatElapsedClock(1999)).toBe("00:01");
  });

  it("clamps negatives to zero", () => {
    expect(formatElapsedClock(-5000)).toBe("00:00");
  });
});

describe("formatRecordingSummary", () => {
  it("matches mockup 03's wording exactly", () => {
    expect(formatRecordingSummary(52_000)).toBe("0:52 recording");
  });
});

describe("formatDepthFt", () => {
  it("labels the unit, since the stored value is always feet", () => {
    expect(formatDepthFt(58)).toBe("58 ft");
  });

  it("shows an em dash rather than a zero for an unset value", () => {
    // A blank depth and a 0 ft depth are different claims.
    expect(formatDepthFt(null)).toBe("—");
  });
});

describe("formatRuntimeMinutes", () => {
  it("shows plain minutes under an hour", () => {
    expect(formatRuntimeMinutes(40)).toBe("40 min");
  });

  it("switches to hours and minutes past an hour", () => {
    expect(formatRuntimeMinutes(70)).toBe("1h 10m");
    expect(formatRuntimeMinutes(120)).toBe("2h");
  });

  it("shows an em dash for an unset value", () => {
    expect(formatRuntimeMinutes(null)).toBe("—");
  });
});

describe("formatTankPressure", () => {
  it("shows the full pair as a consumption arrow", () => {
    expect(formatTankPressure(3000, 500)).toBe("3000 → 500 psi");
  });

  it("states a half-known pair as one honest figure, not a padded pair", () => {
    // "3000 → — psi" reads as a recorded dive with an unreadable second
    // number. "3000 psi in" says plainly that one figure is all there is.
    expect(formatTankPressure(3000, null)).toBe("3000 psi in");
    expect(formatTankPressure(null, 500)).toBe("500 psi out");
  });

  it("shows an em dash when neither half was recorded", () => {
    expect(formatTankPressure(null, null)).toBe("—");
  });
});

describe("formatWaterTempF", () => {
  it("labels the unit, since the stored value is always Fahrenheit", () => {
    expect(formatWaterTempF(64)).toBe("64°F");
  });

  it("shows an em dash rather than a zero for an unset value", () => {
    expect(formatWaterTempF(null)).toBe("—");
  });
});

describe("formatExposureSuit", () => {
  it("renders the option's own label rather than the raw enum value", () => {
    expect(formatExposureSuit("wetsuit")).toBe("Wetsuit");
    expect(formatExposureSuit("drysuit")).toBe("Drysuit");
    expect(formatExposureSuit("none")).toBe("None");
  });

  it("shows an em dash for an unset value", () => {
    // Distinct from "None", which is a diver saying they wore nothing.
    expect(formatExposureSuit(null)).toBe("—");
  });
});
