/**
 * Deriving distinct dive sites from continuous reef habitat.
 *
 * Florida's Unified Reef Map (FWC) publishes benthic habitat as *polygons* —
 * `Pavement`, `Ridge`, `Aggregate Reef`, `Patch Reef` — not as dive sites. But
 * a diver doesn't dive a polygon; they pick an entry, swim out, and dive a
 * reef line at a particular distance and depth. Off a single entry there are
 * usually several such lines, and they are genuinely different dives.
 *
 * Lauderdale-by-the-Sea, measured from the Datura Avenue entry, is the worked
 * example (founder-confirmed 2026-08-09 that these should be two sites, not
 * one):
 *
 * - **First reef** — hardbottom at ~149-158 yd, 12-20 ft. Beginner-friendly,
 *   a 5-10 minute swim.
 * - *(a ~546 yd gap of sand)*
 * - **Second reef** — `Aggregate Reef` at ~704 yd, 30-50 ft. A 20-30 minute
 *   surface swim, better suited to more experienced divers.
 *
 * Same entry, same coastline, but different depth, different swim, different
 * gas planning, and a different answer to "should I dive this today". Merging
 * them into one "reef off Datura" record would flatten exactly the distinction
 * a diver needs.
 *
 * ## How the split is decided
 *
 * The reef tracts run shore-parallel, so distance-from-entry alone separates
 * them: cluster habitat by that distance and split wherever there's a run of
 * open sand wider than `BAND_GAP_YARDS`. That's 1-D clustering on a single
 * axis, deliberately — no spatial index, no k-means, no guessing at a cluster
 * count. The gaps are real physical features (sand channels between reef
 * lines), which is why a fixed gap threshold works here and would not work for
 * scattered point features.
 *
 * ## Where the samples come from: a cross-shore transect
 *
 * `sampleTransect` walks straight offshore from the entry at a fixed step and
 * asks, at each point, *which habitat polygon contains this point* — the same
 * profile a diver swims. `deriveReefBands` then clusters those samples.
 *
 * This replaced feeding it polygon **vertices** from the Unified Reef Map,
 * which was wrong in a way that mattered (T21.20). Vertices trace polygon
 * *boundaries*, so a single reef polygon running miles along-shore emits a
 * sample at nearly every distance from the entry and fills the very sand gaps
 * this module looks for. Live, before the fix: Datura Ave, LBTS collapsed to
 * one band of 149-1771 yd against ground truth of first reef ~150 yd, sand
 * gap, second reef ~700-880 yd; Vistamar collapsed to 129-1891 yd. South Beach
 * *did* return three plausible bands, but only because that stretch happens to
 * be mapped as several separate polygons — luck of the data, not method.
 *
 * A transect is exact instead: 80 point-in-polygon tests (25 yd out to 2000 yd)
 * against polygons already in memory. No spatial index, and none needed.
 *
 * ## Known limitation: LBTS's first and second reef do not separate
 *
 * Measured live 2026-08-09 with transect sampling, the Datura profile is
 * `Ridge` 175-275, sand 300-350, `Ridge` 375-450, sand 475, `Colonized
 * Pavement` 500-625, `Ridge` 650-800, patch reef 825-850, `Aggregate Reef`
 * 875-950, sand 975-1000, `Aggregate Reef` 1025-1200, sand to 1425, then
 * `Aggregate Reef` 1450-1700. Both founder-confirmed features are there at
 * the right distances — the first reef starting ~150-175 yd and the second at
 * ~650-800 yd — but **the Unified Reef Map maps the ground between them as
 * near-continuous hardbottom**, with sand channels only 25-150 yd wide. Every
 * one of those is narrower than `BAND_GAP_YARDS`, so this module reports
 * 175-1200 yd as a single band rather than two. The result is stable across
 * bearings 75-105, so it is what the data says, not an artifact of the
 * transect direction.
 *
 * The earlier claim of "a ~546 yd gap of sand" came from *vertex* sampling,
 * whose surviving samples happened to be two boundary clusters; the transect
 * shows there is no such gap along the URM's mapping. What actually separates
 * LBTS's first and second reef is **depth** (12-20 ft vs 30-50 ft), and this
 * layer carries no depth attribute — so no threshold on this dataset can
 * split them, and lowering `BAND_GAP_YARDS` to force it would shatter the
 * outer reef lines into six fragments instead. Separating them needs a
 * bathymetry input, which is a founder decision, not a threshold tweak. Until
 * then a merged first band is the honest answer, and anything rendering it
 * must not present "First Reef, 175-1200 yd" as one homogeneous dive.
 *
 * ## Resolved via bathymetry — T21.24
 *
 * The founder asked for this to be solved once free bathymetry became
 * available. NOAA publishes BAG multibeam mosaics and CUDEM as free, keyless
 * ArcGIS ImageServer coverage (`bathymetry-client.ts`) — the depth input the
 * Unified Reef Map itself doesn't carry. Live-sampled along the same
 * bearing-90 transect as the habitat profile above (25 yd steps, 0-1200 yd):
 * depth rises from the shoreline to ~15-19 ft through 175-800 yd (the first
 * reef range, matching the founder's 12-20 ft), then jumps sharply to
 * 20.4-23.0 ft over the single 800->825 yd step — **+8.6 ft in one 25 yd
 * step**, stable across bearings (+9.0 ft on bearing 75, +10.3 ft on bearing
 * 105, both breaking at the same 800-825/850 yd mark) — before continuing to
 * deepen to 29.6-41.1 ft by 1200 yd (the founder's "30-50 ft" second reef;
 * shallow side of that range near its inshore edge, but the right regime).
 * That depth step lands exactly where the habitat profile above changes from
 * `Ridge` to patch/`Aggregate Reef` (825 yd) — two independent datasets
 * agreeing on the same boundary, which is what makes this a real feature and
 * not depth manufacturing a split out of nothing.
 *
 * `deriveReefBandsWithDepth` (below, additive — `deriveReefBands` is
 * untouched) adds a second pass after the existing sand-gap split: within a
 * distance-merged group, split again wherever consecutive-by-distance
 * samples' depth increases by more than `DEPTH_STEP_FT`. That constant (7 ft)
 * was chosen the same way `BAND_GAP_YARDS` was — comfortably above the
 * largest false-positive step measured inside an already-correct band
 * (Vistamar's second band, 6.2 ft at 1025-1050 yd) and comfortably below the
 * real Datura break (8.6-10.3 ft across bearings 75/90/105). Run against live
 * data from all three known entries: Datura's merged 175-1200 yd band now
 * splits cleanly into 175-800 yd (9.6-19.3 ft) and 825-1200 yd
 * (20.4-41.1 ft); Vistamar's three already-correct bands
 * (150-525 / 875-1450 / 1725-1850 yd) and South Beach's two
 * (1050-1125 / 1725-1975 yd) come through **unchanged** — no spurious splits.
 * Datura's third band (1450-1975 yd, "third reef", already separated by a
 * sand gap) also splits further under this pass, into 1450-1675 yd
 * (42.0-54.0 ft) and 1700-1975 yd (69.1-72.3 ft) — a real, steep drop-off the
 * habitat/distance-only method had no way to see; not founder-confirmed
 * ground truth the way the first/second reef split is, so treat it as a
 * genuine finding worth checking in the field, not an established fact.
 *
 * A second, structural limitation of a single ray: habitat sitting *off* the
 * transect line is not reported. Off South Beach, small hardbottom patches lie
 * ~275-375 yd out on bearings 60 and 105 but not on 90, so the due-east
 * profile shows sand to 1025 yd. That is the correct answer to "what do I swim
 * over going straight out" and the wrong answer to "what is near this entry" —
 * do not use these bands for the latter.
 *
 * ## What these derived sites are, and are not
 *
 * They are **derived**, not catalogued. No source publishes "Second Reef off
 * Datura Avenue" as a named site with those coordinates — this module infers
 * it from habitat geometry plus an entry point. Anything written to `sites`
 * from here must therefore be `COMMUNITY` provenance with its derivation
 * disclosed, never `VERIFIED`, on the same reasoning that governs the OSM
 * import (see `osm-import.ts`): automated inference is not a human vouching
 * for a row.
 */

