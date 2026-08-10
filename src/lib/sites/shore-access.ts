/**
 * Shore-dive classification.
 *
 * This app is specifically about *shore* diving — sites you can walk into
 * without a boat. Neither OpenStreetMap nor Florida's FWC artificial-reef
 * catalogue records that property: OSM's `scuba_diving:entry` tag is absent on
 * the overwhelming majority of real nodes, and FWC catalogues deployment
 * events with no notion of how a diver reaches them. So the classification has
 * to be derived, and this module is where that happens.
 *
 * ## The threshold is empirical, not invented
 *
 * Baseline chosen by the founder, who dives it: the Lauderdale-by-the-Sea
 * shore dive entered at Datura Avenue. Two reefs sit off that entry, and the
 * *second* one is comfortably reachable from the beach — so the swim to the
 * second reef is the outer edge of what counts as a shore dive.
 *
 * Three independent lines of evidence agree, and it took all three to get this
 * right (2026-08-09):
 *
 * 1. **The founder's own dive.** First reef, swam out to the second, returned
 *    to shore, surfaced with ~1000 psi remaining — i.e. the full round trip
 *    inside a single tank with a normal reserve still in hand. Doable, with
 *    margin, not a stunt.
 * 2. **Published local guidance** for Lauderdale-by-the-Sea: the first reef
 *    line extends to roughly 300 yd (15-25 ft); the second reef is about
 *    **half a mile** out (30-50 ft).
 * 3. **Florida's Unified Reef Map** (FWC benthic habitat polygons), measured
 *    from the Datura entry: hardbottom begins ~175 yd out (the first reef) and
 *    `Ridge` runs ~650-800 yd (the second). Both features are real and at the
 *    distances the first two sources give.
 *
 * A correction to an earlier version of this note: it claimed a clean band of
 * sand separated those two reefs at Datura. That gap was an artifact of
 * sampling reef-polygon *vertices* rather than the sea floor itself; proper
 * cross-shore transect sampling (`reef-bands.ts`) shows the URM maps the
 * ground between them as near-continuous hardbottom, with sand channels only
 * 25-150 yd wide. The second reef at ~700-800 yd is genuinely there — so
 * `SHORE_DIVE_MAX_MILES` is unaffected — but distance alone does not separate
 * the two reefs in this dataset. Depth does (12-20 ft vs 30-50 ft), and the
 * URM carries no depth attribute. See `reef-bands.ts`'s Known Limitation.
 *
 * `SHORE_DIVE_MAX_MILES` is therefore 0.5 mi (~880 yd) — the second reef —
 * and `SHORE_DIVE_EASY_MILES` is ~0.17 mi (~300 yd) — the outer edge of the
 * first reef line.
 *
 * **An earlier version of this file set the maximum to 0.25 mi (~440 yd)** and
 * was wrong. That number came from the seaward edge of OpenStreetMap's single
 * `Anglin's Pier Reef` polygon, which turns out to span only the *first* reef
 * complex — OSM has no polygon for the second reef at all. The effect was that
 * the threshold excluded the very dive it was supposedly derived from. Worth
 * remembering the shape of that error: a single source looked authoritative
 * and self-consistent, and was quietly measuring something other than what it
 * was assumed to be measuring.
 *
 * A correction worth recording, because it would have produced a dangerously
 * wrong number: the first attempt measured from the nearest `natural=coastline`
 * way by latitude, which on a barrier island is the *Intracoastal* shore on the
 * west side — that put the reef at 982 yd and would have inflated the threshold
 * roughly 2.3x. The Atlantic shoreline is the easternmost coastline at a given
 * latitude, which is what the measurement above uses.
 *
 * ## What this classification does and does not claim
 *
 * It claims: this site is within a swim distance that, at a comparable real
 * site, is known to be doable from the beach.
 *
 * It does NOT claim the dive is safe, easy, or advisable today. Distance is
 * the only input; current, surf, visibility, boat traffic, entry footing and a
 * diver's own fitness all dominate it in practice, and none of them are in this
 * data. Per CLAUDE.md's standing rule that the UI must never imply a guarantee
 * the system can't back, anything rendering this tag must present it as
 * "plausibly shore-accessible — verify conditions", never as "shore dive:
 * confirmed". See `ShoreAccessResult.confidence`.
 */

import { distanceMiles, type LatLng } from "./distance";

/** Outer edge of a plausible shore swim — the LBTS second reef. See this
 * module's header for the evidence chain. 0.5 mi / ~880 yd. */
export const SHORE_DIVE_MAX_MILES = 0.5;

/**
 * Inside this, reaching a site from a known entry is uncontroversial — the
 * LBTS *first* reef line, documented as extending to roughly 300 yd. Used to
 * separate "clearly a shore dive" from "a real swim", so the UI can be more or
 * less emphatic rather than presenting a 200 yd and an 800 yd swim identically.
 * ~0.17 mi / ~300 yd.
 */
export const SHORE_DIVE_EASY_MILES = 0.17;

export interface ShoreEntryPoint extends LatLng {
  id: string;
  name: string;
  /** Free-text, founder/research-sourced. Not a legal access determination —
   * that stays `sites.legal_access_status`'s job. */
  note?: string;
}

/**
 * Verified shore entry points, South Florida. Coordinates geocoded 2026-08-09;
 * every one of these is a real, publicly-accessible entry researched earlier in
 * `supabase/sources/south-florida-dive-sites-candidates.md`.
 *
 * This list is deliberately small and hand-curated rather than derived. A site
 * is only shore-diveable if there is somewhere real to walk in — proximity to
 * *coastline* is not the same thing, since most coastline has no parking, no
 * legal access, or no safe entry. Growing this list is how coverage grows;
 * loosening the distance threshold is not.
 */
