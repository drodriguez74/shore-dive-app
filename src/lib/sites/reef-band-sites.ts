/**
 * Turning derived reef bands (`reef-bands.ts`) into candidate `sites` rows
 * (Task 21, T21.25).
 *
 * `deriveReefBands` answers "what reef lines sit offshore of this entry" —
 * this module answers "what would a `sites` row for each of those lines look
 * like". The two are kept separate on purpose: `reef-bands.ts` is pure
 * geometry/habitat reasoning with no notion of the `sites` schema, and this
 * module is pure schema-shaping with no notion of habitat sampling. Neither
 * touches the network or the database — see the scratch runner script for
 * the I/O half (fetching live URM data, deduping against the live `sites`
 * table, and — deliberately, this session — never writing to it).
 *
 * ## Why every candidate here is `COMMUNITY`, never `VERIFIED`
 *
 * A reef band is *inferred*: nobody surveyed "Second Reef off Datura Avenue"
 * and vouched for it as a named site. It is the output of sampling a public
 * habitat-polygon dataset along a straight line and grouping the result. That
 * is exactly the same "automated inference is not a human vouching for a
 * row" reasoning `osm-import.ts` and `reef-bands.ts`'s own header already
 * apply to their outputs — see `reef-bands.ts`'s "What these derived sites
 * are, and are not" section. `buildReefBandSiteCandidates` has no branch that
 * can produce anything but `COMMUNITY`.
 *
 * ## Depth: measured first, the Datura literature citation as a fallback
 *
 * The Unified Reef Map's habitat polygons carry no depth attribute at all
 * (`reef-bands.ts`'s header), so depth here was originally `null` by
 * default. That changed once `reef-bands.ts` grew a real, additive
 * `ReefBand.depthFt` field (T21.24, populated only by
 * `deriveReefBandsWithDepth`, which pairs habitat samples with live NOAA
 * bathymetry along the same transect). `resolveDepthFt` below now prefers
 * that measured value whenever the caller supplies bands built with depth —
 * an actual sounding beats a literature citation.
 *
 * The Datura Avenue exception is kept as the *fallback*, not removed: if a
 * caller passes bands from the plain `deriveReefBands` (no bathymetry — e.g.
 * a URM outage, or a future entry this pass never re-derived), Datura's two
 * bands still get `shore-access.ts`'s cited local guidance (first reef
 * 12-20 ft, second reef 30-50 ft) rather than falling back to `null` for a
 * site whose depth is genuinely well-established. It still requires exactly
 * two Datura bands with no measured depth of their own — a single merged
 * band or an unexpected 3+ split both stay `null` rather than guessing which
 * half a documented range belongs to. Every other entry has no literature
 * fallback and is `null` whenever bathymetry didn't cover it.
 *
 * ## Shore access: reused, not reimplemented
 *
 * `shore_access`/`shore_distance_yards` come from calling
 * `classifyShoreAccess` (never reimplementing its thresholds) against the
 * band's `arrivalPoint`, scoped to *only* the originating entry point rather
 * than the full `SOUTH_FLORIDA_ENTRY_POINTS` list. That scoping matters: an
 * unscoped call could resolve a band's nearest entry to a *different*,
 * closer-by-coincidence entry than the one it was actually derived from,
 * which would attribute the site to the wrong shore entry. A band whose
 * `nearestYards` puts it beyond `SHORE_DIVE_MAX_MILES` still produces a
 * candidate — it is honestly labeled `unlikely`/not shore-accessible rather
 * than being silently dropped, the same "under-classify, don't guess"
 * discipline `classifyShoreAccess` itself documents.
 */

import type { ReefBand } from "./reef-bands";
import { classifyShoreAccess, type ShoreEntryPoint } from "./shore-access";
import type { LegalAccessStatus, ShoreAccessConfidence, SiteProvenance, SiteType } from "./types";

/** Every candidate this module produces is unmoderated automated inference —
 * never a human vouching for a row. See this module's header. */
const CANDIDATE_PROVENANCE: SiteProvenance = "COMMUNITY";

/** Reef bands are habitat, not a site "type" distinct from a natural reef
 * line — matches `deriveSiteType`'s `natural=reef` -> `shore_reef` mapping in
 * `osm-import.ts`, so this pipeline's output and OSM's agree on what kind of
 * site a reef line is. */
const CANDIDATE_SITE_TYPE: SiteType = "shore_reef";

/**
 * A `sites` row shape produced from one `ReefBand`, plus metadata (below the
 * `---` split) that isn't a `sites` column but is needed by a caller doing
 * dedupe or building a human-readable report — not persisted, but real
 * information about *why* this candidate exists that would be wasteful to
 * discard and immediately have to re-derive.
 */