import { distanceMiles, type LatLng } from "./distance";
import type { DepthRangeFt } from "./dive-suitability";

/**
 * Half-width of the cross-shore corridor considered when deriving bands.
 *
 * This exists because of a real failure found on live data: reef tract
 * polygons run for *miles* along-shore, so their vertices occur at every
 * distance from the entry. Taking every vertex within a radius produced a
 * single band spanning 149-10,233 yd — the gaps were filled by reef far up
 * and down the coast, not by reef offshore of the entry. A diver swims
 * perpendicular to the beach, so only habitat roughly straight out from the
 * entry is relevant.
 *
 * **On the transect path this filter is inert, by construction, and that is
 * intentional** (T21.20). A transect *is* a corridor: every sample sits on a
 * single offshore ray, drifting less than a yard of latitude over 2000 yd at
 * Florida latitudes, so nothing it produces can ever be rejected by a 250 yd
 * corridor. It is kept rather than deleted because `deriveReefBands` accepts
 * an arbitrary `HabitatSample[]` and this is its only guard against a caller
 * handing it scattered points (polygon vertices, a raw radius query) — the
 * exact input shape that produced the 10,233 yd band. It is a precondition
 * check on untrusted input, not a second banding mechanism competing with the
 * transect.
 *
 * **Assumes a broadly north-south coastline**, which holds for Florida's
 * Atlantic coast (the entire scope of this dataset) — along-shore offset is
 * measured as latitude difference. `sampleTransect` takes an explicit
 * `bearingDegrees` and has no such assumption; if this is ever pointed at a
 * differently-oriented shore, that is the mechanism to use, and this filter
 * would need widening (or a caller-supplied override) rather than being
 * silently trusted.
 */
