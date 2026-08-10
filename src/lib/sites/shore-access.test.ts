import { describe, expect, it } from "vitest";
import {
  classifyShoreAccess,
  SHORE_DIVE_EASY_MILES,
  SHORE_DIVE_MAX_MILES,
  SOUTH_FLORIDA_ENTRY_POINTS,
  type ShoreEntryPoint,
} from "./shore-access";

/**
 * The baseline these thresholds come from is a real, measured dive (see the
 * module header): the Datura Avenue entry at Lauderdale-by-the-Sea, with
 * Anglin's Pier Reef inshore edge at ~192 yd and seaward edge at ~429 yd.
 * These tests pin that baseline so a future threshold change has to
 * consciously break a named real-world case rather than quietly drift.
 */

const DATURA = { latitude: 26.1867, longitude: -80.09498 };
/** ~1 mile of longitude at this latitude ≈ 0.0155°. */
const MILE_LNG = 0.0155;

/** Places a point due east (seaward) of the Datura entry at a given distance. */
function seawardOfDatura(miles: number) {
  return { latitude: DATURA.latitude, longitude: DATURA.longitude + MILE_LNG * miles };
}

describe("classifyShoreAccess — the Lauderdale-by-the-Sea baseline", () => {
  // Distances corroborated by three independent sources (see module header):
  // the founder's own dive, published local dive guidance, and FWC's Unified
  // Reef Map habitat polygons. 1st reef 100-300 yd @ 12-20 ft; 2nd reef
  // 800-900 yd @ 30-50 ft.

  it("classifies the first reef (100 yd, the close end) as likely shore-accessible", () => {
    const result = classifyShoreAccess(seawardOfDatura(100 / 1760));
    expect(result.isShoreAccessible).toBe(true);
    expect(result.confidence).toBe("likely");
    expect(result.nearestEntry?.id).toBe("datura-ave-lbts");
  });

  it("still calls the far end of the first reef line (300 yd) 'likely'", () => {
    expect(classifyShoreAccess(seawardOfDatura(300 / 1760)).confidence).toBe("likely");
  });

  it("classifies the second reef (~880 yd) as shore-accessible — the case the threshold exists for", () => {
    // The founder dives this: first reef, out to the second, back to shore,
    // surfacing with ~1000 psi. If this ever returns false the threshold no
    // longer means what it claims to.
    expect(classifyShoreAccess(seawardOfDatura(880 / 1760)).isShoreAccessible).toBe(true);
  });

  it("calls the second reef 'marginal' — a 20-30 min surface swim, not a casual one", () => {
    expect(classifyShoreAccess(seawardOfDatura(880 / 1760)).confidence).toBe("marginal");
  });

  it("regression: a 440 yd cap would have excluded the second reef", () => {
    // An earlier version capped at 0.25 mi (~440 yd), taken from the seaward
    // edge of OSM's single Anglin's Pier Reef polygon — which only spans the
    // FIRST reef complex. That cap excluded the very dive it was derived from.
    expect(classifyShoreAccess(seawardOfDatura(600 / 1760)).isShoreAccessible).toBe(true);
  });

  it("still rejects a genuinely offshore site (1 mile)", () => {
    const result = classifyShoreAccess(seawardOfDatura(1));
    expect(result.isShoreAccessible).toBe(false);
    expect(result.confidence).toBe("unlikely");
  });

  it("does not stretch to the Intracoastal-shore mistake (982 yd)", () => {
    // Separate error, documented in the module header: measuring from the
    // wrong side of the barrier island put the first reef at 982 yd. That is
    // beyond even the corrected second-reef threshold, so it stays rejected.
    expect(classifyShoreAccess(seawardOfDatura(982 / 1760)).isShoreAccessible).toBe(false);
  });
});

describe("classifyShoreAccess — boundaries", () => {
  it("includes a site exactly at the max distance", () => {
    expect(classifyShoreAccess(seawardOfDatura(SHORE_DIVE_MAX_MILES)).isShoreAccessible).toBe(true);
  });

  it("treats a site exactly at the easy threshold as likely", () => {
    expect(classifyShoreAccess(seawardOfDatura(SHORE_DIVE_EASY_MILES)).confidence).toBe("likely");
  });

  it("reports the distance and which entry point was nearest", () => {
    const result = classifyShoreAccess(seawardOfDatura(0.1));
    expect(result.distanceMiles).toBeGreaterThan(0);
    expect(result.distanceMiles).toBeLessThan(SHORE_DIVE_MAX_MILES);
    expect(result.nearestEntry?.name).toContain("Datura");
  });
});

describe("classifyShoreAccess — honest negatives", () => {
  it("returns unlikely (not a crash) for an offshore wreck with no entry in range", () => {
    // Hydro Atlantic, ~135-175 ft, genuinely boat-only.
    const result = classifyShoreAccess({ latitude: 26.3, longitude: -80.02 });
    expect(result.isShoreAccessible).toBe(false);
    expect(result.nearestEntry).not.toBeNull();
    expect(result.distanceMiles).toBeGreaterThan(SHORE_DIVE_MAX_MILES);
  });

  it("returns a null nearest entry when no entry points are supplied at all", () => {
    // Distinguishable from "we checked and it's far" — the caller must be able
    // to tell "no data" apart from "out of range".
    const result = classifyShoreAccess(DATURA, []);
    expect(result.nearestEntry).toBeNull();
    expect(result.distanceMiles).toBeNull();
    expect(result.isShoreAccessible).toBe(false);
  });

  it("picks the nearest entry when several are in range", () => {
    const entries: ShoreEntryPoint[] = [
      { id: "far", name: "Far", latitude: 26.1867, longitude: -80.09498 + MILE_LNG * 0.2 },
      { id: "near", name: "Near", latitude: 26.1867, longitude: -80.09498 + MILE_LNG * 0.02 },
    ];
    const result = classifyShoreAccess(seawardOfDatura(0.03), entries);
    expect(result.nearestEntry?.id).toBe("near");
  });
});

