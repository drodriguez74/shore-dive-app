import { describe, expect, it } from "vitest";
import {
  BAND_GAP_YARDS,
  DEPTH_STEP_FT,
  deriveReefBands,
  deriveReefBandsWithDepth,
  isPointInPolygon,
  isReefHabitat,
  sampleTransect,
  type DepthSample,
  type HabitatSample,
  type ReefPolygon,
} from "./reef-bands";

const ENTRY = { latitude: 26.1867, longitude: -80.09498 };
/** Degrees of longitude per yard at this latitude. Derived, not eyeballed:
 * one degree of longitude at 26.1867N is 2*pi*R*cos(lat)/360 = 62.00 mi with
 * the same earth radius `distanceMiles` uses, so 1 mi = 0.016128 deg. An
 * earlier hand-rounded 0.0155 made every fixture land ~4% short of its
 * intended distance, which showed up as off-by-a-few-yards assertions. */
const YD_LNG = 0.016128 / 1760;
const YD_LAT = 1 / (69.05 * 1760);

/** A habitat sample `yards` straight offshore (east), optionally offset
 * `alongShoreYd` north/south to exercise the cross-shore corridor. */
function sample(yards: number, habitatClass = "Pavement", alongShoreYd = 0): HabitatSample {
  return {
    latitude: ENTRY.latitude + alongShoreYd * YD_LAT,
    longitude: ENTRY.longitude + yards * YD_LNG,
    habitatClass,
  };
}

/** A depth reading `yards` straight offshore (east) — the depth counterpart
 * of `sample()`, for `deriveReefBandsWithDepth` tests. */
function depthSample(yards: number, depthFt: number | null, alongShoreYd = 0): DepthSample {
  return {
    latitude: ENTRY.latitude + alongShoreYd * YD_LAT,
    longitude: ENTRY.longitude + yards * YD_LNG,
    depthFt,
  };
}

describe("isReefHabitat", () => {
  it("accepts real Unified Reef Map hardbottom classes", () => {
    for (const c of ["Pavement", "Ridge", "Aggregate Reef", "Individual or Aggregated Patch Reef"]) {
      expect(isReefHabitat(c)).toBe(true);
    }
  });

  it("rejects sand — it is the gap between bands, not a destination", () => {
    expect(isReefHabitat("Unconsolidated Sediment")).toBe(false);
  });

  it("keeps scattered coral in sediment, which is still divable hardbottom", () => {
    expect(isReefHabitat("Scattered Coral/Rock in Unconsolidated Sediment")).toBe(true);
  });

  it("returns false rather than throwing on missing data", () => {
    expect(isReefHabitat(null)).toBe(false);
    expect(isReefHabitat("")).toBe(false);
  });
});