export const CORRIDOR_HALF_WIDTH_YARDS = 250;

/** A run of non-reef bottom at least this wide separates two dive sites.
 * Sized from the real LBTS gap (~546 yd of sand between first and second
 * reef) while staying comfortably wider than within-band variation there
 * (~9 yd). */
export const BAND_GAP_YARDS = 200;

/** Depth increase (feet) between two consecutive-by-distance samples large
 * enough to call it a real shelf break rather than seafloor noise —
 * `deriveReefBandsWithDepth`'s depth-analog of `BAND_GAP_YARDS`. Chosen the
 * same empirical way: comfortably above the largest single-step increase
 * measured inside an already-correct band on live data (Vistamar's second
 * band, 6.2 ft at 1025-1050 yd) and comfortably below the real break this
 * exists to find (Datura, 800-825 yd: 8.6 ft on bearing 90, 9.0-10.3 ft on
 * bearings 75/105). See this module's "Resolved via bathymetry" header
 * section for the full account, including why a *smaller* threshold would
 * risk shattering Vistamar's already-correct second band the same way an
 * over-tightened `BAND_GAP_YARDS` would shatter the outer reef lines. */
export const DEPTH_STEP_FT = 7;

/** Habitat classes that represent divable hardbottom. Sediment/sand is
 * excluded — it's what separates the bands, not a destination. */
const REEF_CLASSES = new Set([
  "Pavement",
  "Ridge",
  "Aggregate Reef",
  "Individual or Aggregated Patch Reef",
  "Aggregated Patch Reefs",
  "Individual Patch Reef",
  "Reef Rubble",
  "Rock Outcrop",
  "Scattered Coral/Rock in Unconsolidated Sediment",
]);

export function isReefHabitat(classLv1: string | null | undefined): boolean {
  if (!classLv1) return false;
  const c = classLv1.trim();
  if (/sediment/i.test(c) && !/scattered/i.test(c)) return false;
  return REEF_CLASSES.has(c) || /reef|pavement|ridge|rock/i.test(c);
}

export interface HabitatSample extends LatLng {
  /** `ClassLv1` from the Unified Reef Map. */
  habitatClass: string;
}

// ---------------------------------------------------------------------
// Cross-shore transect sampling
// ---------------------------------------------------------------------

