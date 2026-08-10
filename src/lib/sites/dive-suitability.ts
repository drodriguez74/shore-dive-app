/**
 * Is this site actually divable *by our divers*?
 *
 * A catalogue entry existing is not the same as it being somewhere a real
 * person can dive. The founder's framing (2026-08-09): put yourself in the
 * flippers of a diver — what are they interested in, and is the depth
 * reasonable? Our audience is Open Water and Advanced Open Water certified
 * recreational divers, not technical divers.
 *
 * That reframes what belongs on the map. Real examples from the aggregated
 * South Florida data:
 *
 * - `Caicos Express` 190–240 ft, `RBJ & Chris Corey` 200–270 ft,
 *   `Lowrance` 140–210 ft — beyond the recreational limit entirely. Showing
 *   these to an Open Water diver is at best noise and at worst an invitation.
 * - `Copenhagen` 15–30 ft, `Hall of Fame Reef` 15–30 ft — squarely Open Water.
 * - Blue Heron Bridge (~20 ft, shore entry, man-made structure) is a premier
 *   site. So "artificial" is not disqualifying — *depth and access* are what
 *   decide whether a site is relevant, not whether nature built it.
 *
 * ## About these limits
 *
 * The depths below are the widely-taught recreational training limits (PADI
 * and broadly comparable across agencies):
 *
 * - Open Water: 60 ft / 18 m
 * - Advanced Open Water: 100 ft / 30 m
 * - Recreational limit (with deep training): 130 ft / 40 m
 *
 * They are **guidance for filtering a map, not a certification ruling**. Limits
 * differ by agency, by whether a diver holds a deep specialty, and by
 * conditions. Nothing here should be rendered as "you are/aren't allowed to
 * dive this" — the honest framing is "this is within/beyond typical
 * <level> training depth", consistent with CLAUDE.md's rule against implying
 * guarantees the system can't back.
 *
 * A site is also classified on the *shallowest* depth a diver can meaningfully
 * dive it at, not its maximum: a wreck whose deck is at 60 ft and sand at
 * 100 ft is a legitimate Advanced Open Water dive, and arguably an Open Water
 * one at the deck. Judging solely on max depth would wrongly exclude it.
 */

/**
 * The least training a diver plausibly needs for a site's *shallowest* divable
 * depth.
 *
 * `deep_specialty` covers roughly 100-130 ft: past a standard Advanced Open
 * Water course, but still inside the recreational limit. It was originally
 * named `beyond_recreational`, which was actively wrong — a 110 ft site
 * reported `minimumLevel: "beyond_recreational"` and `withinRecreationalLimits:
 * true` in the same object, and got the identical label as a 240 ft technical
 * dive. Whether a site is past the recreational limit is
 * `entirelyBeyondRecreational`, never this field.
 */
export type CertificationLevel = "open_water" | "advanced_open_water" | "deep_specialty";

/** Open Water training depth — 60 ft / 18 m. */
export const OPEN_WATER_MAX_FT = 60;
/** Advanced Open Water training depth — 100 ft / 30 m. */
export const ADVANCED_OPEN_WATER_MAX_FT = 100;
/** Recreational diving limit — 130 ft / 40 m. Past this is technical diving. */
export const RECREATIONAL_MAX_FT = 130;

export interface DepthRangeFt {
  /** Shallowest divable depth, when known — a wreck's deck, a reef's top. */
  minFt: number | null;
  /** Maximum depth, when known. */
  maxFt: number | null;
}

export interface DiveSuitability {
  /** The least training a diver plausibly needs to get something out of this
   * site, based on its shallowest divable depth. */
  minimumLevel: CertificationLevel | null;
  /** True when *any* part of the site sits within recreational limits. */
  withinRecreationalLimits: boolean;
  /** True when the whole site is beyond 130 ft — technical territory, and the
   * signal to exclude it from a recreational map rather than merely tag it. */
  entirelyBeyondRecreational: boolean;
  /** Honest, renderable summary. Never phrased as permission. */
  summary: string;
}

