import { describe, expect, it } from "vitest";
import { classifyWaterAccess, usesCoastalDistanceModel } from "./water-access";

/**
 * The sites named here are real OSM records returned by the Florida
 * freshwater survey, so a change to this logic has to consciously
 * reclassify a named, real place.
 */

describe("classifyWaterAccess — springs are walk-in", () => {
  it("treats a spring as walk-in, no boat", () => {
    // Ginnie Springs, Blue Grotto, Troy, Rainbow, Vortex, Morrison...
    const a = classifyWaterAccess("spring");
    expect(a.isWalkIn).toBe(true);
    expect(a.accessType).toBe("walk_in");
  });

  it("exempts springs from the coastal-distance model", () => {
    // The bug this fixes: every Florida spring scored `unlikely` shore access
    // because the nearest catalogued ocean entry is ~100 miles away — an
    // artifact of the model, not a fact about the site.
    expect(usesCoastalDistanceModel("spring")).toBe(false);
    expect(usesCoastalDistanceModel("cave")).toBe(false);
  });

  it("still applies the coastal model to reefs and wrecks", () => {
    expect(usesCoastalDistanceModel("shore_reef")).toBe(true);
    expect(usesCoastalDistanceModel("shipwreck")).toBe(true);
    expect(usesCoastalDistanceModel("artificial_reef")).toBe(true);
    expect(usesCoastalDistanceModel(null)).toBe(true);
  });
});

describe("classifyWaterAccess — overhead environments", () => {
  it("never reports easy entry for a cave without an overhead warning", () => {
    // Eagle's Nest is a ~300 ft cave system with multiple fatalities, entered
    // by walking down a slope. Easy entry and safe dive are unrelated, and
    // surfacing the first without the second would be an invitation.
    const cave = classifyWaterAccess("cave");
    expect(cave.isWalkIn).toBe(true);
    expect(cave.overheadWarning).not.toBeNull();
    expect(cave.overhead).toBe("cave");
  });

  it("states plainly that open-water certification does not qualify a cave diver", () => {
    const warning = classifyWaterAccess("cave").overheadWarning!;
    expect(warning).toMatch(/cave certification/i);
    expect(warning).toMatch(/Open Water and Advanced Open Water certification\s+do not qualify/i);
  });

  it("warns on springs too — Florida springs usually have a cavern at the vent", () => {
    const spring = classifyWaterAccess("spring");
    expect(spring.overhead).toBe("cavern");
    expect(spring.overheadWarning).toMatch(/cavern/i);
  });

  it("distinguishes cavern from cave rather than flattening them", () => {
    // Training agencies treat these as different qualifications; the data
    // should not erase the distinction.
    expect(classifyWaterAccess("spring").overhead).not.toBe(classifyWaterAccess("cave").overhead);
  });

  it("carries no overhead warning for open-water site types", () => {
    for (const t of ["shore_reef", "shipwreck", "artificial_reef", "unclassified"] as const) {
      expect(classifyWaterAccess(t).overheadWarning).toBeNull();
      expect(classifyWaterAccess(t).overhead).toBe("none");
    }
  });

  it("does not claim walk-in access for a site type it cannot determine", () => {
    const unknown = classifyWaterAccess(null);
    expect(unknown.isWalkIn).toBe(false);
    expect(unknown.accessType).toBe("unknown");
  });
});
