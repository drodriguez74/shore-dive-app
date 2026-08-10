import { describe, expect, it } from "vitest";
import { classifyDiveDifficulty } from "./dive-difficulty";

/** Real sites in the imported catalogue, so a change here has to consciously
 * reclassify a named place rather than quietly drift. */

const DATURA_FIRST_REEF = { latitude: 26.1867, longitude: -80.09406 }; // ~100 yd off Datura — "likely"
const DATURA_SECOND_REEF = { latitude: 26.1867, longitude: -80.08948 }; // ~600 yd off Datura — "marginal"
const FAR_OFFSHORE = { latitude: 25.9, longitude: -79.9 }; // no catalogued entry nearby

describe("classifyDiveDifficulty — depth alone", () => {
  it("calls a shallow reef beginner", () => {
    // Copenhagen, 15-30 ft — nowhere near any shore entry, so this isolates
    // the depth axis.
    const r = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 15, maxFt: 30 }, "shipwreck");
    expect(r.level).toBe("beginner");
    expect(r.riskScore).toBeLessThanOrEqual(1);
  });

  it("calls an Advanced-Open-Water-depth wreck intermediate", () => {
    // A wreck whose deck sits at 70-95 ft.
    const r = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 70, maxFt: 95 }, "shipwreck");
    expect(r.level).toBe("intermediate");
  });

  it("calls a deep-specialty-band wreck advanced", () => {
    // Deck at 105-132 ft: shallowest point is past the 100 ft Advanced Open
    // Water threshold, landing in the 100-130 ft deep-specialty band.
    const r = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 105, maxFt: 132 }, "shipwreck");
    expect(r.level).toBe("advanced");
  });

  it("calls Caicos Express (190-240 ft) technical, regardless of anything else", () => {
    const r = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 190, maxFt: 240 }, "shipwreck");
    expect(r.level).toBe("technical");
    expect(r.riskScore).toBe(5);
  });
});

describe("classifyDiveDifficulty — cave overrides everything", () => {
  it("calls a cave technical even at a shallow, easy-entry depth", () => {
    // The case this module exists to get right: easy entry must never imply
    // easy dive. A hypothetical 20 ft cave entrance.
    const r = classifyDiveDifficulty(DATURA_FIRST_REEF, { minFt: 20, maxFt: 20 }, "cave");
    expect(r.level).toBe("technical");
    expect(r.riskScore).toBe(5);
    expect(r.riskFactors.join(" ")).toMatch(/cave certification/i);
  });

  it("calls a cave technical with no depth data at all", () => {
    // Eagle's Nest, as actually imported: site_type "cave", no depth on file.
    const r = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: null, maxFt: null }, "cave");
    expect(r.level).toBe("technical");
  });
});

describe("classifyDiveDifficulty — springs (cavern) without depth", () => {
  it("still returns a level for a spring with cavern risk but no depth on file", () => {
    // Real state of the imported springs: site_type "spring", depth null.
    // Cavern presence alone is signal enough to say something.
    const r = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: null, maxFt: null }, "spring");
    expect(r.level).not.toBeNull();
    expect(r.riskFactors.join(" ")).toMatch(/cavern/i);
  });

  it("bumps a shallow spring above pure-depth beginner because of the cavern", () => {
    const withCavern = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 20, maxFt: 20 }, "spring");
    const withoutCavern = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 20, maxFt: 20 }, "shipwreck");
    expect(withCavern.riskScore).toBeGreaterThan(withoutCavern.riskScore);
  });
});

describe("classifyDiveDifficulty — shore swim distance", () => {
  it("does not penalize an easy, close shore entry", () => {
    const close = classifyDiveDifficulty(DATURA_FIRST_REEF, { minFt: 15, maxFt: 20 }, "shore_reef");
    expect(close.riskFactors.some((f) => /swim/i.test(f))).toBe(false);
  });

  it("adds a factor for a marginal (long) shore swim at the same depth", () => {
    const near = classifyDiveDifficulty(DATURA_FIRST_REEF, { minFt: 30, maxFt: 50 }, "shore_reef");
    const far = classifyDiveDifficulty(DATURA_SECOND_REEF, { minFt: 30, maxFt: 50 }, "shore_reef");
    expect(far.riskScore).toBeGreaterThanOrEqual(near.riskScore);
    expect(far.riskFactors.some((f) => /swim/i.test(f))).toBe(true);
  });
});

describe("classifyDiveDifficulty — honest unknowns", () => {
  it("returns null, not a guessed level, with no depth and no overhead signal", () => {
    const r = classifyDiveDifficulty(FAR_OFFSHORE, { minFt: null, maxFt: null }, "shipwreck");
    expect(r.level).toBeNull();
    expect(r.riskScore).toBe(0);
    expect(r.riskFactors).toEqual([]);
  });

  it("never returns an empty factor list alongside a real level", () => {
    // A level with no visible reasoning is exactly what this module exists to
    // prevent — check every non-null-level case in this file carries factors.
    const cases = [
      classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 15, maxFt: 30 }, "shipwreck"),
      classifyDiveDifficulty(FAR_OFFSHORE, { minFt: 190, maxFt: 240 }, "shipwreck"),
      classifyDiveDifficulty(FAR_OFFSHORE, { minFt: null, maxFt: null }, "cave"),
    ];
    for (const r of cases) {
      expect(r.level).not.toBeNull();
      expect(r.riskFactors.length).toBeGreaterThan(0);
    }
  });

  it("caps risk score at 5 even when multiple factors stack", () => {
    const r = classifyDiveDifficulty(DATURA_SECOND_REEF, { minFt: 95, maxFt: 132 }, "spring");
    expect(r.riskScore).toBeLessThanOrEqual(5);
  });
});
