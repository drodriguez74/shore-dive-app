import { describe, expect, it } from "vitest";
import { resolveSiteDepthFt } from "./site-depth";

/**
 * Coverage for the depth-resolution fallback the site detail page depends on
 * (T21.22). The stakes here are the reason this module exists at all: the
 * output feeds `classifyDiveSuitability`, so a wrong number becomes a
 * certification judgement a diver might act on. Every case below is written
 * around one of two failure directions — inventing a depth that isn't there,
 * or losing one that is.
 */

/** Verbatim shape of what `buildOsmDescription()` in `./osm-import.ts` writes:
 * the source's own free text, then the ODbL attribution paragraph, then the
 * generated depth line, blank-line separated. Copied rather than imported so a
 * change to that format shows up here as a failing test rather than as two
 * modules quietly agreeing on something new. */
function osmDescription({ prose, depth }: { prose?: string; depth?: string }): string {
  return [
    prose,
    "Automatically imported from OpenStreetMap community map data (© OpenStreetMap contributors, licensed ODbL). " +
      "This entry has not been reviewed by a human — details may be incomplete or inaccurate. " +
      'Sourced under the OpenStreetMap name "Delray Wreck". Verify conditions independently before diving here.',
    depth ? `Reported depth: ${depth}.` : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

describe("resolveSiteDepthFt", () => {
  it("returns no depth for a null/undefined site", () => {
    expect(resolveSiteDepthFt(null)).toEqual({ minFt: null, maxFt: null, source: "none", rawText: null });
    expect(resolveSiteDepthFt(undefined)).toEqual({ minFt: null, maxFt: null, source: "none", rawText: null });
  });

  it("returns no depth for a site with neither columns nor a description", () => {
    expect(resolveSiteDepthFt({})).toEqual({ minFt: null, maxFt: null, source: "none", rawText: null });
    expect(resolveSiteDepthFt({ description: null })).toEqual({
      minFt: null,
      maxFt: null,
      source: "none",
      rawText: null,
    });
  });

  describe("depth columns (migration 0012 — not applied to the live DB yet)", () => {
    it("reads both bounds when present", () => {
      expect(resolveSiteDepthFt({ depth_min_ft: 15, depth_max_ft: 30 })).toEqual({
        minFt: 15,
        maxFt: 30,
        source: "column",
        rawText: null,
      });
    });

    it("coerces PostgREST numeric-as-string values", () => {
      expect(resolveSiteDepthFt({ depth_min_ft: "15", depth_max_ft: "30.5" })).toMatchObject({
        minFt: 15,
        maxFt: 30.5,
        source: "column",
      });
    });

    it("orders an inverted pair rather than trusting the column names", () => {
      // `classifyDiveSuitability` reads `minFt` as the *shallowest divable*
      // depth. An inverted row would otherwise classify the site by its
      // deepest point and wrongly push it out of recreational range.
      expect(resolveSiteDepthFt({ depth_min_ft: 90, depth_max_ft: 20 })).toMatchObject({
        minFt: 20,
        maxFt: 90,
      });
    });

    it("accepts a single bound", () => {
      expect(resolveSiteDepthFt({ depth_min_ft: 25 })).toMatchObject({ minFt: 25, maxFt: null, source: "column" });
      expect(resolveSiteDepthFt({ depth_max_ft: 25 })).toMatchObject({ minFt: null, maxFt: 25, source: "column" });
    });

    it.each([0, -10, NaN, Infinity, "not a number"])("rejects the unusable column value %p", (value) => {
      // A 0 ft / NaN "depth" is worse than no depth: it would silently
      // classify the site as Open Water.
      expect(resolveSiteDepthFt({ depth_min_ft: value, depth_max_ft: value })).toMatchObject({ source: "none" });
    });

    it("falls through to the description when the columns are unusable", () => {
      const site = { depth_min_ft: null, depth_max_ft: null, description: osmDescription({ depth: "25 feet" }) };
      expect(resolveSiteDepthFt(site)).toMatchObject({ minFt: 25, maxFt: 25, source: "description" });
    });

    it("prefers columns over the description when both exist", () => {
      const site = { depth_min_ft: 15, depth_max_ft: 30, description: osmDescription({ depth: "300 ft" }) };
      expect(resolveSiteDepthFt(site)).toMatchObject({ minFt: 15, maxFt: 30, source: "column" });
    });
  });

  describe("the imported 'Reported depth:' line", () => {
    it("parses a range and keeps the raw text for display", () => {
      expect(resolveSiteDepthFt({ description: osmDescription({ depth: "15-30 ft" }) })).toEqual({
        minFt: 15,
        maxFt: 30,
        source: "description",
        rawText: "15-30 ft",
      });
    });

    it("converts metric depths through parseDepthRangeFt", () => {
      expect(resolveSiteDepthFt({ description: osmDescription({ depth: "12m" }) })).toMatchObject({
        minFt: 39,
        maxFt: 39,
        source: "description",
      });
    });

    it("does NOT mine depths out of the source's own prose", () => {
      // The single most dangerous failure available to this module: real OSM
      // descriptions routinely mention depths in passing, and treating one as
      // a structured field would fabricate a certification judgement.
      const prose =
        "The old shipwreck known as the Delray Wreck rests at the bottom of the ocean in 25 feet of water " +
        "about 150 yards offshore.";
      expect(resolveSiteDepthFt({ description: osmDescription({ prose }) })).toMatchObject({
        source: "none",
        minFt: null,
        maxFt: null,
      });
    });

    it("still finds the depth line when prose above it mentions other numbers", () => {
      const prose = "Sits about 150 yards offshore in clear water; swim out from the lifeguard tower.";
      expect(resolveSiteDepthFt({ description: osmDescription({ prose, depth: "40 ft" }) })).toMatchObject({
        minFt: 40,
        maxFt: 40,
        source: "description",
      });
    });

    it("returns no depth when the reported text has no parseable number", () => {
      expect(resolveSiteDepthFt({ description: osmDescription({ depth: "varies with tide" }) })).toMatchObject({
        source: "none",
      });
    });

    it("tolerates a missing trailing period and surrounding whitespace", () => {
      expect(resolveSiteDepthFt({ description: "Reported depth: 60 ft  " })).toMatchObject({
        minFt: 60,
        source: "description",
        rawText: "60 ft",
      });
    });

    it("ignores a non-string description", () => {
      expect(resolveSiteDepthFt({ description: 42 as unknown as string })).toMatchObject({ source: "none" });
    });
  });
});
