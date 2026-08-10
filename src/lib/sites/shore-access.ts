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
    // Corrected 2026-08-10: the original coordinate (26.78308, -80.06528) was
    // ~1.4 mi west of the real park — found while re-verifying every
    // catalogued entry against independent data after two other entries
    // (mizell-johnson-dania, hollywood-north-beach) turned out to be
    // similarly mis-geocoded. Real coordinates from OSM (`Phil Foster Park`
    // way, addr 900 East Blue Heron Blvd, Riviera Beach), cross-checked
    // against OSM's own `Phil Foster Park Snorkel Reef` node
    // (`scuba_diving:divespot=yes`, 26.78258, -80.04217) — the actual named
    // dive spot under the bridge. Note this site is an Intracoastal
    // lagoon/bridge dive, not an open-Atlantic beach: it will never be near
    // `natural=coastline` the way the other entries are, so that heuristic
    // can't validate it — ground-truthed against the named dive-spot node
    // instead.
    latitude: 26.7841,
    longitude: -80.04242,
    note: "Tide-dependent; best at high slack water.",
  },
  {
    id: "mizell-johnson-dania",
    name: "Dr. Von D. Mizell-Eula Johnson State Park, Dania Beach",
    // Corrected 2026-08-10: the original coordinate (26.0523, -80.14367) was
    // ~1300 yd (2 mi across, on a barrier peninsula ~0.4 mi wide) west of the
    // park's actual Atlantic beach — the same class of error as the LBTS
    // Intracoastal-vs-Atlantic mistake this module's header already
    // documents, not a one-off. It silently pushed every real site near this
    // park's coastline out of shore-dive range, discovered only because one
    // of them (Perry Street Rockpile) was independently reported and
    // verified as a documented shore dive. Corrected to the real Atlantic
    // coastline (OSM `natural=coastline`, easternmost way) at this latitude.
    latitude: 26.0531,
    longitude: -80.1119,
  },
  {
    id: "perry-street-dania",
    name: "Perry Street Beach, Dania Beach",
    // Founder-reported (2026-08-10), corroborated by two independent
    // sources: diverarchives.com confirms the artificial reef itself
    // ("40000 tons" of limestone boulders, 18 ft max depth, matching the
    // catalogued site), and scubastar.com (a real dive-tour operator)
    // states plainly "Perry Street Rock Pile begins 600 feet [200 yd] from
    // the shore" and names "Perry St. Beach" as the shore entry, 12-20 ft.
    // Placed at the real Atlantic coastline (OSM `natural=coastline`,
    // easternmost way) at the foot of Perry Street, not a geocoded address.
    latitude: 26.0473,
    longitude: -80.11239,
    note: "Foot of Perry Street. Entry for the Perry Street Rockpile artificial reef, ~200 yd out, 12-20 ft.",
  },
  {
    id: "dania-pier-north",
    name: "North of Dania Beach Pier, Dania Beach",
    // Founder-reported (2026-08-10), asking specifically about "Erojacks
    // Dania" (the "Dania Jacks") after a Google AI Overview described it as
    // a well-known, popular shore dive. Independently corroborated by two
    // real dive-industry sources, not just the AI summary: Force-E Scuba
    // Centers ("just north of the Dania Beach Pier... stacked and run from
    // 100 yards to the first reef line... 10-25 ft") and Project Baseline
    // Gulfstream, a citizen-science diving chapter ("a few hundred yards
    // North of Dania pier... stacked and running from about 100 yards
    // offshore to the first reef line"). Neither `mizell-johnson-dania`
    // nor `perry-street-dania` covers this — both are ~0.3-1 mi further
    // south than the real coastline point directly across from the jack
    // field. Placed at the real Atlantic coastline (OSM `natural=coastline`,
    // easternmost way) at the field's own latitude, not the pier structure
    // itself or a geocoded address.
    latitude: 26.06269,
    longitude: -80.1113,
    note: 'The "Erojacks"/"Dania Jacks" artificial reef begins ~100 yd out and runs to the first reef line, 10-25 ft. Inside Dr. Von D. Mizell-Eula Johnson State Park — no spearfishing or lobstering.',
  },
  {
    id: "ocean-mall-singer-island",
    name: "Ocean Mall Beach, Riviera Beach (Singer Island)",
    // Found during the founder-requested deep-research sweep (2026-08-10):
    // real, corroborated shore/snorkel access — a mitigation reef of
    // limestone boulders in sandy channels just offshore Singer Island
    // beach, 5-25 ft, diveable from shore on calm days (Pura Vida Divers,
    // Waterfront Properties). Named entry: Ocean Mall on Singer Island
    // (2511 Ocean Drive, Riviera Beach — parking, restrooms). Placed at the
    // real Atlantic coastline (OSM `natural=coastline`, easternmost way)
    // near that address, not the geocoded street point itself.
    latitude: 26.7902,
    longitude: -80.03175,
    note: "Parking/restrooms at Ocean Mall. Mitigation reef of limestone boulders in sandy channels just offshore, 5-25 ft.",
  },
  {
    id: "kreusler-park-palm-beach",
    name: "R. G. Kreusler Park, Palm Beach",
    // Found during the founder-requested deep-research sweep (2026-08-10).
    // Weaker evidentiary tier than most entries in this file, documented
    // honestly rather than overclaimed: no dive-shop or dive-report source
    // was found describing this specific reef as a recreational shore dive.
    // What's real and corroborated is (1) R. G. Kreusler Park is a genuine
    // guarded public Atlantic beach (450 ft frontage, parking, restrooms —
    // Palm Beach County) and (2) Palm Beach County's own official reef
    // registry lists a designated "PB-59 Kreusler Park Ephemeral Reef" —
    // "ephemeral reef" being FDEP's own technical term specifically for
    // shallow (<15 ft) *nearshore* hardbottom, a distinct category from
    // deeper offshore artificial-reef boat sites. That's the same class of
    // evidence (technical habitat data, not a dive-shop writeup) already
    // accepted for the Datura/El Prado/Vistamar reef-band entries. Placed
    // at the real park coordinate (OSM `R C Kreusler Park` node), not a
    // geocoded street address — the address geocode was ambiguous (the
    // house number recurs in Manalapan and Highland Beach, different towns
    // on the same barrier island).
    latitude: 26.6166458,
    longitude: -80.037219,
    note: "Guarded beach, parking/restrooms. PB-59 'Ephemeral Reef' — shallow nearshore hardbottom, official designation but not independently confirmed as a recreational shore dive.",
  },
  {
    id: "north-beach-oceanside-park-miami-beach",
    name: "North Beach Oceanside Park, Miami Beach",
    // Found during the founder-requested deep-research sweep (2026-08-10).
    // Real University of Miami-led hybrid reef/coral-restoration
    // installation ("U-LINK hybrid breakwater units"), part of the broader
    // ReefLine project — the same project whose South Beach segment
    // ("Traffic Jam"/Concrete Coral) is already catalogued at
    // `south-beach-5th-st`. Upgraded from an initial weaker-evidence tier
    // (UM News's own installation announcement, ~1,000 ft offshore, ~14 ft,
    // but no dedicated dive-site source) once the founder found
    // divenavigator.com's dedicated listing, which states plainly "Entry
    // Type: Boat & Shore", ~750 ft (231 m) offshore, 14 ft — a real
    // dive-site directory now directly confirms shore access, not just an
    // inferred pattern from a sibling site. The two distance figures
    // (1,000 ft vs 750 ft) don't fully agree, noted rather than silently
    // picked — both are well inside this module's threshold either way.
    // Placed at the real Atlantic coastline (OSM `natural=coastline`,
    // easternmost way) at the park's address (Collins Ave, 79th-87th St),
    // not a geocoded point.
    latitude: 25.8652239,
    longitude: -80.1189714,
    note: "Street parking, municipal lot at 79th St. U-LINK hybrid reef installation ~750-1,000 ft offshore, ~14 ft — part of the ReefLine project; DiveNavigator lists it \"Boat & Shore\".",
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
    // Corrected 2026-08-10: the original coordinate (26.01998, -80.1819) was
    // ~4.1 mi west of the real park, well inland — found while re-verifying
    // every catalogued entry's own coordinates against real coastline data
    // after the mizell-johnson-dania entry turned out to be similarly
    // mis-geocoded (founder: "we should really look at the shoreline
    // closest... some entry points have also been mis guided"). Real
    // address (3601 N Ocean Dr, Hollywood, FL 33019, at Sheridan St & A1A)
    // geocoded via Nominatim, then snapped to the nearest real Atlantic
    // coastline point (OSM `natural=coastline`) at that latitude.
    latitude: 26.03267,
    longitude: -80.11374,
  },
  {
    id: "delray-municipal-beach",
    name: "Delray Municipal Beach (south end), Delray Beach",
    // Founder-reported gap (2026-08-11): the S.S. Inchulva / Delray Wreck
    // (a real, well-known shore dive — independently confirmed the founder
    // asked Gemini, which said yes) was classified `unlikely` because our
    // nearest catalogued entry, Red Reef Park in Boca Raton, is 10,913 yd
    // (6.2 mi) away — the correct "under-classify, don't guess" outcome
    // `shore-access.ts`'s own header describes, not a computation bug: we
    // simply had no entry catalogued for this stretch of coast.
    //
    // Two independent sources agree on ~150 yd / 15-25 ft: the wreck's own
    // OSM-sourced description ("rests... in 25 feet of water about 150
    // yards offshore the south end of Delray's municipal beach") and web
    // research citing "150 yards from shore in 15 to 25 feet of water...
    // directly off the beach from the Seagate Beach Club." A third,
    // independently measured figure — the real Atlantic coastline (not
    // Mapbox's geocoded "Seagate Beach Club" business address, which lands
    // inland of the actual beach point) at the wreck's own latitude — put
    // it at 258 yd, the coordinate used below. All three land the same
    // conclusion (comfortably inside `SHORE_DIVE_EASY_MILES`) despite not
    // agreeing to the yard.
    latitude: 26.45227,
    longitude: -80.05817,
    note: "South end of Delray's municipal beach, near Seagate. Entry for the S.S. Inchulva / Delray Wreck, ~150-260 yd out, ~15-25 ft.",
  },
  {
    id: "ocean-inlet-park-boynton",
    name: "Ocean Inlet Park, Boynton Beach",
    // Found during the founder-requested full-catalogue audit that added
    // Delray (2026-08-11): four FWC-imported "Boynton Inlet"-named sites
    // were all `unlikely` with no nearby entry, which read as a plausible
    // second instance of the exact gap Delray was. Research confirmed a
    // real, documented, publicly-accessible shore dive/snorkel spot here —
    // "a shore accessible salt water dive site... the jetty stretches
    // roughly 100 yards into the Atlantic... reef starting in and around
    // the park's jetty... maximum depth 11-15 ft" — that we had never
    // catalogued. Coordinate is the real Atlantic shoreline (not the
    // geocoded street address, which lands inland of the beach) at the
    // park's own latitude, same "measure the actual coastline, don't trust
    // the geocode" discipline every entry in this file follows.
    //
    // Real effect on the live catalogue: 3 of the 4 "Boynton Inlet" sites
    // move from `unlikely` to shore-accessible (263-553 yd out); the fourth,
    // "Boynton Inlet Step Reef North" at 1425 yd, correctly stays boat-only —
    // adding this entry doesn't manufacture shore access, it just measures
    // what was already there.
    latitude: 26.54599,
    longitude: -80.04183,
    note: "Jetty extends ~100 yd into the Atlantic; nearshore reef/ledge around it, ~11-15 ft.",
  },
];