describe("SOUTH_FLORIDA_ENTRY_POINTS", () => {
  it("has unique ids and plausible South Florida coordinates", () => {
    const ids = SOUTH_FLORIDA_ENTRY_POINTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SOUTH_FLORIDA_ENTRY_POINTS) {
      expect(e.latitude).toBeGreaterThan(25);
      expect(e.latitude).toBeLessThan(27.5);
      expect(e.longitude).toBeGreaterThan(-80.6);
      expect(e.longitude).toBeLessThan(-79.9);
    }
  });

  it("includes the Datura baseline entry the threshold is derived from", () => {
    expect(SOUTH_FLORIDA_ENTRY_POINTS.find((e) => e.id === "datura-ave-lbts")).toBeDefined();
  });
});

describe("classifyShoreAccess — South Beach / ReefLine 'Traffic Jam'", () => {
  it("classifies the underwater-highway installation as a shore dive from 5th Street", () => {
    // Real FWC record `Reefline - "Traffic Jam"` (20 ft) at its actual
    // catalogued coordinates — ~295 yd from the nearest Atlantic beach point,
    // inside the 440 yd LBTS baseline. It was invisible to this classifier
    // purely because no South Beach entry was catalogued: the intended
    // failure mode, since coverage grows by adding real entries, never by
    // loosening the distance threshold.
    const trafficJam = { latitude: 25.77299, longitude: -80.1271 };
    const result = classifyShoreAccess(trafficJam);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("south-beach-5th-st");
  });
});

describe("classifyShoreAccess — S.S. Inchulva / Delray Wreck", () => {
  it("classifies a real, well-documented shore dive that was previously unreachable", () => {
    // Founder-reported (2026-08-11): a real shore dive, independently
    // confirmed both by the founder's own research and this module's own
    // web research (two sources agreeing on ~150 yd / 15-25 ft), was
    // classified `unlikely` because the nearest catalogued entry at the
    // time (Red Reef Park, Boca Raton) was 10,913 yd (6.2 mi) away — the
    // correct "under-classify, don't guess" outcome for a genuine coverage
    // gap, not a bug. Real catalogued coordinates from `sites`.
    const delrayWreck = { latitude: 26.453632, longitude: -80.056344 };
    const result = classifyShoreAccess(delrayWreck);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("delray-municipal-beach");
    expect(result.confidence).toBe("likely");
  });
});

describe("classifyShoreAccess — Ocean Inlet Park, Boynton Beach", () => {
  it("classifies real 'Boynton Inlet' sites close to the jetty as shore-accessible", () => {
    // Found during the full-catalogue audit that added Delray: three real
    // FWC-imported sites near Ocean Inlet Park's jetty, previously
    // `unlikely` with no nearby entry catalogued.
    const mitigationSite = { latitude: 26.54383, longitude: -80.041833 };
    const result = classifyShoreAccess(mitigationSite);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("ocean-inlet-park-boynton");
  });

  it("correctly leaves a genuinely-farther site in the same named group as boat-access", () => {
    // "Boynton Inlet Step Reef North" — real coordinates, ~1425 yd from the
    // jetty. Adding a real entry must not manufacture shore access for
    // everything nearby that shares a name prefix; distance still governs.
    const stepReefNorth = { latitude: 26.55625, longitude: -80.0355 };
    const result = classifyShoreAccess(stepReefNorth);
    expect(result.isShoreAccessible).toBe(false);
  });
});

describe("classifyShoreAccess — Perry Street Rockpile, Dania Beach", () => {
  it("classifies a real, documented shore dive near a badly mis-geocoded existing entry", () => {
    // Founder-reported (2026-08-10), independently confirmed by two sources:
    // diverarchives.com (the reef itself) and scubastar.com ("begins 600
    // feet [200 yd] from the shore", entry "Perry St. Beach"). The site was
    // `unlikely` at 3546.5 yd purely because the nearest catalogued entry
    // (`mizell-johnson-dania`) was itself ~2 mi mis-located on the
    // Intracoastal side of the peninsula — the same bug class as the LBTS
    // Atlantic-vs-Intracoastal mistake this module's header documents. Real
    // catalogued coordinates from `sites`.
    const perryStreetRockpile = { latitude: 26.047315, longitude: -80.111686 };
    const result = classifyShoreAccess(perryStreetRockpile);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("perry-street-dania");
  });

  it("does not manufacture shore access for genuinely offshore Dania artificial reefs", () => {
    // "Tenneco Towers Deep" — a real, deep artificial reef in the same
    // catalogue cluster, ~2 mi out. Correcting the mis-located Mizell entry
    // must not sweep in sites that are actually far offshore.
    const tennecoTowersDeep = { latitude: 25.9815, longitude: -80.079967 };
    const result = classifyShoreAccess(tennecoTowersDeep);
    expect(result.isShoreAccessible).toBe(false);
  });
});