function levelForDepth(ft: number): CertificationLevel {
  if (ft <= OPEN_WATER_MAX_FT) return "open_water";
  if (ft <= ADVANCED_OPEN_WATER_MAX_FT) return "advanced_open_water";
  return "deep_specialty";
}

export const CERTIFICATION_LABEL: Record<CertificationLevel, string> = {
  open_water: "Open Water",
  advanced_open_water: "Advanced Open Water",
  deep_specialty: "Deep specialty — beyond Advanced Open Water, still within recreational limits",
};

/**
 * Classifies a site's depth range against recreational training limits.
 *
 * Unknown depth returns `minimumLevel: null` and `withinRecreationalLimits:
 * true` — deliberately permissive. Most catalogue records have no depth, and
 * treating "we don't know" as "too deep" would silently hide real shore dives;
 * treating it as a specific level would invent information. The honest answer
 * is "depth unknown", and the caller renders that rather than a level.
 */
export function classifyDiveSuitability(depth: DepthRangeFt): DiveSuitability {
  const { minFt, maxFt } = depth;

  const shallowest = minFt ?? maxFt;
  const deepest = maxFt ?? minFt;

  if (shallowest === null || deepest === null) {
    return {
      minimumLevel: null,
      withinRecreationalLimits: true,
      entirelyBeyondRecreational: false,
      summary: "Depth not recorded — check a local source before planning this dive.",
    };
  }

  const minimumLevel = levelForDepth(shallowest);
  const entirelyBeyondRecreational = shallowest > RECREATIONAL_MAX_FT;
  const withinRecreationalLimits = !entirelyBeyondRecreational;

  let summary: string;
  if (entirelyBeyondRecreational) {
    summary = `Beyond recreational limits (${shallowest}+ ft) — technical training required.`;
  } else if (minimumLevel === "open_water") {
    summary =
      deepest > OPEN_WATER_MAX_FT
        ? `Shallowest around ${shallowest} ft (within Open Water training depth); reaches ${deepest} ft.`
        : `Within Open Water training depth (${shallowest}–${deepest} ft).`;
  } else if (minimumLevel === "advanced_open_water") {
    summary = `Within Advanced Open Water training depth (${shallowest}–${deepest} ft).`;
  } else {
    summary = `Deeper than typical Advanced Open Water training depth (${shallowest}–${deepest} ft).`;
  }

  return { minimumLevel, withinRecreationalLimits, entirelyBeyondRecreational, summary };
}

/**
 * Parses the free-text depth strings these catalogues actually ship — OSM's
 * `depth` tag and operator listings both use forms like `"25 feet"`, `"15-30
 * ft"`, `"12m"`, `"100-144 ft"`.
 *
 * Returns nulls rather than guessing on anything unrecognized. A wrong depth
 * on a dive site is worse than no depth: it feeds a certification-suitability
 * judgement a diver might rely on.
 */
export function parseDepthRangeFt(raw: string | number | null | undefined): DepthRangeFt {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? { minFt: raw, maxFt: raw } : { minFt: null, maxFt: null };
  }
  if (!raw || typeof raw !== "string") return { minFt: null, maxFt: null };

  const text = raw.trim().toLowerCase();
  // Anchored to the preceding digit, not a leading word boundary: in "12m"
  // the digit and the "m" are both word characters, so `\bm\b` never matches
  // and the value was silently read as 12 ft instead of 12 m — a ~3x depth
  // understatement on a field that feeds a certification-suitability call.
  const isMetric = /\d\s*m\b|met(?:er|re)s?/.test(text) && !/f(?:ee)?t\b|'/.test(text);
  const toFt = (n: number) => (isMetric ? Math.round(n * 3.28084) : n);

  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = toFt(parseFloat(range[1]));
    const b = toFt(parseFloat(range[2]));
    return { minFt: Math.min(a, b), maxFt: Math.max(a, b) };
  }

  const single = text.match(/(\d+(?:\.\d+)?)/);
  if (single) {
    const v = toFt(parseFloat(single[1]));
    return v > 0 ? { minFt: v, maxFt: v } : { minFt: null, maxFt: null };
  }

  return { minFt: null, maxFt: null };
}