/**
 * One benthic-habitat polygon, in the shape ArcGIS publishes it:
 * `rings[ring][vertex] = [longitude, latitude]`.
 *
 * The first ring is the outer boundary; later rings may be **holes** (a sand
 * patch enclosed by reef, most commonly). Both are kept — see
 * `isPointInPolygon` for why dropping them would over-report reef.
 * Populated by `fetchReefPolygons` (`urm-client.ts`); declared here so the
 * pure, testable half of this feature doesn't depend on the I/O half.
 */
export interface ReefPolygon {
  /** `ClassLv1` from the Unified Reef Map. */
  habitatClass: string;
  rings: number[][][];
}

/**
 * One depth reading along a transect, in the shape `bathymetry-client.ts`
 * produces it — declared here, not there, so the pure, testable half of this
 * feature doesn't depend on the I/O half (same reasoning as `ReefPolygon`
 * above, and the same reasoning `urm-client.ts`'s header explains for
 * habitat). Added T21.24, additive: nothing existing references this type.
 */
export interface DepthSample extends LatLng {
  /** Depth in feet, positive down. `null` means no bathymetry coverage at
   * this point — `NoData` from both NOAA services, or a point at/above the
   * MLLW datum (dry land, an exposed flat) — which is a real outcome, not a
   * failed lookup. `deriveReefBandsWithDepth` treats it as "no depth signal
   * here," never as zero or as a reason to reject the sample. */
  depthFt: number | null;
}

/** Must match `distanceMiles`'s earth radius — `sampleTransect` places a point
 * at a given distance and `deriveReefBands` measures that distance back, so a
 * mismatch would show up as samples landing off their intended yardage. */
const EARTH_RADIUS_MILES = 3958.8;
const YARDS_PER_MILE = 1760;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * The point `yards` from `origin` along `bearingDegrees` (0 = north, 90 =
 * east), on the same spherical earth model `distanceMiles` uses.
 */
function destinationPoint(origin: LatLng, bearingDegrees: number, yards: number): LatLng {
  const angularDistance = yards / YARDS_PER_MILE / EARTH_RADIUS_MILES;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.latitude);
  const lng1 = toRadians(origin.longitude);

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
  const lat2 = Math.asin(sinLat2);
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * sinLat2,
    );

  return { latitude: toDegrees(lat2), longitude: toDegrees(lng2) };
}

/**
 * Even-odd (ray-casting) point-in-polygon across **all** of a polygon's rings.
 *
 * The ring handling is the part that matters. ArcGIS returns the outer
 * boundary first and holes as subsequent rings, so the tempting "is the point
 * in any ring" test reports reef for a point sitting in a sand hole *inside* a
 * reef polygon. Counting crossings over every ring together fixes that for
 * free: a point inside a hole crosses the outer ring once and the hole ring
 * once, an even count, so it reads as outside. That is not a nicety here —
 * an unconsolidated-sediment hole between reef lines is exactly the gap this
 * feature splits dive sites on, and filling it in merges two dives into one.
 *
 * Points exactly on an edge are not specially handled; at a 25 yd sample step
 * against polygon edges given to ~0.1 m, that case is not reachable in
 * practice and giving it a defined answer would imply a precision this data
 * doesn't have.
 */
export function isPointInPolygon(point: LatLng, rings: number[][][]): boolean {
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;

  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      // Does the edge straddle the ray's latitude, and is the crossing east
      // of the point? `yj !== yi` is guaranteed by the straddle test, so the
      // division is safe.
      const straddles = yi > y !== yj > y;
      if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }

  return inside;
}

export interface TransectOptions {
  /** Offshore heading, 0 = north. Defaults to 90 (due east) — correct for
   * Florida's Atlantic coast, the whole scope of the Unified Reef Map. A
   * shore facing another way needs this set; it is not inferred. */
  bearingDegrees?: number;
  /** How far offshore to walk. Default 2000 yd — comfortably past the ~880 yd
   * outer edge of a plausible shore swim (`shore-access.ts`), so the profile
   * shows what's beyond the last reachable reef rather than stopping at it. */
  maxYards?: number;
  /** Spacing between samples. Default 25 yd, an order of magnitude finer than
   * `BAND_GAP_YARDS`, so a real gap can never be missed between two steps. */
  stepYards?: number;
}