export interface ReefBandSiteCandidate {
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  provenance: SiteProvenance;
  /** Always `null` — the Unified Reef Map carries no legal/access-status
   * information, so this is "not yet assessed," the same honest default
   * `osm-import.ts` uses for the same reason. */
  legal_access_status: LegalAccessStatus;
  site_type: SiteType;
  /** `null` unless the Datura exception applies — see this module's header. */
  depth_min_ft: number | null;
  depth_max_ft: number | null;
  shore_access: ShoreAccessConfidence;
  shore_entry_id: string;
  shore_distance_yards: number;

  // --- Metadata: not `sites` columns, kept for dedupe/reporting only. ---
  /** `ShoreEntryPoint.id` this candidate was derived from — duplicates
   * `shore_entry_id` today (nothing else can produce these candidates) but
   * kept as its own field so a caller never has to assume that column always
   * means "the originating entry" for every future producer of this shape. */
  entryId: string;
  entryName: string;
  bandOrdinal: number;
  bandLabel: string;
  nearestYards: number;
  farthestYards: number;
  habitatClasses: string[];
}

const DATURA_ENTRY_ID = "datura-ave-lbts";

/** Published local guidance for Datura Avenue, LBTS — see this module's
 * header and `shore-access.ts`'s own header for the citation. Keyed by
 * `ReefBand.ordinal`, applied only when there are exactly two Datura bands
 * (see `resolveDepthFt`). */
const DATURA_TWO_BAND_DEPTHS_FT: Record<number, { minFt: number; maxFt: number }> = {
  1: { minFt: 12, maxFt: 20 },
  2: { minFt: 30, maxFt: 50 },
};

/**
 * The only place this module is allowed to assign a depth.
 *
 * Preference order: (1) `band.depthFt` — a real NOAA-bathymetry-measured
 * range, present whenever the caller built `allBands` via
 * `deriveReefBandsWithDepth`; a genuine reading beats a citation, so this
 * wins whenever it has at least one non-null bound. (2) the Datura literature
 * fallback, only for Datura Avenue's exactly-two-band split, and only when
 * step 1 produced nothing — see this module's header for why the fallback
 * still exists rather than being replaced outright. (3) `null` for
 * everything else, same "depth this module has no way to know is depth this
 * module must not invent" rule as always.
 */
export type DepthSource = "measured" | "literature" | "none";

interface ResolvedDepth {
  minFt: number | null;
  maxFt: number | null;
  /** Which of `resolveDepthFt`'s two branches produced this — threaded into
   * `buildDescription` so the disclosure text never says "not measured" for
   * a depth that actually was, or vice versa. */
  source: DepthSource;
}

/** NOAA bathymetry returns depth as a raw float (metres-to-feet conversion
 * of a continuous sounding), which reads as false precision once it lands in
 * a description a diver reads — "9.550075512295319 ft" implies a survey-grade
 * reading this derivation doesn't actually have. Rounded to 1 decimal place,
 * matching `sites.depth_min_ft`/`depth_max_ft`'s own `numeric(5,1)` column —
 * the DB would silently round on insert regardless, but the description text
 * is a plain string column that never gets that rounding for free. */
function roundDepthFt(value: number): number {
  return Math.round(value * 10) / 10;
}

function resolveDepthFt(entry: ShoreEntryPoint, band: ReefBand, allBands: ReefBand[]): ResolvedDepth {
  if (band.depthFt && (band.depthFt.minFt !== null || band.depthFt.maxFt !== null)) {
    return {
      minFt: band.depthFt.minFt !== null ? roundDepthFt(band.depthFt.minFt) : null,
      maxFt: band.depthFt.maxFt !== null ? roundDepthFt(band.depthFt.maxFt) : null,
      source: "measured",
    };
  }

  if (entry.id !== DATURA_ENTRY_ID || allBands.length !== 2) {
    return { minFt: null, maxFt: null, source: "none" };
  }
  const known = DATURA_TWO_BAND_DEPTHS_FT[band.ordinal];
  return known
    ? { minFt: known.minFt, maxFt: known.maxFt, source: "literature" }
    : { minFt: null, maxFt: null, source: "none" };
}

/** The part of `ShoreEntryPoint.name` before its first comma — e.g. "Datura
 * Avenue" out of "Datura Avenue, Lauderdale-by-the-Sea" — used for the site
 * name so it reads "First Reef off Datura Avenue" rather than repeating the
 * whole "Datura Avenue, Lauderdale-by-the-Sea" municipality suffix that the
 * full entry name carries for disambiguation elsewhere. */
function shortEntryName(entry: ShoreEntryPoint): string {
  return entry.name.split(",")[0].trim();
}