describe("deriveReefBands", () => {
  it("splits the LBTS profile into first and second reef across the sand gap", () => {
    // The founder-confirmed shape: hardbottom ~150 yd, a wide sand gap, then
    // reef again at ~700-800 yd. These must be two dive sites, not one.
    const bands = deriveReefBands(ENTRY, [
      sample(149, "Pavement"),
      sample(158, "Ridge"),
      sample(704, "Aggregate Reef"),
      sample(817, "Individual or Aggregated Patch Reef"),
    ]);
    expect(bands).toHaveLength(2);
    expect(bands[0].label).toBe("First Reef");
    expect(bands[0].nearestYards).toBe(149);
    expect(bands[1].label).toBe("Second Reef");
    expect(bands[1].nearestYards).toBe(704);
  });

  it("does not split a continuous reef line into separate sites", () => {
    const bands = deriveReefBands(ENTRY, [sample(150), sample(180), sample(210), sample(260)]);
    expect(bands).toHaveLength(1);
  });

  it("splits exactly on the gap threshold boundary", () => {
    const within = deriveReefBands(ENTRY, [sample(100), sample(100 + BAND_GAP_YARDS)]);
    expect(within).toHaveLength(1);
    const beyond = deriveReefBands(ENTRY, [sample(100), sample(100 + BAND_GAP_YARDS + 20)]);
    expect(beyond).toHaveLength(2);
  });

  it("ignores reef that is offshore of a different stretch of beach", () => {
    // The real bug this guards: reef tract polygons run for miles along-shore,
    // so without a cross-shore corridor their vertices fill every distance and
    // no gap is ever found. Here the 704 yd reef sits 2000 yd up the coast and
    // must not appear as a second band off THIS entry.
    const bands = deriveReefBands(ENTRY, [
      sample(149, "Pavement"),
      sample(158, "Ridge"),
      sample(704, "Aggregate Reef", 2000),
    ]);
    expect(bands).toHaveLength(1);
  });

  it("orders bands shore-outward and numbers them the way divers do", () => {
    const bands = deriveReefBands(ENTRY, [sample(1600), sample(200), sample(900)]);
    expect(bands.map((b) => b.label)).toEqual(["First Reef", "Second Reef", "Third Reef"]);
    expect(bands.map((b) => b.ordinal)).toEqual([1, 2, 3]);
  });

  it("reports the arrival point — the near edge, not a centroid", () => {
    // A diver swimming straight out arrives at the inshore edge; a polygon
    // centroid can sit far along-shore from the entry.
    const bands = deriveReefBands(ENTRY, [sample(300), sample(500)]);
    expect(bands[0].nearestYards).toBe(300);
    expect(bands[0].arrivalPoint.longitude).toBeCloseTo(ENTRY.longitude + 300 * YD_LNG, 5);
  });

  it("ranks habitat classes by how much of the band they make up", () => {
    const bands = deriveReefBands(ENTRY, [
      sample(200, "Ridge"),
      sample(210, "Pavement"),
      sample(220, "Pavement"),
    ]);
    expect(bands[0].habitatClasses[0]).toBe("Pavement");
    expect(bands[0].sampleCount).toBe(3);
  });

  it("returns an empty array when only sand is supplied, without inventing a band", () => {
    expect(deriveReefBands(ENTRY, [sample(200, "Unconsolidated Sediment")])).toEqual([]);
    expect(deriveReefBands(ENTRY, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Transect sampling (T21.20). Synthetic polygons only — no network.
// ---------------------------------------------------------------------

/** How far a synthetic habitat band runs north/south of the entry. Well past
 * anything a transect can reach, so along-shore extent never decides a test —
 * which is the whole point: real reef tract polygons are shaped like this, and
 * it is exactly why sampling their vertices failed. */
const BAND_HALF_LENGTH_YD = 3000;

function ringAt(fromYd: number, toYd: number, halfLengthYd = BAND_HALF_LENGTH_YD): number[][] {
  const west = ENTRY.longitude + fromYd * YD_LNG;
  const east = ENTRY.longitude + toYd * YD_LNG;
  const south = ENTRY.latitude - halfLengthYd * YD_LAT;
  const north = ENTRY.latitude + halfLengthYd * YD_LAT;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** A shore-parallel habitat band running `fromYd`-`toYd` offshore, optionally
 * with an enclosed hole (ArcGIS's representation of, say, a sand patch inside
 * a reef polygon). */
function habitatBand(
  fromYd: number,
  toYd: number,
  habitatClass: string,
  hole?: [number, number],
): ReefPolygon {
  const rings = [ringAt(fromYd, toYd)];
  if (hole) rings.push(ringAt(hole[0], hole[1]));
  return { habitatClass, rings };
}

describe("isPointInPolygon", () => {
  const square = [ringAt(100, 300)];

  it("detects a point inside the outer ring", () => {
    expect(isPointInPolygon(sample(200), square)).toBe(true);
  });

  it("rejects a point beyond the polygon", () => {
    expect(isPointInPolygon(sample(400), square)).toBe(false);
    expect(isPointInPolygon(sample(50), square)).toBe(false);
  });

  it("rejects a point inside a hole — the ring rule that a naive test gets wrong", () => {
    // ArcGIS returns holes as additional rings. "Inside any ring" would call
    // this reef; the even-odd rule across all rings correctly calls it not.
    const withHole = habitatBand(100, 900, "Pavement", [300, 700]).rings;
    expect(isPointInPolygon(sample(500), withHole)).toBe(false);
  });

  it("still detects points inside the outer ring but outside the hole", () => {
    const withHole = habitatBand(100, 900, "Pavement", [300, 700]).rings;
    expect(isPointInPolygon(sample(200), withHole)).toBe(true);
    expect(isPointInPolygon(sample(800), withHole)).toBe(true);
  });

  it("rejects a point along-shore of a band that has ended", () => {
    const shortBand = [ringAt(100, 300, 50)];
    expect(isPointInPolygon(sample(200, "Pavement", 500), shortBand)).toBe(false);
  });
});

describe("sampleTransect", () => {
  it("places each sample at its intended distance offshore", () => {
    const samples = sampleTransect(ENTRY, [habitatBand(0, 2000, "Pavement")], {
      stepYards: 500,
      maxYards: 1000,
    });
    // 0, 500, 1000 — the entry itself included, so the profile starts at the
    // water's edge rather than one step out.
    expect(samples).toHaveLength(3);
    expect(samples[1].longitude).toBeCloseTo(ENTRY.longitude + 500 * YD_LNG, 5);
    expect(samples[2].longitude).toBeCloseTo(ENTRY.longitude + 1000 * YD_LNG, 5);
  });

  it("omits steps that fall outside every polygon rather than calling them sand", () => {
    // Unmapped is not the same claim as "no reef here". Beyond the seaward
    // edge of the mapped tract there is simply nothing to report.
    const samples = sampleTransect(ENTRY, [habitatBand(90, 310, "Pavement")], { stepYards: 50 });
    expect(samples.every((s) => s.habitatClass === "Pavement")).toBe(true);
    expect(samples).toHaveLength(5); // 100, 150, 200, 250, 300 — nothing past 310
  });

  it("returns nothing when the transect never enters a polygon", () => {
    // Reef 2000 yd up the coast, directly offshore of a different beach.
    const upCoast: ReefPolygon = {
      habitatClass: "Aggregate Reef",
      rings: [
        [
          [ENTRY.longitude + 100 * YD_LNG, ENTRY.latitude + 1800 * YD_LAT],
          [ENTRY.longitude + 300 * YD_LNG, ENTRY.latitude + 1800 * YD_LAT],
          [ENTRY.longitude + 300 * YD_LNG, ENTRY.latitude + 2200 * YD_LAT],
          [ENTRY.longitude + 100 * YD_LNG, ENTRY.latitude + 2200 * YD_LAT],
          [ENTRY.longitude + 100 * YD_LNG, ENTRY.latitude + 1800 * YD_LAT],
        ],
      ],
    };
    expect(sampleTransect(ENTRY, [upCoast])).toEqual([]);
    expect(sampleTransect(ENTRY, [])).toEqual([]);
  });

  it("follows an explicit bearing rather than assuming east", () => {
    const northOnly = {
      habitatClass: "Ridge",
      rings: [
        [
          [ENTRY.longitude - 100 * YD_LNG, ENTRY.latitude + 100 * YD_LAT],
          [ENTRY.longitude + 100 * YD_LNG, ENTRY.latitude + 100 * YD_LAT],
          [ENTRY.longitude + 100 * YD_LNG, ENTRY.latitude + 300 * YD_LAT],
          [ENTRY.longitude - 100 * YD_LNG, ENTRY.latitude + 300 * YD_LAT],
          [ENTRY.longitude - 100 * YD_LNG, ENTRY.latitude + 100 * YD_LAT],
        ],
      ],
    };
    expect(sampleTransect(ENTRY, [northOnly])).toEqual([]);
    expect(sampleTransect(ENTRY, [northOnly], { bearingDegrees: 0 }).length).toBeGreaterThan(0);
  });

  it("prefers reef over sediment where polygons overlap", () => {
    const samples = sampleTransect(
      ENTRY,
      [habitatBand(0, 900, "Unconsolidated Sediment"), habitatBand(400, 500, "Aggregate Reef")],
      { stepYards: 25, maxYards: 900 },
    );
    const atOverlap = samples.filter(
      (s) => s.longitude > ENTRY.longitude + 425 * YD_LNG && s.longitude < ENTRY.longitude + 475 * YD_LNG,
    );
    expect(atOverlap.length).toBeGreaterThan(0);
    expect(atOverlap.every((s) => s.habitatClass === "Aggregate Reef")).toBe(true);
  });

  it("returns empty rather than looping forever on a non-positive step or range", () => {
    const polygons = [habitatBand(0, 2000, "Pavement")];
    expect(sampleTransect(ENTRY, polygons, { stepYards: 0 })).toEqual([]);
    expect(sampleTransect(ENTRY, polygons, { stepYards: -25 })).toEqual([]);
    expect(sampleTransect(ENTRY, polygons, { maxYards: 0 })).toEqual([]);
  });
});

describe("sampleTransect -> deriveReefBands", () => {
  it("recovers first and second reef from separate polygons", () => {
    const polygons = [
      habitatBand(140, 310, "Pavement"),
      habitatBand(310, 690, "Unconsolidated Sediment"),
      habitatBand(690, 910, "Aggregate Reef"),
    ];
    const bands = deriveReefBands(ENTRY, sampleTransect(ENTRY, polygons));
    expect(bands).toHaveLength(2);
    expect(bands[0].nearestYards).toBe(150);
    expect(bands[0].farthestYards).toBe(300);
    expect(bands[1].nearestYards).toBe(700);
    expect(bands[1].farthestYards).toBe(900);
  });

  it("recovers them across a hole in a single polygon", () => {
    // The failure mode the ring rule prevents: one reef polygon with an
    // enclosed sand channel. Treating "inside any ring" as habitat would
    // bridge the gap and merge two genuinely different dives into one.
    const bands = deriveReefBands(
      ENTRY,
      sampleTransect(ENTRY, [habitatBand(140, 910, "Pavement", [310, 690])]),
    );
    expect(bands).toHaveLength(2);
    expect(bands[0].nearestYards).toBe(150);
    expect(bands[1].nearestYards).toBe(700);
  });

  it("does not split a polygon that runs continuously offshore", () => {
    const bands = deriveReefBands(ENTRY, sampleTransect(ENTRY, [habitatBand(140, 910, "Ridge")]));
    expect(bands).toHaveLength(1);
    expect(bands[0].nearestYards).toBe(150);
    expect(bands[0].farthestYards).toBe(900);
  });

  it("is not fooled by a polygon whose vertices span every distance", () => {
    // The regression this whole change exists for. A single reef polygon
    // 140-310 yd offshore that runs miles along-shore has boundary vertices
    // at every distance from the entry out to thousands of yards; sampling
    // those vertices reported one enormous band. Sampling the transect
    // reports what is actually offshore of this entry.
    const alongShore = habitatBand(140, 310, "Pavement");
    const vertices: HabitatSample[] = alongShore.rings[0].map(([longitude, latitude]) => ({
      latitude,
      longitude,
      habitatClass: "Pavement",
    }));
    const fromVertices = deriveReefBands(ENTRY, vertices);
    const fromTransect = deriveReefBands(ENTRY, sampleTransect(ENTRY, [alongShore]));

    // Vertices produce nothing usable here (all four corners sit ~3000 yd
    // along-shore, outside the corridor); the transect resolves the real band.
    expect(fromVertices).toEqual([]);
    expect(fromTransect).toHaveLength(1);
    expect(fromTransect[0].nearestYards).toBe(150);
    expect(fromTransect[0].farthestYards).toBe(300);
  });
});

// ---------------------------------------------------------------------
// Depth-aware banding (T21.24). Synthetic depths shaped like the real,
// live-verified Datura Ave profile recorded in this module's "Resolved via
// bathymetry" header section — no network.
// ---------------------------------------------------------------------

describe("deriveReefBandsWithDepth", () => {
  it("splits a habitat-continuous band where depth jumps past DEPTH_STEP_FT — the Datura case", () => {
    // Dense samples every 25 yd, matching sampleTransect's real step, so no
    // consecutive gap ever exceeds BAND_GAP_YARDS: habitat alone reports this
    // as one band, which is the exact "Known Limitation" this feature exists
    // to fix — asserted below for contrast.
    const habitat: HabitatSample[] = [];
    const depths: DepthSample[] = [];
    for (let yards = 150; yards <= 1200; yards += 25) {
      habitat.push(sample(yards, yards < 825 ? "Ridge" : "Aggregate Reef"));
      // Shaped after the real, live-measured Datura profile (this module's
      // "Resolved via bathymetry" header): shallow through 800 yd, a step at
      // 800->825 yd (+8.6 ft live-measured), then deepening toward 41 ft.
      const depthFt = yards < 825 ? 15 : 25 + ((yards - 825) / (1200 - 825)) * 16;
      depths.push(depthSample(yards, depthFt));
    }

    expect(deriveReefBands(ENTRY, habitat)).toHaveLength(1);

    const bands = deriveReefBandsWithDepth(ENTRY, habitat, depths);
    expect(bands).toHaveLength(2);
    expect(bands[0].label).toBe("First Reef");
    expect(bands[0].nearestYards).toBe(150);
    expect(bands[0].farthestYards).toBe(800);
    expect(bands[0].depthFt).toEqual({ minFt: 15, maxFt: 15 });
    expect(bands[1].label).toBe("Second Reef");
    expect(bands[1].nearestYards).toBe(825);
    expect(bands[1].farthestYards).toBe(1200);
    expect(bands[1].depthFt?.minFt).toBe(25);
    expect(bands[1].depthFt?.maxFt).toBeCloseTo(41, 0);
  });

  it("does not split on a depth increase exactly at the threshold, only beyond it", () => {
    // Distances stay within BAND_GAP_YARDS (200) of each other so only the
    // depth pass is under test.
    const habitat = [sample(100, "Ridge"), sample(300, "Ridge")];

    const atThreshold = deriveReefBandsWithDepth(ENTRY, habitat, [
      depthSample(100, 10),
      depthSample(300, 10 + DEPTH_STEP_FT),
    ]);
    expect(atThreshold).toHaveLength(1);

    const beyondThreshold = deriveReefBandsWithDepth(ENTRY, habitat, [
      depthSample(100, 10),
      depthSample(300, 10 + DEPTH_STEP_FT + 0.1),
    ]);
    expect(beyondThreshold).toHaveLength(2);
  });

  it("never splits on a missing depth reading — absence is not evidence of a step", () => {
    const habitat = [sample(100, "Ridge"), sample(300, "Ridge"), sample(500, "Ridge")];
    // No depth data supplied at all.
    const bands = deriveReefBandsWithDepth(ENTRY, habitat, []);
    expect(bands).toHaveLength(1);
    expect(bands[0].depthFt).toBeUndefined();

    // Depth known on one side of a would-be jump but not the other.
    const partial = deriveReefBandsWithDepth(ENTRY, habitat, [
      depthSample(100, 10),
      depthSample(500, 40), // a huge jump, but not adjacent to a reading
    ]);
    expect(partial).toHaveLength(1);
    expect(partial[0].depthFt).toEqual({ minFt: 10, maxFt: 40 });
  });

  it("matches depth samples to habitat samples by recomputed distance, not array position", () => {
    const habitat = [sample(150, "Ridge"), sample(825, "Aggregate Reef")];
    // Depth samples supplied out of order and with an extra, unrelated point
    // — matching must be positionally independent.
    const depths = [
      depthSample(825, 23.0),
      depthSample(9999, 5), // far outside range; must not affect anything
      depthSample(150, 15.5),
    ];
    const bands = deriveReefBandsWithDepth(ENTRY, habitat, depths);
    expect(bands).toHaveLength(2);
    expect(bands[0].depthFt).toEqual({ minFt: 15.5, maxFt: 15.5 });
    expect(bands[1].depthFt).toEqual({ minFt: 23.0, maxFt: 23.0 });
  });

  it("still applies the cross-shore corridor filter, duplicated from deriveReefBands", () => {
    const habitat = [sample(150, "Ridge"), sample(825, "Aggregate Reef", 2000)];
    const depths = [depthSample(150, 15.5), depthSample(825, 23.0, 2000)];
    const bands = deriveReefBandsWithDepth(ENTRY, habitat, depths);
    expect(bands).toHaveLength(1);
    expect(bands[0].nearestYards).toBe(150);
  });

  it("a custom depthStepFt overrides the default", () => {
    const habitat = [sample(100, "Ridge"), sample(300, "Ridge")];
    const depths = [depthSample(100, 10), depthSample(300, 13)]; // 3 ft jump

    // Below the default threshold, no split.
    expect(deriveReefBandsWithDepth(ENTRY, habitat, depths)).toHaveLength(1);
    // A tighter custom threshold catches the same 3 ft jump.
    expect(deriveReefBandsWithDepth(ENTRY, habitat, depths, { depthStepFt: 2 })).toHaveLength(2);
  });

  it("returns an empty array when there is no reef habitat, same as deriveReefBands", () => {
    expect(deriveReefBandsWithDepth(ENTRY, [], [])).toEqual([]);
    expect(
      deriveReefBandsWithDepth(ENTRY, [sample(200, "Unconsolidated Sediment")], [depthSample(200, 20)]),
    ).toEqual([]);
  });

  it("leaves deriveReefBands itself untouched — depthFt is undefined on its output", () => {
    // Regression guard for the additive-only requirement: the pre-existing
    // function must never populate the new field.
    const bands = deriveReefBands(ENTRY, [
      sample(149, "Pavement"),
      sample(158, "Ridge"),
      sample(704, "Aggregate Reef"),
    ]);
    expect(bands.every((b) => b.depthFt === undefined)).toBe(true);
  });
});