const DEFAULT_BEARING_DEGREES = 90;
const DEFAULT_MAX_YARDS = 2000;
const DEFAULT_STEP_YARDS = 25;

/**
 * Walks straight offshore from `entry` and reports the habitat at each step —
 * the cross-shore profile a diver actually swims.
 *
 * Steps that fall outside every polygon are omitted rather than reported as
 * sand: unmapped is not the same claim as "there is no reef here", and the
 * Unified Reef Map's coverage does end (inshore of the first reef, and past
 * the seaward edge of the mapped tract). Since `deriveReefBands` treats any
 * run without reef as a gap, an omitted step and a sand step split bands
 * identically — the distinction only affects what gets *claimed*, which is
 * where it belongs.
 *
 * Where polygons overlap, a reef class wins over sediment. The Unified Reef
 * Map is broadly a partition, so this is rare; when it happens, a point
 * mapped as inside a specific hardbottom polygon is hardbottom, and taking
 * whichever polygon the service happened to list first would make the result
 * depend on response ordering.
 */
export function sampleTransect(
  entry: LatLng,
  polygons: ReefPolygon[],
  options: TransectOptions = {},
): HabitatSample[] {
  const {
    bearingDegrees = DEFAULT_BEARING_DEGREES,
    maxYards = DEFAULT_MAX_YARDS,
    stepYards = DEFAULT_STEP_YARDS,
  } = options;

  // A non-positive step would loop forever; a non-positive range has no
  // samples to give. Return empty rather than throwing — a caller that got
  // its options wrong should see "no profile", not a crash mid-derivation.
  if (!(stepYards > 0) || !(maxYards > 0)) return [];

  const samples: HabitatSample[] = [];

  for (let yards = 0; yards <= maxYards; yards += stepYards) {
    const point = yards === 0 ? entry : destinationPoint(entry, bearingDegrees, yards);

    let habitatClass: string | null = null;
    for (const polygon of polygons) {
      if (!isPointInPolygon(point, polygon.rings)) continue;
      if (habitatClass === null || (!isReefHabitat(habitatClass) && isReefHabitat(polygon.habitatClass))) {
        habitatClass = polygon.habitatClass;
      }
    }

    if (habitatClass !== null) {
      samples.push({ ...point, habitatClass });
    }
  }

  return samples;
}

export interface ReefBand {
  /** 1 = the reef line closest to shore. Matches how divers actually name
   * them ("first reef", "second reef"). */
  ordinal: number;
  /** Human label following local convention. */
  label: string;
  nearestYards: number;
  farthestYards: number;
  /** The point on this band closest to the entry — where a diver swimming
   * straight out would actually arrive, which is the useful coordinate for a
   * site record (not the polygon centroid, which can sit far along-shore). */
  arrivalPoint: LatLng;
  /** Distinct habitat classes contributing to this band, most-common first. */
  habitatClasses: string[];
  sampleCount: number;
  /**
   * Depth range in feet across this band's samples that had a bathymetry
   * reading. Added T21.24, optional and additive: only
   * `deriveReefBandsWithDepth` populates it — `deriveReefBands` never sets
   * this field, so every existing caller sees `undefined` exactly as before
   * this field existed. Also `undefined` when depth data was supplied but no
   * sample in this particular band had coverage — never fabricated from a
   * partial or empty set.
   */
  depthFt?: DepthRangeFt;
}

const ORDINAL_LABELS = ["First", "Second", "Third", "Fourth", "Fifth"];

function labelFor(ordinal: number): string {
  const word = ORDINAL_LABELS[ordinal - 1];
  return word ? `${word} Reef` : `Reef ${ordinal}`;
}