export const SOUTH_FLORIDA_ENTRY_POINTS: ShoreEntryPoint[] = [
  {
    id: "datura-ave-lbts",
    name: "Datura Avenue, Lauderdale-by-the-Sea",
    latitude: 26.1867,
    longitude: -80.09498,
    note: "Baseline for both thresholds — 1st reef 100-300 yd (12-20 ft), 2nd reef ~1/2 mile (30-50 ft). Tank rack on site. You may swim under the broken section of Anglin's Pier, but must stay 300 ft clear of the active pier structure.",
  },
  {
    id: "el-prado-lbts",
    name: "El Prado Park, Lauderdale-by-the-Sea",
    latitude: 26.1898,
    longitude: -80.09666,
  },
  {
    id: "phil-foster-blue-heron",
    name: "Phil Foster Park (Blue Heron Bridge), Riviera Beach",
    latitude: 26.78308,
    longitude: -80.06528,
    note: "Tide-dependent; best at high slack water.",
  },
  {
    id: "mizell-johnson-dania",
    name: "Dr. Von D. Mizell-Eula Johnson State Park, Dania Beach",
    latitude: 26.0523,
    longitude: -80.14367,
  },
  { id: "red-reef-boca", name: "Red Reef Park, Boca Raton", latitude: 26.36467, longitude: -80.06953 },
  {
    id: "south-beach-5th-st",
    name: "5th Street beach, South Beach, Miami Beach",
    // Placed at the Atlantic shoreline point nearest the ReefLine
    // installation (~25.7729), not at the 5th St street-end. Geocoding "5th
    // Street Beach" put this ~450 yd north along the sand, which measured
    // Traffic Jam at 545 yd (outside the threshold) when the real swim from
    // the adjacent beach is ~295 yd. On a straight N-S barrier beach an entry
    // is only as good as its position *along* the shore, not just its
    // presence on it.
    latitude: 25.77288,
    longitude: -80.12979,
    note: 'Entry for the ReefLine "Traffic Jam" installation (~295 yd out, ~20 ft) — the submerged-car sculpture divers call the underwater highway.',
  },
  {
    id: "vistamar-fort-lauderdale",
    name: "Vistamar Street, Fort Lauderdale",
    // Atlantic beach at Vistamar St, just south of Lauderdale-by-the-Sea.
    // Founder-identified shore dive. Nothing in OSM or FWC sits offshore of
    // here — the nearest artificial-reef record is 711 yd — but Florida's
    // Unified Reef Map shows `Pavement` hardbottom ~129 yd out, which is the
    // reef people actually dive from this entry. Worth keeping as the worked
    // example of why point catalogues alone under-count shore diving.
    latitude: 26.13374,
    longitude: -80.10271,
  },
  {
    id: "hollywood-north-beach",
    name: "Hollywood North Beach Park, Hollywood",
    latitude: 26.01998,
    longitude: -80.1819,
  },
];

/**
 * Florida law requires a diver-down flag or buoy to be displayed while diving,
 * and requires boats to stay clear of it. This is a *legal* requirement, not a
 * recommendation, and it applies to every shore dive in this dataset — so it
 * belongs with the shore-access classification rather than buried in per-site
 * notes that most sites won't have.
 *
 * Surfaced here so any UI that tells a diver "you can walk in here" can also
 * tell them what the law requires of them once they do. Consistent with this
 * codebase's standing rule that we never present a capability without its
 * real-world caveats (see CLAUDE.md's Safety-critical code standard).
 *
 * Deliberately not phrased as legal advice, and deliberately not a substitute
 * for local rules: individual entries carry their own restrictions (e.g. the
 * 300 ft standoff from the active section of Anglin's Pier at LBTS), which
 * belong on the entry point or the site's `legal_access_status`.
 */
export const FLORIDA_DIVER_DOWN_FLAG_NOTICE =
  "Florida law requires you to display a diver-down flag or buoy while in the water, and to stay close to it.";

export type ShoreAccessConfidence = "likely" | "marginal" | "unlikely";

export interface ShoreAccessResult {
  isShoreAccessible: boolean;
  /** Never "confirmed" — see this module's header. `likely` means well inside
   * the measured baseline, `marginal` means near its outer edge (a longer swim
   * that conditions could easily rule out on any given day). */
  confidence: ShoreAccessConfidence;
  nearestEntry: ShoreEntryPoint | null;
  distanceMiles: number | null;
}

/**
 * Classifies a site by its distance to the nearest known shore entry point.
 *
 * Returns `unlikely` with `isShoreAccessible: false` when there is no entry
 * point in range — which is also the honest answer for a site that may well be
 * shore-diveable from an entry nobody has catalogued yet. Absence of a known
 * entry is not evidence the dive is boat-only, and callers must not render it
 * as though it were.
 */
export function classifyShoreAccess(
  site: LatLng,
  entryPoints: ShoreEntryPoint[] = SOUTH_FLORIDA_ENTRY_POINTS,
): ShoreAccessResult {
  if (entryPoints.length === 0) {
    return { isShoreAccessible: false, confidence: "unlikely", nearestEntry: null, distanceMiles: null };
  }

  let nearestEntry = entryPoints[0];
  let best = distanceMiles(site, nearestEntry);
  for (const entry of entryPoints.slice(1)) {
    const d = distanceMiles(site, entry);
    if (d < best) {
      best = d;
      nearestEntry = entry;
    }
  }

  if (best > SHORE_DIVE_MAX_MILES) {
    return { isShoreAccessible: false, confidence: "unlikely", nearestEntry, distanceMiles: best };
  }

  return {
    isShoreAccessible: true,
    confidence: best <= SHORE_DIVE_EASY_MILES ? "likely" : "marginal",
    nearestEntry,
    distanceMiles: best,
  };
}
