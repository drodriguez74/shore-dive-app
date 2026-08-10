/**
 * Cross-source dive-site deduplication.
 *
 * Aggregating multiple catalogues (OpenStreetMap, Florida FWC's artificial
 * reef program, operator-published site lists) means the same physical wreck
 * or reef arrives more than once, under different names and with coordinates
 * that disagree by tens or hundreds of metres. Rendered naively that becomes
 * two pins on top of each other, which reads as "this map is wrong" faster
 * than almost any other defect.
 *
 * ## Why this is a graph problem, not a sort
 *
 * "Is A the same site as B" is a *pairwise* judgement, but sameness has to be
 * transitive to be useful: if a FWC record matches an OSM node, and that OSM
 * node matches an operator listing, all three are one site even if the FWC and
 * operator records never directly matched each other. That's exactly
 * connected components over a graph whose edges are "probably the same" — so
 * that's what this module builds (union-find rather than an adjacency list,
 * since we only ever need the components, never the paths).
 *
 * ## Why coordinates alone are not enough — in both directions
 *
 * Too-loose distance merges genuinely distinct sites: real Broward data has
 * separate named vessels deliberately sunk within a few hundred metres of each
 * other as one "rodeo" site (RODEO 25, RODEO SITE - RENEGADE, RODEO SITE -
 * MILLER LITE). Those are different dives at different depths and must stay
 * separate.
 *
 * Too-tight distance fails to merge records that *are* the same: FWC's own
 * metadata warns its positions are largely unverified historical data, and OSM
 * positions are community-placed, so the same wreck can legitimately differ by
 * 100m+ between sources.
 *
 * Name alone is worse: "MERCEDES" / "MERCEDES I", "Eternal Reef" / "Eternal
 * Reefs" / "C2-Eternal Reef" are the same thing, while "Wreck Trek Boca" and
 * "Wreck Trek Deerfield" share most of their tokens and are ~8km apart.
 *
 * So the predicate is deliberately two-tier (see `areSameSite`): a tight
 * radius merges on proximity alone, and a wider radius additionally demands
 * name agreement. The tight tier is what keeps transitive chaining from
 * walking along a line of closely-spaced distinct sites and collapsing them
 * into one blob.
 */

import { distanceMiles, type LatLng } from "./distance";

/** Below this, two records are treated as the same physical feature even if
 * their names disagree entirely — at this range they cannot be separate dive
 * destinations, and disagreeing names are far more likely to be the same
 * object catalogued differently ("MERCEDES" vs "MERCEDES I"). ~40m. */
export const SAME_POINT_MILES = 0.025;

/** Between `SAME_POINT_MILES` and this, records merge only if their names also
 * agree. Wide enough to absorb the coordinate drift FWC itself warns about
 * between independently-surveyed catalogues, tight enough that two distinct
 * named wrecks in the same deployment area stay separate. ~400m. */
export const NEARBY_MILES = 0.25;

/** Dice coefficient over normalized name tokens required to call two names
 * the same within `NEARBY_MILES`. */
export const NAME_SIMILARITY_THRESHOLD = 0.6;

/** Tokens that carry no identifying signal — dropped before comparison so
 * "Okinawa Reef" and "Okinawa" agree, and "Rodeo Site - Renegade" reduces to
 * the part that actually distinguishes it. */
const NOISE_TOKENS = new Set([
  "reef",
  "reefs",
  "wreck",
  "wrecks",
  "site",
  "sites",
  "dive",
  "the",
  "of",
  "and",
  "artificial",
  "ledge",
  "ss",
  "mv",
  "usns",
  "uss",
]);

/**
 * Trailing *roman* numerals are dropped: "Mercedes I" and "Mercedes" are one
 * wreck.
 *
 * Arabic digits are deliberately NOT stripped, which an earlier version got
 * wrong and a test caught: stripping them reduced "RODEO 25" to just
 * ["rodeo"], which then scored 0.67 against "RODEO SITE - RENEGADE" and merged
 * two genuinely distinct Broward wrecks into one pin. Roman numerals are a
 * vessel-name suffix convention; arabic numbers are usually part of the
 * identifying name ("Rodeo 25", "Pompano 3rd Reef"), so they carry signal and
 * must survive normalization.
 */
const TRAILING_ROMAN_NUMERAL = /\s+[ivx]+$/i;

export function normalizeSiteName(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(TRAILING_ROMAN_NUMERAL, "");

  const tokens = cleaned.split(" ").filter((t) => t.length > 0 && !NOISE_TOKENS.has(t));
  // If stripping noise left nothing (e.g. a site literally named "The Reef"),
  // fall back to the un-stripped tokens rather than matching everything.
  return tokens.length > 0 ? tokens : cleaned.split(" ").filter(Boolean);
}

/**
 * Dice coefficient over token sets. Chosen over raw string edit distance
 * because these names differ by whole words far more often than by typos
 * ("Captain Dan" vs "Captain Dan Garnsey"), and over Jaccard because Dice is
 * more forgiving when one source appends qualifiers the other omits.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeSiteName(a));
  const tb = new Set(normalizeSiteName(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return (2 * shared) / (ta.size + tb.size);
}

export interface DedupeCandidate extends LatLng {
  /** Stable id within the input set — used only to report clusters back. */
  id: string;
  name: string;
}

/** The pairwise "same site?" judgement. Exported so the threshold behavior is
 * directly testable rather than only observable through clustering. */
export function areSameSite(a: DedupeCandidate, b: DedupeCandidate): boolean {
  const miles = distanceMiles(a, b);
  if (miles <= SAME_POINT_MILES) return true;
  if (miles > NEARBY_MILES) return false;
  return nameSimilarity(a.name, b.name) >= NAME_SIMILARITY_THRESHOLD;
}

/** Union-find with path compression. Only the components matter, so this is
 * cheaper and simpler than materialising the adjacency graph. */
class DisjointSet {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Groups candidates into clusters of "same physical site". Returns arrays of
 * the original candidates, one array per distinct site, order-stable so a
 * repeated run over the same input produces the same grouping (which matters:
 * these clusters drive what gets written to the database).
 *
 * O(n²) pairwise. Deliberate: the real input is a few thousand records for a
 * whole region, run offline during curation rather than per-request, and an
 * exact answer at that size beats a spatial index that would need its own
 * correctness argument. Revisit if this ever runs against a national dataset.
 */
export function clusterSites(candidates: DedupeCandidate[]): DedupeCandidate[][] {
  const ds = new DisjointSet(candidates.length);

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (areSameSite(candidates[i], candidates[j])) ds.union(i, j);
    }
  }

  const byRoot = new Map<number, DedupeCandidate[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = ds.find(i);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(candidates[i]);
    else byRoot.set(root, [candidates[i]]);
  }
  return [...byRoot.values()];
}