/**
 * Groups reef habitat samples offshore of `entry` into distinct reef lines.
 *
 * `samples` should come from `sampleTransect` — evenly spaced points along a
 * single offshore ray. Polygon vertices are **not** a valid substitute
 * (see this module's header): they trace boundaries rather than the profile,
 * and fill the gaps this function splits on. Non-reef habitat is filtered out
 * here rather than by the caller, so the sand gaps that define the band
 * boundaries can't be accidentally included.
 *
 * Returns bands ordered shore-outward. An empty result means no reef habitat
 * was supplied within range — not that the entry has no reef, which the caller
 * must not conflate (the query radius may simply have been too small).
 */
export function deriveReefBands(
  entry: LatLng,
  samples: HabitatSample[],
  corridorHalfWidthYards: number = CORRIDOR_HALF_WIDTH_YARDS,
): ReefBand[] {
  // ~1 degree of latitude is a constant ~1760*69.05 yards; used to reject
  // habitat that is offshore of some *other* stretch of beach.
  const YARDS_PER_DEGREE_LAT = 69.05 * 1760;

  const reef = samples
    .filter((s) => isReefHabitat(s.habitatClass))
    .filter(
      (s) => Math.abs(s.latitude - entry.latitude) * YARDS_PER_DEGREE_LAT <= corridorHalfWidthYards,
    )
    .map((s) => ({ ...s, yards: distanceMiles(entry, s) * 1760 }))
    .sort((a, b) => a.yards - b.yards);

  if (reef.length === 0) return [];

  // Split wherever consecutive samples are separated by more than the gap
  // threshold. Because the list is distance-sorted, one pass suffices.
  const groups: (typeof reef)[] = [[reef[0]]];
  for (let i = 1; i < reef.length; i++) {
    const gap = reef[i].yards - reef[i - 1].yards;
    if (gap > BAND_GAP_YARDS) groups.push([reef[i]]);
    else groups[groups.length - 1].push(reef[i]);
  }

  return groups.map((group, index) => {
    const counts = new Map<string, number>();
    for (const s of group) counts.set(s.habitatClass, (counts.get(s.habitatClass) ?? 0) + 1);
    const habitatClasses = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

    const closest = group[0];
    return {
      ordinal: index + 1,
      label: labelFor(index + 1),
      nearestYards: Math.round(group[0].yards),
      farthestYards: Math.round(group[group.length - 1].yards),
      arrivalPoint: { latitude: closest.latitude, longitude: closest.longitude },
      habitatClasses,
      sampleCount: group.length,
    };
  });
}

export interface DeriveReefBandsWithDepthOptions {
  corridorHalfWidthYards?: number;
  /** Overrides `DEPTH_STEP_FT`. Exposed for tests and for a future caller
   * tuning this per-coastline, not because a per-call default is expected in
   * practice — see `DEPTH_STEP_FT`'s doc comment before changing it. */
  depthStepFt?: number;
}

/**
 * `deriveReefBands` plus a depth-based second split pass — the fix for the
 * "Known limitation" this module's header documents at length: distance and
 * habitat geometry alone cannot separate two reef lines sitting on
 * near-continuous hardbottom (LBTS's Datura Ave entry), because the sand
 * channels between them are narrower than any `BAND_GAP_YARDS` that doesn't
 * also shatter the outer reef lines. See the header's "Resolved via
 * bathymetry — T21.24" section for the live numbers this was validated
 * against.
 *
 * **Deliberately a separate function, not a modification of `deriveReefBands`
 * with an extra optional argument.** A parallel agent is building an import
 * pipeline against `deriveReefBands`'s *current* signature and behavior with
 * no visibility into this change; duplicating the distance-gap grouping here
 * (rather than refactoring `deriveReefBands` to share it) means that
 * function's implementation is untouched, not just its outward behavior —
 * eliminating any chance this lands as a silent, hard-to-notice conflict with
 * work landing on the same file at the same time. The duplication is the
 * cost of that isolation, paid deliberately.
 *
 * `depthSamples` follows the same contract as `samples` for habitat: any
 * `DepthSample[]` is accepted, but in practice these should come from
 * `bathymetry-client.ts`'s `sampleDepthTransect`, walking the *same*
 * `(entry, bearingDegrees, stepYards, maxYards)` as `sampleTransect` produced
 * `samples` from. A habitat sample is matched to its depth counterpart by
 * recomputing each one's distance from `entry` and rounding to the nearest
 * yard — not by array position, since `sampleTransect` omits steps outside
 * every polygon while a depth transect does not, so the two arrays can differ
 * in length and offset. Two samples produced by the same spherical-geometry
 * step from the same entry land within floating-point noise of the same
 * intended yardage, so the rounded match is exact in practice; a genuinely
 * mismatched pair (different bearing, different entry) simply fails to match
 * and that habitat sample gets `depthFt: null` for this pass, same as any
 * other point with no coverage.
 *
 * Depth-null samples never trigger a split (a missing reading is not "no
 * change in depth," it's "no information," and treating it as either an
 * increase or a plateau would draw a boundary neither dataset actually
 * supports).
 */