/**
 * Builds the `description` disclosing exactly what this candidate is and is
 * not — follows `osm-import.ts`'s `buildOsmDescription` convention of an
 * attribution/disclosure paragraph plus scannable fact lines, adapted for a
 * derivation rather than an imported catalogue record. Every sentence here
 * is required reading before this module's output can honestly carry
 * `COMMUNITY` provenance (this module's header).
 */
function buildDescription(entry: ShoreEntryPoint, band: ReefBand, depth: ResolvedDepth): string {
  const distancePhrase =
    band.nearestYards === band.farthestYards
      ? `about ${band.nearestYards} yd offshore`
      : `roughly ${band.nearestYards}-${band.farthestYards} yd offshore`;

  const habitatPhrase =
    band.habitatClasses.length > 0 ? `Predominant Unified Reef Map habitat class: ${band.habitatClasses.join(", ")}.` : "";

  const disclosure =
    "This is not a named, individually verified dive site — nobody has dived or verified this specific " +
    `derived boundary. It is inferred from Florida's Unified Reef Map benthic-habitat polygons by sampling ` +
    `a cross-shore transect straight out from the ${entry.name} shore entry and grouping the reef habitat it ` +
    `crosses into distinct reef lines (this app labels them "First Reef", "Second Reef", etc., matching how ` +
    `divers already describe reef lines off this coast). The coordinates mark where the transect first meets ` +
    `this reef line, not a human-confirmed dive site. Verify conditions and this reef line's actual extent ` +
    "independently before diving here.";

  let depthLine: string;
  if (depth.source === "measured") {
    depthLine =
      `Depth ${depth.minFt}-${depth.maxFt} ft, measured along this same transect from live NOAA bathymetry ` +
      "(BAG/CUDEM survey data) — a real sounding, not a citation, though still an automated reading rather " +
      "than a diver's confirmation.";
  } else if (depth.source === "literature") {
    depthLine =
      `Published local guidance puts this reef line at ${depth.minFt}-${depth.maxFt} ft — not measured by ` +
      "this derivation itself (bathymetry coverage was unavailable for this band); attached here because it " +
      "is documented specifically for this reef line off this entry.";
  } else {
    depthLine = "Depth not recorded — no bathymetry coverage and no documented local guidance for this reef line.";
  }

  const entryNote = entry.note ? `Shore entry note: ${entry.note}` : "";

  return [`${band.label} off the ${entry.name} shore entry, ${distancePhrase}.`, habitatPhrase, disclosure, depthLine, entryNote]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Turns `bands` (derived offshore of `entry` by `deriveReefBands`) into
 * candidate `sites` rows. Pure — no network, no database, safe to unit test
 * directly and safe to call speculatively before any dedupe/insert decision
 * is made.
 *
 * One candidate per band, same order `deriveReefBands` returns (shore-
 * outward). An empty `bands` array returns an empty array — this function
 * makes no judgement about whether an entry with no derived reef is
 * surprising, the same "empty is not evidence of absence" discipline
 * `deriveReefBands` documents for its own empty-array case.
 */
export function buildReefBandSiteCandidates(entry: ShoreEntryPoint, bands: ReefBand[]): ReefBandSiteCandidate[] {
  return bands.map((band) => {
    const depth = resolveDepthFt(entry, band, bands);
    const shoreAccess = classifyShoreAccess(band.arrivalPoint, [entry]);

    return {
      name: `${band.label} off ${shortEntryName(entry)}`,
      description: buildDescription(entry, band, depth),
      latitude: band.arrivalPoint.latitude,
      longitude: band.arrivalPoint.longitude,
      provenance: CANDIDATE_PROVENANCE,
      legal_access_status: null,
      site_type: CANDIDATE_SITE_TYPE,
      depth_min_ft: depth.minFt,
      depth_max_ft: depth.maxFt,
      // classifyShoreAccess is scoped to [entry] only (see this module's
      // header), so nearestEntry is always `entry` itself and this can never
      // be null.
      shore_access: shoreAccess.confidence,
      shore_entry_id: entry.id,
      // The band's own measured distance, not a recomputation from
      // classifyShoreAccess's (unrounded) distanceMiles — arrivalPoint *is*
      // the sample at nearestYards, so this is the more precise, already-
      // authoritative value rather than a second haversine calc that could
      // disagree by a rounding hair.
      shore_distance_yards: band.nearestYards,

      entryId: entry.id,
      entryName: entry.name,
      bandOrdinal: band.ordinal,
      bandLabel: band.label,
      nearestYards: band.nearestYards,
      farthestYards: band.farthestYards,
      habitatClasses: band.habitatClasses,
    };
  });
}
