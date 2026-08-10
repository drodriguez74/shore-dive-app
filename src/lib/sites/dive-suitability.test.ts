import { describe, expect, it } from "vitest";
import {
  classifyDiveSuitability,
  parseDepthRangeFt,
  OPEN_WATER_MAX_FT,
  RECREATIONAL_MAX_FT,
} from "./dive-suitability";

/** Depth values are the real ones from the aggregated South Florida
 * catalogue, so a threshold change has to consciously reclassify a named
 * site rather than quietly drift. */

describe("classifyDiveSuitability — real South Florida sites", () => {
  it("puts Copenhagen (15-30 ft) within Open Water", () => {
    const r = classifyDiveSuitability({ minFt: 15, maxFt: 30 });
    expect(r.minimumLevel).toBe("open_water");
    expect(r.withinRecreationalLimits).toBe(true);
  });

  it("puts Blue Heron Bridge (~20 ft, artificial) within Open Water — man-made is not disqualifying", () => {
    expect(classifyDiveSuitability({ minFt: 20, maxFt: 20 }).minimumLevel).toBe("open_water");
  });

  it("puts Jim Atria (95-132 ft) at Advanced Open Water by its shallowest point", () => {
    const r = classifyDiveSuitability({ minFt: 95, maxFt: 132 });
    expect(r.minimumLevel).toBe("advanced_open_water");
    expect(r.withinRecreationalLimits).toBe(true);
  });

  it("excludes Caicos Express (190-240 ft) as entirely beyond recreational limits", () => {
    const r = classifyDiveSuitability({ minFt: 190, maxFt: 240 });
    expect(r.entirelyBeyondRecreational).toBe(true);
    expect(r.withinRecreationalLimits).toBe(false);
  });

  it("keeps a deep wreck with a shallow deck (60-130 ft) — judged on shallowest, not max", () => {
    // Lady Luck: deck reachable well above the sand. Judging on max depth
    // alone would wrongly exclude a legitimate recreational dive.
    const r = classifyDiveSuitability({ minFt: 60, maxFt: 130 });
    expect(r.minimumLevel).toBe("open_water");
    expect(r.entirelyBeyondRecreational).toBe(false);
    expect(r.summary).toContain("reaches 130 ft");
  });
});

describe("classifyDiveSuitability — the 100-130 ft band", () => {
  it("does not label a still-recreational 110 ft site as beyond recreational limits", () => {
    // Regression: this level was originally named `beyond_recreational`, so a
    // 110 ft site reported minimumLevel "beyond_recreational" and
    // withinRecreationalLimits true in the same object, and carried the same
    // label as a 240 ft technical dive. Whether a site is past the limit is
    // `entirelyBeyondRecreational` — never the level.
    const r = classifyDiveSuitability({ minFt: 110, maxFt: 120 });
    expect(r.minimumLevel).toBe("deep_specialty");
    expect(r.withinRecreationalLimits).toBe(true);
    expect(r.entirelyBeyondRecreational).toBe(false);
  });

  it("distinguishes deep-specialty depth from a genuinely technical dive", () => {
    const deep = classifyDiveSuitability({ minFt: 110, maxFt: 120 });
    const technical = classifyDiveSuitability({ minFt: 190, maxFt: 240 });
    expect(deep.entirelyBeyondRecreational).not.toBe(technical.entirelyBeyondRecreational);
  });
});

describe("classifyDiveSuitability — boundaries and unknowns", () => {
  it("treats exactly 60 ft as Open Water", () => {
    expect(classifyDiveSuitability({ minFt: OPEN_WATER_MAX_FT, maxFt: OPEN_WATER_MAX_FT }).minimumLevel).toBe(
      "open_water",
    );
  });

  it("treats exactly 130 ft as still within recreational limits", () => {
    const r = classifyDiveSuitability({ minFt: RECREATIONAL_MAX_FT, maxFt: RECREATIONAL_MAX_FT });
    expect(r.entirelyBeyondRecreational).toBe(false);
  });

  it("treats unknown depth as permissive-but-flagged, never as a level", () => {
    // Most catalogue rows have no depth. Treating unknown as "too deep" would
    // hide real shore dives; inventing a level would fabricate safety data.
    const r = classifyDiveSuitability({ minFt: null, maxFt: null });
    expect(r.minimumLevel).toBeNull();
    expect(r.withinRecreationalLimits).toBe(true);
    expect(r.summary).toContain("not recorded");
  });

  it("copes with only one bound known", () => {
    expect(classifyDiveSuitability({ minFt: null, maxFt: 45 }).minimumLevel).toBe("open_water");
  });
});

describe("parseDepthRangeFt — the formats these catalogues actually ship", () => {
  it("parses an operator range", () => {
    expect(parseDepthRangeFt("15-30 ft")).toEqual({ minFt: 15, maxFt: 30 });
  });

  it("parses an en-dash range", () => {
    expect(parseDepthRangeFt("135 – 175")).toEqual({ minFt: 135, maxFt: 175 });
  });

  it("parses a single OSM-style value", () => {
    expect(parseDepthRangeFt("25 feet")).toEqual({ minFt: 25, maxFt: 25 });
  });

  it("converts metres to feet", () => {
    expect(parseDepthRangeFt("12m")).toEqual({ minFt: 39, maxFt: 39 });
  });

  it("does not treat a foot-marked value as metric", () => {
    expect(parseDepthRangeFt("30 ft")).toEqual({ minFt: 30, maxFt: 30 });
  });

  it("takes a numeric FWC depth directly", () => {
    expect(parseDepthRangeFt(43)).toEqual({ minFt: 43, maxFt: 43 });
  });

  it("returns nulls rather than guessing on junk", () => {
    // A wrong depth is worse than none — it feeds a suitability judgement.
    expect(parseDepthRangeFt("varies")).toEqual({ minFt: null, maxFt: null });
    expect(parseDepthRangeFt(null)).toEqual({ minFt: null, maxFt: null });
    expect(parseDepthRangeFt(0)).toEqual({ minFt: null, maxFt: null });
  });

  it("normalizes a reversed range", () => {
    expect(parseDepthRangeFt("30-15 ft")).toEqual({ minFt: 15, maxFt: 30 });
  });
});