/**
 * Founder follow-up (2026-08-10): resolved the "Boynton Inlet Stepping
 * Stones Reef" ambiguity flagged during the exceptions audit above. A
 * Google AI Overview, cross-checked by the founder, confirms it's a real
 * shore/snorkel dive: entered "just south of the Ocean Inlet Park lifeguard
 * tower" (this module's `ocean-inlet-park-boynton` entry), ~400 ft to the
 * near edge of the reef structures, 25-35 ft. The catalogued site's 553 yd
 * distance is farther than that 400 ft figure — plausibly a farther module
 * of the same multi-part reef deployment than the near edge the guidance
 * describes — but nothing here contradicts the `marginal` classification
 * already in place; no exception or coordinate change needed, this is
 * confirmatory, not corrective.
 */

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

/**
 * Sites within geometric range of a real entry, but that independent named
 * sources explicitly contradict — found 2026-08-10 while cross-checking the
 * distance model's output against real web sources, per the founder's own
 * concern ("I'm now really doubting the integrity of the dive site
 * information"). Distance-to-entry is a *proxy* for "can a diver walk/swim
 * here," and it fails specifically when open water between the entry and the
 * site isn't actually safe or normal to swim — a tidal inlet channel with
 * boat traffic and current, or a site an authoritative source names as boat
 * chartered. This list exists because that failure mode is real, not
 * hypothetical, and the module's own "under-classify, don't guess" principle
 * means a credible named source saying "boat-only" should win over raw
 * distance. Each entry needs its own citation — this is not a general escape
 * hatch, and every addition should be as researched as an entry point.
 */
