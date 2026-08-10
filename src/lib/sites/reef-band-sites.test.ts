import { describe, expect, it } from "vitest";
import { buildReefBandSiteCandidates } from "./reef-band-sites";
import { SHORE_DIVE_EASY_MILES, SHORE_DIVE_MAX_MILES, type ShoreEntryPoint } from "./shore-access";
import type { ReefBand } from "./reef-bands";

/** Same derivation `reef-bands.test.ts` uses: degrees per yard at ~26N, so
 * fixtures can be placed at known offshore distances without eyeballing. */
const YD_LNG = 0.016128 / 1760;

const DATURA: ShoreEntryPoint = {
  id: "datura-ave-lbts",
  name: "Datura Avenue, Lauderdale-by-the-Sea",
  latitude: 26.1867,
  longitude: -80.09498,
  note: "Tank rack on site.",
};

const VISTAMAR: ShoreEntryPoint = {
  id: "vistamar-fort-lauderdale",
  name: "Vistamar Street, Fort Lauderdale",
  latitude: 26.13374,
  longitude: -80.10271,
};

/** A synthetic `ReefBand` `yards` straight offshore of `entry`, matching the
 * shape `deriveReefBands` actually returns (not a real derivation — this
 * module doesn't need one to be exercised in isolation). */
function band(
  entry: ShoreEntryPoint,
  ordinal: number,
  nearestYards: number,
  farthestYards: number,
  habitatClasses: string[] = ["Pavement"],
): ReefBand {
  return {
    ordinal,
    label: ordinal === 1 ? "First Reef" : ordinal === 2 ? "Second Reef" : `Reef ${ordinal}`,
    nearestYards,
    farthestYards,
    arrivalPoint: {
      latitude: entry.latitude,
      longitude: entry.longitude + nearestYards * YD_LNG,
    },
    habitatClasses,
    sampleCount: Math.max(1, Math.round((farthestYards - nearestYards) / 25)),
  };
}

