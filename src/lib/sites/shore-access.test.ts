import { describe, expect, it } from "vitest";
import {
  classifyShoreAccess,
  shoreAccessFromStoredFields,
  CURATED_ENTRY_POINTS,
  SHORE_DIVE_EASY_MILES,
  SHORE_DIVE_MAX_MILES,
  SOUTH_FLORIDA_ENTRY_POINTS,
  type ShoreEntryPoint,
} from "./shore-access";

/** A real coordinate far outside Florida (open Caribbean, off Santa
 * Marta, Colombia) — used to prove the OSM-tag fallback tier and the
 * "no signal at all" honest-unlikely path both work for a site nowhere
 * near any curated entry, per the founder's own framing (2026-08-10):
 * "I may dive outside of Florida... I have no idea what scuba diver will
 * use my app and where they are located." */
const SANTA_MARTA_AREA = { latitude: 11.24, longitude: -74.2 };

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
    expect(result.method).toBe("curated_entry");
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
    expect(result.method).toBe("curated_entry");
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

describe("CURATED_ENTRY_POINTS", () => {
  // Found 2026-08-10 (founder: "I may dive outside of Florida... I have no
  // idea what scuba diver will use my app and where they are located"):
  // classifyShoreAccess's default was silently SOUTH_FLORIDA_ENTRY_POINTS.
  // CURATED_ENTRY_POINTS is the new default and the place a second region
  // gets concatenated in later — this pins that it's behavior-identical to
  // the old default today, so the regression contract is explicit rather
  // than assumed.
  it("is byte-identical to SOUTH_FLORIDA_ENTRY_POINTS today", () => {
    expect(CURATED_ENTRY_POINTS).toEqual(SOUTH_FLORIDA_ENTRY_POINTS);
  });

  it("is classifyShoreAccess's actual default parameter", () => {
    const withDefault = classifyShoreAccess(seawardOfDatura(0.05));
    const withExplicit = classifyShoreAccess(seawardOfDatura(0.05), CURATED_ENTRY_POINTS);
    expect(withDefault).toEqual(withExplicit);
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

describe("classifyShoreAccess — Erojacks Dania (\"Dania Jacks\")", () => {
  it("classifies a real, popular shore dive that neither existing Dania-area entry reaches", () => {
    // Founder-reported (2026-08-10), corroborated by Force-E Scuba Centers
    // and Project Baseline Gulfstream (a citizen-science diving chapter):
    // both describe it as a well-known shore dive starting ~100 yd out,
    // "just north of the Dania Beach Pier." Real catalogued coordinates
    // from `sites` — the nearest real Atlantic coastline is 445 yd away,
    // but both mizell-johnson-dania and perry-street-dania sit far enough
    // south (~0.3-1 mi) that neither reaches it, hence the dedicated
    // dania-pier-north entry.
    const erojacksDania = { latitude: 26.0623, longitude: -80.10725 };
    const result = classifyShoreAccess(erojacksDania);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("dania-pier-north");
    expect(result.confidence).toBe("marginal");
  });
});

describe("classifyShoreAccess — Singer Island Mitigation Site", () => {
  it("classifies a real, corroborated mitigation reef found during the deep-research sweep", () => {
    // Found 2026-08-10 while systematically researching sites geometrically
    // close to real coastline but with no catalogued entry (the founder's
    // "dig deep, use AI-mode search" request). Pura Vida Divers and
    // Waterfront Properties both describe it as a diveable-from-shore
    // mitigation reef off Singer Island, entered via Ocean Mall Beach.
    // Real catalogued coordinates from `sites`.
    const singerIslandMitigation = { latitude: 26.78567, longitude: -80.03067 };
    const result = classifyShoreAccess(singerIslandMitigation);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("ocean-mall-singer-island");
  });
});

describe("classifyShoreAccess — Kreusler Park Ephemeral Reef", () => {
  it("classifies a real site with an official but weaker-evidence-tier corroboration", () => {
    // Found 2026-08-10 during the deep-research sweep. No dive-shop source
    // confirms recreational shore access, but Palm Beach County's own reef
    // registry designates this "PB-59 Ephemeral Reef" — FDEP's technical
    // term for shallow nearshore hardbottom — off a real guarded beach.
    // Coordinates from the FWC-imported catalogue record.
    const kreuslerReef = { latitude: 26.6177, longitude: -80.03345 };
    const result = classifyShoreAccess(kreuslerReef);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("kreusler-park-palm-beach");
  });
});

describe("classifyShoreAccess — U-LINK hybrid breakwater units", () => {
  it("classifies a real University of Miami reef installation off North Beach Oceanside Park", () => {
    // Found 2026-08-10 during the deep-research sweep, then upgraded from
    // an initial weaker-evidence tier once the founder found
    // divenavigator.com's dedicated listing, which states plainly "Entry
    // Type: Boat & Shore" — a real dive-site directory, not just an
    // inferred pattern from the sibling south-beach-5th-st entry.
    const ulink = { latitude: 25.866638, longitude: -80.116719 };
    const result = classifyShoreAccess(ulink);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("north-beach-oceanside-park-miami-beach");
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

describe("classifyShoreAccess — Phil Foster Park entry correction", () => {
  it("classifies the site literally named for this park, previously wrongly boat-only", () => {
    // Founder request (2026-08-10): re-verify every catalogued entry's own
    // coordinates, not just site distances, after mizell-johnson-dania
    // turned out to be mis-located. phil-foster-blue-heron was ~1.4 mi off
    // — real coordinates from OSM's own "Phil Foster Park" way and its
    // "Phil Foster Park Snorkel Reef" divespot node. Real catalogued
    // coordinates from `sites` for "Phil Foster Park Snorkel Trail", a site
    // that was `unlikely` at 2509.8 yd purely because the entry meant to
    // cover it was mis-placed.
    const snorkelTrail = { latitude: 26.7825, longitude: -80.04217 };
    const result = classifyShoreAccess(snorkelTrail);
    expect(result.isShoreAccessible).toBe(true);
    expect(result.nearestEntry?.id).toBe("phil-foster-blue-heron");
  });
});

describe("classifyShoreAccess — known exceptions override geometric range", () => {
  // Founder concern (2026-08-10): "I'm now really doubting the integrity of
  // the dive site information." Cross-checking the 19 currently-flagged
  // sites against independent web sources found two where a credible named
  // source explicitly contradicts the distance-only model — both real
  // catalogued coordinates from `sites`.

  it("classifies Goggle-Eye Reef as boat-only despite being within range of an entry", () => {
    // DiveBuddy.com: "you'll need to arrange a boat charter" to dive it
    // specifically, distinct from a different nearby shore dive it also
    // describes.
    const goggleEyeReef = { latitude: 26.5505, longitude: -80.03832 };
    const result = classifyShoreAccess(goggleEyeReef);
    expect(result.isShoreAccessible).toBe(false);
    expect(result.confidence).toBe("unlikely");
    // Still reports the nearest entry/distance for transparency — the
    // exception overrides the verdict, not the underlying geometry.
    expect(result.nearestEntry?.id).toBe("ocean-inlet-park-boynton");
    expect(result.distanceMiles).not.toBeNull();
  });

  it("classifies Peanut Island -NE as boat/kayak-only despite being within range of an entry", () => {
    // Multiple sources: accessible "only by water taxi, shuttle boat,
    // kayak, or paddleboard" — separated from Phil Foster Park by the Lake
    // Worth Inlet's navigable channel, not a normal beach swim.
    const peanutIslandNE = { latitude: 26.77695, longitude: -80.04305 };
    const result = classifyShoreAccess(peanutIslandNE);
    expect(result.isShoreAccessible).toBe(false);
    expect(result.confidence).toBe("unlikely");
  });

  it("does not suppress a genuinely shore-accessible site near an exception", () => {
    // Guards the match radius: a real site a short distance away from a
    // known exception's coordinates must not be swept into the exception.
    const nearbyRealSite = { latitude: 26.7825, longitude: -80.04217 }; // Phil Foster Park Snorkel Trail
    const result = classifyShoreAccess(nearbyRealSite);
    expect(result.isShoreAccessible).toBe(true);
  });
});

describe("classifyShoreAccess — global OSM-tag fallback (2026-08-10)", () => {
  // Founder: "I may dive outside of Florida... I have no idea what scuba
  // diver will use my app and where they are located." Every entry in
  // CURATED_ENTRY_POINTS is Florida-only today, so a site anywhere else on
  // Earth needs a real fallback signal rather than a permanent, uninformative
  // `unlikely`. OpenStreetMap's own `scuba_diving:entry` tag — already
  // parsed by osm-import.ts and previously discarded — is that signal.

  it("classifies a non-Florida site as shore-accessible when OSM tags it 'shore', capped at marginal", () => {
    const result = classifyShoreAccess(SANTA_MARTA_AREA, undefined, { osmEntryTag: "shore" });
    expect(result.isShoreAccessible).toBe(true);
    expect(result.confidence).toBe("marginal"); // never "likely" — unverified tag, not a researched entry
    expect(result.method).toBe("osm_tag");
  });

  it("does not surface a distant curated entry as the 'reason' for an osm_tag result", () => {
    // nearestEntry/distanceMiles mean "the entry this was measured from"
    // (sites.shore_entry_id's own contract) — an osm_tag classification
    // wasn't measured from any curated entry, so both must be null rather
    // than showing e.g. "1,076 mi from Datura Avenue" as if that explained
    // anything about a Colombia site.
    const result = classifyShoreAccess(SANTA_MARTA_AREA, undefined, { osmEntryTag: "shore" });
    expect(result.nearestEntry).toBeNull();
    expect(result.distanceMiles).toBeNull();
  });

  it("never earns 'likely' from an OSM tag alone, regardless of how strong the tag is", () => {
    // "marginal" is the honest ceiling for an unverified signal — the tag
    // has only two positive-adjacent values ("shore"/"unknown"), so this is
    // really just re-asserting the cap, but explicitly, since a future
    // change adding more tag granularity must not accidentally reach
    // "likely" without a real re-derivation of that promise.
    const result = classifyShoreAccess(SANTA_MARTA_AREA, undefined, { osmEntryTag: "shore" });
    expect(result.confidence).not.toBe("likely");
  });

  it("stays honestly 'unlikely' for a non-Florida site with no OSM tag — never a false positive or a crash", () => {
    const result = classifyShoreAccess(SANTA_MARTA_AREA, undefined, { osmEntryTag: "unknown" });
    expect(result.isShoreAccessible).toBe(false);
    expect(result.confidence).toBe("unlikely");
    expect(result.method).toBe("curated_entry");
  });

  it("stays 'unlikely' for a non-Florida site when no options are passed at all", () => {
    const result = classifyShoreAccess(SANTA_MARTA_AREA);
    expect(result.isShoreAccessible).toBe(false);
    expect(result.nearestEntry).not.toBeNull(); // still reports the (very distant) nearest Florida entry
    expect(result.distanceMiles).toBeGreaterThan(SHORE_DIVE_MAX_MILES);
  });

  it("treats a 'boat' OSM tag the same as no tag — never accessible", () => {
    const result = classifyShoreAccess(SANTA_MARTA_AREA, undefined, { osmEntryTag: "boat" });
    expect(result.isShoreAccessible).toBe(false);
  });

  it("lets a cited boat-only exception win even when OSM tags the same site 'shore'", () => {
    // Goggle-Eye Reef — DiveBuddy.com explicitly says this needs a boat
    // charter (see the exceptions describe block above). A bare community
    // tag must never override a citation-backed exception.
    const goggleEyeReef = { latitude: 26.5505, longitude: -80.03832 };
    const result = classifyShoreAccess(goggleEyeReef, undefined, { osmEntryTag: "shore" });
    expect(result.isShoreAccessible).toBe(false);
    expect(result.confidence).toBe("unlikely");
    expect(result.method).toBe("curated_entry");
  });

  it("prefers a real curated entry over the OSM tag when both are available", () => {
    // A site well within Datura's curated range should classify via the
    // curated entry, not fall through to the (weaker) tag tier, even if a
    // tag happens to be present.
    const result = classifyShoreAccess(seawardOfDatura(0.05), undefined, { osmEntryTag: "shore" });
    expect(result.method).toBe("curated_entry");
    expect(result.confidence).toBe("likely");
  });
});

describe("shoreAccessFromStoredFields", () => {
  // Found 2026-08-10: every render-time consumer used to call
  // classifyShoreAccess() live instead of trusting what osm-import.ts
  // already computed and stored — silently regressing an osm_tag-derived
  // site back to `unlikely` on its own detail page, since a live recompute
  // has no access to the OSM tag that produced the stored result.

  it("returns null when shore_access itself is null — 'not yet classified', callers should recompute live", () => {
    expect(shoreAccessFromStoredFields({ shore_access: null })).toBeNull();
    expect(shoreAccessFromStoredFields({})).toBeNull();
  });

  it("reconstructs a curated-entry result, resolving the stored slug to a real entry point", () => {
    const result = shoreAccessFromStoredFields({
      shore_access: "marginal",
      shore_access_method: "curated_entry",
      shore_entry_id: "datura-ave-lbts",
      shore_distance_yards: 530,
    });
    expect(result?.isShoreAccessible).toBe(true);
    expect(result?.confidence).toBe("marginal");
    expect(result?.nearestEntry?.id).toBe("datura-ave-lbts");
    expect(result?.distanceMiles).toBeCloseTo(530 / 1760, 5);
    expect(result?.method).toBe("curated_entry");
  });

  it("reconstructs an osm_tag result with no entry point to name", () => {
    const result = shoreAccessFromStoredFields({
      shore_access: "marginal",
      shore_access_method: "osm_tag",
      shore_entry_id: null,
      shore_distance_yards: null,
    });
    expect(result?.isShoreAccessible).toBe(true);
    expect(result?.method).toBe("osm_tag");
    expect(result?.nearestEntry).toBeNull();
    expect(result?.distanceMiles).toBeNull();
  });

  it("degrades a stale/unresolvable shore_entry_id to null rather than inventing a name", () => {
    // Same "never invent a name for a slug that doesn't resolve" rule
    // shore_entry_id's own column comment (0012) already documents.
    const result = shoreAccessFromStoredFields({
      shore_access: "marginal",
      shore_access_method: "curated_entry",
      shore_entry_id: "some-entry-that-no-longer-exists",
      shore_distance_yards: 400,
    });
    expect(result?.nearestEntry).toBeNull();
    expect(result?.distanceMiles).toBeCloseTo(400 / 1760, 5); // distance still shown, just no name
  });

  it("defaults method to curated_entry when the stored method is missing (a row from before shore_access_method existed)", () => {
    const result = shoreAccessFromStoredFields({
      shore_access: "likely",
      shore_entry_id: "datura-ave-lbts",
      shore_distance_yards: 100,
    });
    expect(result?.method).toBe("curated_entry");
  });

  it("reconstructs an honest unlikely result too, distance and entry preserved for 'why was this ruled out'", () => {
    const result = shoreAccessFromStoredFields({
      shore_access: "unlikely",
      shore_access_method: "curated_entry",
      shore_entry_id: "datura-ave-lbts",
      shore_distance_yards: 10000,
    });
    expect(result?.isShoreAccessible).toBe(false);
    expect(result?.nearestEntry?.id).toBe("datura-ave-lbts");
    expect(result?.distanceMiles).toBeCloseTo(10000 / 1760, 5);
  });
});