export function deriveReefBandsWithDepth(
  entry: LatLng,
  samples: HabitatSample[],
  depthSamples: DepthSample[],
  options: DeriveReefBandsWithDepthOptions = {},
): ReefBand[] {
  const { corridorHalfWidthYards = CORRIDOR_HALF_WIDTH_YARDS, depthStepFt = DEPTH_STEP_FT } = options;

  // ~1 degree of latitude is a constant ~1760*69.05 yards; used to reject
  // habitat that is offshore of some *other* stretch of beach. Duplicated
  // from `deriveReefBands` rather than shared — see this function's doc
  // comment for why.
  const YARDS_PER_DEGREE_LAT = 69.05 * 1760;

  const depthByRoundedYards = new Map<number, number>();
  for (const d of depthSamples) {
    if (d.depthFt === null) continue;
    const yards = Math.round(distanceMiles(entry, d) * 1760);
    depthByRoundedYards.set(yards, d.depthFt);
  }

  const reef = samples
    .filter((s) => isReefHabitat(s.habitatClass))
    .filter(
      (s) => Math.abs(s.latitude - entry.latitude) * YARDS_PER_DEGREE_LAT <= corridorHalfWidthYards,
    )
    .map((s) => {
      const yards = distanceMiles(entry, s) * 1760;
      const depthFt = depthByRoundedYards.get(Math.round(yards)) ?? null;
      return { ...s, yards, depthFt };
    })
    .sort((a, b) => a.yards - b.yards);

  if (reef.length === 0) return [];

  // Pass 1: the same sand-gap split as `deriveReefBands`.
  const distanceGroups: (typeof reef)[] = [[reef[0]]];
  for (let i = 1; i < reef.length; i++) {
    const gap = reef[i].yards - reef[i - 1].yards;
    if (gap > BAND_GAP_YARDS) distanceGroups.push([reef[i]]);
    else distanceGroups[distanceGroups.length - 1].push(reef[i]);
  }

  // Pass 2: within each distance-group, split again wherever
  // consecutive-by-distance samples' depth increases by more than
  // `depthStepFt`. Samples missing a depth reading never trigger a split —
  // see this function's doc comment.
  const groups = distanceGroups.flatMap((group) => {
    const subGroups: (typeof group)[] = [[group[0]]];
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1];
      const cur = group[i];
      const isRealStep = prev.depthFt !== null && cur.depthFt !== null && cur.depthFt - prev.depthFt > depthStepFt;
      if (isRealStep) subGroups.push([cur]);
      else subGroups[subGroups.length - 1].push(cur);
    }
    return subGroups;
  });

  return groups.map((group, index) => {
    const counts = new Map<string, number>();
    for (const s of group) counts.set(s.habitatClass, (counts.get(s.habitatClass) ?? 0) + 1);
    const habitatClasses = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

    const closest = group[0];
    const depths = group.map((s) => s.depthFt).filter((f): f is number => f !== null);

    return {
      ordinal: index + 1,
      label: labelFor(index + 1),
      nearestYards: Math.round(group[0].yards),
      farthestYards: Math.round(group[group.length - 1].yards),
      arrivalPoint: { latitude: closest.latitude, longitude: closest.longitude },
      habitatClasses,
      sampleCount: group.length,
      depthFt: depths.length > 0 ? { minFt: Math.min(...depths), maxFt: Math.max(...depths) } : undefined,
    };
  });
}