describe("buildReefBandSiteCandidates", () => {
  it("returns an empty array for an entry with no derived reef", () => {
    expect(buildReefBandSiteCandidates(VISTAMAR, [])).toEqual([]);
  });

  it("builds a candidate per band, in the order given, following the ordinal label convention", () => {
    const bands = [band(VISTAMAR, 1, 129, 300), band(VISTAMAR, 2, 900, 950)];
    const candidates = buildReefBandSiteCandidates(VISTAMAR, bands);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe("First Reef off Vistamar Street");
    expect(candidates[1].name).toBe("Second Reef off Vistamar Street");
  });

  it("always tags candidates COMMUNITY and shore_reef, never VERIFIED", () => {
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [band(VISTAMAR, 1, 129, 300)]);
    expect(candidates[0].provenance).toBe("COMMUNITY");
    expect(candidates[0].site_type).toBe("shore_reef");
  });

  it("never assigns a legal_access_status — URM carries no such data", () => {
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [band(VISTAMAR, 1, 129, 300)]);
    expect(candidates[0].legal_access_status).toBeNull();
  });

  it("places the candidate at the band's arrival point, not the entry", () => {
    const b = band(VISTAMAR, 1, 129, 300);
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [b]);
    expect(candidates[0].latitude).toBe(b.arrivalPoint.latitude);
    expect(candidates[0].longitude).toBe(b.arrivalPoint.longitude);
  });

  it("discloses the derivation in the description — never presents this as a verified site", () => {
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [band(VISTAMAR, 1, 129, 300, ["Pavement", "Ridge"])]);
    const { description } = candidates[0];
    expect(description).toContain("not a named, individually verified dive site");
    expect(description).toContain("nobody has dived or verified");
    expect(description).toContain("Unified Reef Map");
    expect(description).toContain("Vistamar Street, Fort Lauderdale");
    expect(description).toContain("Pavement, Ridge");
    expect(description).not.toMatch(/shore dive: confirmed/i);
  });

  it("carries the entry's note into the description when present", () => {
    const candidates = buildReefBandSiteCandidates(DATURA, [band(DATURA, 1, 150, 300)]);
    expect(candidates[0].description).toContain("Tank rack on site.");
  });

  it("omits an entry-note line entirely when the entry has none", () => {
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [band(VISTAMAR, 1, 129, 300)]);
    expect(candidates[0].description).not.toContain("Shore entry note:");
  });

  // -----------------------------------------------------------------
  // Depth: the Datura exception, and only the Datura exception.
  // -----------------------------------------------------------------

  it("leaves depth null for a non-Datura entry, even with a plausible two-band split", () => {
    const bands = [band(VISTAMAR, 1, 129, 300), band(VISTAMAR, 2, 900, 950)];
    const candidates = buildReefBandSiteCandidates(VISTAMAR, bands);
    for (const c of candidates) {
      expect(c.depth_min_ft).toBeNull();
      expect(c.depth_max_ft).toBeNull();
    }
  });

  it("assigns the published first/second reef depths at Datura when there are exactly two bands", () => {
    const bands = [band(DATURA, 1, 150, 300), band(DATURA, 2, 700, 900)];
    const candidates = buildReefBandSiteCandidates(DATURA, bands);

    expect(candidates[0].depth_min_ft).toBe(12);
    expect(candidates[0].depth_max_ft).toBe(20);
    expect(candidates[1].depth_min_ft).toBe(30);
    expect(candidates[1].depth_max_ft).toBe(50);
    expect(candidates[0].description).toContain("12-20 ft");
    expect(candidates[1].description).toContain("30-50 ft");
  });

  it("does NOT force a depth split when Datura only produces one merged band", () => {
    // The documented, currently-live reality (reef-bands.ts's "Known
    // limitation"): the URM maps 175-1200 yd at Datura as one band. Forcing
    // a two-way depth split onto it would be exactly the fabrication this
    // module's header warns against.
    const candidates = buildReefBandSiteCandidates(DATURA, [band(DATURA, 1, 175, 1200)]);
    expect(candidates[0].depth_min_ft).toBeNull();
    expect(candidates[0].depth_max_ft).toBeNull();
    expect(candidates[0].description).toContain("Depth not recorded");
  });

  it("does not guess at a depth split for an unexpected 3+ band Datura result either", () => {
    const bands = [band(DATURA, 1, 150, 300), band(DATURA, 2, 700, 900), band(DATURA, 3, 1400, 1700)];
    const candidates = buildReefBandSiteCandidates(DATURA, bands);
    for (const c of candidates) {
      expect(c.depth_min_ft).toBeNull();
      expect(c.depth_max_ft).toBeNull();
    }
  });

  // -----------------------------------------------------------------
  // Shore access — reused from shore-access.ts, scoped to this entry only.
  // -----------------------------------------------------------------

  it("classifies a band inside SHORE_DIVE_EASY_MILES as likely", () => {
    const easyYards = Math.round(SHORE_DIVE_EASY_MILES * 1760) - 20;
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [band(VISTAMAR, 1, easyYards, easyYards + 20)]);
    expect(candidates[0].shore_access).toBe("likely");
  });

  it("classifies a band between easy and max distance as marginal", () => {
    const marginalYards = Math.round((SHORE_DIVE_EASY_MILES + SHORE_DIVE_MAX_MILES) / 2 * 1760);
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [band(VISTAMAR, 1, marginalYards, marginalYards + 20)]);
    expect(candidates[0].shore_access).toBe("marginal");
  });

  it("still produces a candidate, honestly tagged unlikely, for a band beyond SHORE_DIVE_MAX_MILES", () => {
    const farYards = Math.round(SHORE_DIVE_MAX_MILES * 1760) + 500;
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [band(VISTAMAR, 1, farYards, farYards + 20)]);
    expect(candidates[0].shore_access).toBe("unlikely");
    expect(candidates[0].name).toContain("First Reef");
  });

  it("attributes shore_entry_id/shore_distance_yards to the originating entry, not some other nearer entry", () => {
    // Regression guard for the "unscoped classifyShoreAccess" failure mode
    // this module's header calls out explicitly: a band derived from
    // Vistamar must never resolve its nearest entry to Datura (which sits
    // close by), even though Datura is a real, closer-by-coincidence entry
    // for some coordinates.
    const b = band(VISTAMAR, 1, 129, 300);
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [b]);
    expect(candidates[0].shore_entry_id).toBe("vistamar-fort-lauderdale");
    expect(candidates[0].shore_distance_yards).toBe(129);
  });

  it("carries band metadata through for dedupe/reporting callers", () => {
    const b = band(VISTAMAR, 2, 900, 950, ["Aggregate Reef"]);
    const candidates = buildReefBandSiteCandidates(VISTAMAR, [b]);
    expect(candidates[0]).toMatchObject({
      entryId: "vistamar-fort-lauderdale",
      entryName: "Vistamar Street, Fort Lauderdale",
      bandOrdinal: 2,
      bandLabel: "Second Reef",
      nearestYards: 900,
      farthestYards: 950,
      habitatClasses: ["Aggregate Reef"],
    });
  });

  describe("measured depth (T21.24 bathymetry, preferred over the Datura literature fallback)", () => {
    it("uses band.depthFt when present, for any entry — not just Datura", () => {
      const b = { ...band(VISTAMAR, 1, 150, 525), depthFt: { minFt: 9, maxFt: 19 } };
      const candidates = buildReefBandSiteCandidates(VISTAMAR, [b]);
      expect(candidates[0].depth_min_ft).toBe(9);
      expect(candidates[0].depth_max_ft).toBe(19);
      expect(candidates[0].description).toMatch(/measured along this same transect/);
      expect(candidates[0].description).not.toMatch(/Published local guidance/);
    });

    it("prefers a measured depth over the Datura literature depths when both could apply", () => {
      // Real regression risk: Datura's own two-band split now has bathymetry
      // coverage, so its measured 9.6-19.3 ft (T21.24's actual live numbers)
      // must win over the pinned 12-20 ft literature citation, not the
      // reverse — a real sounding is a stronger claim than a citation.
      const b1 = { ...band(DATURA, 1, 175, 800), depthFt: { minFt: 9.6, maxFt: 19.3 } };
      const b2 = { ...band(DATURA, 2, 825, 1200), depthFt: { minFt: 20.4, maxFt: 41.1 } };
      const candidates = buildReefBandSiteCandidates(DATURA, [b1, b2]);
      expect(candidates[0].depth_min_ft).toBe(9.6);
      expect(candidates[0].depth_max_ft).toBe(19.3);
      expect(candidates[1].depth_min_ft).toBe(20.4);
      expect(candidates[1].depth_max_ft).toBe(41.1);
    });

    it("falls back to the Datura literature depths when depthFt is absent (bathymetry outage)", () => {
      const b1 = band(DATURA, 1, 175, 300);
      const b2 = band(DATURA, 2, 700, 900);
      const candidates = buildReefBandSiteCandidates(DATURA, [b1, b2]);
      expect(candidates[0].depth_min_ft).toBe(12);
      expect(candidates[0].depth_max_ft).toBe(20);
      expect(candidates[1].depth_min_ft).toBe(30);
      expect(candidates[1].depth_max_ft).toBe(50);
      expect(candidates[0].description).toMatch(/Published local guidance/);
    });

    it("treats a depthFt with only one non-null bound as measured, not absent", () => {
      const b = { ...band(VISTAMAR, 1, 150, 525), depthFt: { minFt: 15, maxFt: null } };
      const candidates = buildReefBandSiteCandidates(VISTAMAR, [b]);
      expect(candidates[0].depth_min_ft).toBe(15);
      expect(candidates[0].depth_max_ft).toBeNull();
    });

    it("stays null with an honest 'no coverage' description when neither source applies", () => {
      const b = band(VISTAMAR, 3, 1725, 1850);
      const candidates = buildReefBandSiteCandidates(VISTAMAR, [b]);
      expect(candidates[0].depth_min_ft).toBeNull();
      expect(candidates[0].description).toMatch(/no bathymetry coverage and no documented local guidance/);
    });
  });
});