export interface ShoreAccessException extends LatLng {
  id: string;
  reason: string;
}

export const SHORE_ACCESS_EXCEPTIONS: ShoreAccessException[] = [
  {
    id: "goggle-eye-reef-boynton",
    // Real coordinates from `sites`. DiveBuddy.com (a real dive-site
    // database) states plainly: "Goggle Eye reef is a boat accessible salt
    // water dive site... While Goggle-Eye Reef is specifically a
    // boat-accessible site, there are shore diving options in the Boynton
    // Beach area [describing a different, separate site]... If you're
    // interested in diving Goggle-Eye Reef specifically, you'll need to
    // arrange a boat charter." It only fell inside the 0.5 mi threshold
    // because it's geometrically close to the corrected Ocean Inlet Park
    // entry — proximity to an entry isn't the same as a safe path from it.
    latitude: 26.5505,
    longitude: -80.03832,
    reason:
      'DiveBuddy.com names this site explicitly boat-accessible ("you\'ll need to arrange a boat charter"), despite being within geometric range of the Ocean Inlet Park entry.',
  },
  {
    id: "peanut-island-ne",
    // Real coordinates from `sites`. Multiple independent sources (Florida
    // Rambler, Get Wet Watersports) agree Peanut Island is "accessible only
    // by water taxi, shuttle boat, kayak, or paddleboard" — it sits across
    // the mouth of the Lake Worth Inlet (active tidal channel, boat
    // traffic) from the Phil Foster Park entry, not along continuous
    // swimmable nearshore water. The straight-line distance (872 yd) can't
    // distinguish "872 yd of beach swim" from "872 yd that crosses a
    // navigable inlet channel" — exactly the gap this exception list exists
    // to cover.
    latitude: 26.77695,
    longitude: -80.04305,
    reason:
      "Real sources agree Peanut Island is boat/kayak/water-taxi access only, separated from the mainland by the Lake Worth Inlet channel — not a normal swim, despite being within geometric range of Phil Foster Park.",
  },
];

const SHORE_ACCESS_EXCEPTION_MATCH_MILES = 0.02;

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

  const isKnownException = SHORE_ACCESS_EXCEPTIONS.some(
    (exception) => distanceMiles(site, exception) <= SHORE_ACCESS_EXCEPTION_MATCH_MILES,
  );
  if (isKnownException) {
    return { isShoreAccessible: false, confidence: "unlikely", nearestEntry, distanceMiles: best };
  }

  return {
    isShoreAccessible: true,
    confidence: best <= SHORE_DIVE_EASY_MILES ? "likely" : "marginal",
    nearestEntry,
    distanceMiles: best,
  };
}
