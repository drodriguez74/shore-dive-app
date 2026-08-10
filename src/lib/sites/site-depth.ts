/**
 * Resolves the depth of a `sites` row from whatever the runtime actually has
 * (T21.22, for the site detail page's depth/certification section).
 *
 * This module exists because of a real, temporary mismatch between the schema
 * and the live database, and it is written to be correct on both sides of it:
 *
 * - `depth_min_ft` / `depth_max_ft` are being added to `sites` by migration
 *   `0012` in a parallel piece of work, and **are not applied to the live
 *   database yet**. `SITE_DETAIL_COLUMNS` in `queries.ts` also names its
 *   columns explicitly, so those fields won't even be selected until that
 *   query is updated. Every read of them here is therefore defensive — they
 *   are optional, possibly-absent, possibly-string (PostgREST can serialize
 *   Postgres `numeric` as JSON strings, the same reason `queries.ts` carries a
 *   `toNumber` helper) — and their absence is an ordinary code path, not an
 *   error.
 * - Until then the only depth that exists at runtime is the one
 *   `src/lib/sites/osm-import.ts` writes into `sites.description` as its own
 *   `"Reported depth: <raw>."` line. That line is machine-written by this
 *   codebase in a known, fixed shape, so reading it back is a parse of our own
 *   output rather than prose mining — the regex below is anchored to the start
 *   of a line and matches nothing else in a description.
 *
 * **Why this is separated from the free-text depth parsing itself:**
 * `parseDepthRangeFt` (`./dive-suitability.ts`) already owns turning `"15-30
 * ft"` / `"12m"` into feet, and is deliberately conservative about it (returns
 * nulls rather than guessing, because a wrong depth feeds a certification
 * judgement a diver might rely on). This module only decides *where the raw
 * depth string comes from*; it never invents a number of its own.
 *
 * The `source` field is part of the contract, not debug output: a depth read
 * out of unreviewed imported text is a weaker claim than a depth in a column,
 * and the UI is expected to say so rather than present them identically
 * (CLAUDE.md — never let a UI imply a guarantee the system can't back).
 */

import { parseDepthRangeFt, type DepthRangeFt } from "./dive-suitability";

/**
 * The subset of a site row this module reads. Deliberately structural and
 * fully optional rather than `Site` from `./types.ts`: the depth columns are
 * not on that type yet (migration `0012`, in flight elsewhere), and this must
 * compile and behave correctly both before and after they are.
 */
export interface DepthCarryingSite {
  description?: string | null;
  depth_min_ft?: number | string | null;
  depth_max_ft?: number | string | null;
}

/** Where the resolved depth actually came from. `"none"` means no depth is
 * known — which the UI must render as "not recorded", never as a level. */
export type SiteDepthSource = "column" | "description" | "none";

export interface ResolvedSiteDepth extends DepthRangeFt {
  source: SiteDepthSource;
  /** The raw text a `"description"`-sourced depth was read from (e.g.
   * `"15-30 ft"`), so the UI can show the diver the original wording instead
   * of only our interpretation of it. `null` for every other source. */
  rawText: string | null;
}

const NO_DEPTH: ResolvedSiteDepth = { minFt: null, maxFt: null, source: "none", rawText: null };

/**
 * The `"Reported depth: ..."` line `buildOsmDescription()` writes. Anchored to
 * a line start (`m` flag) so it can only match that generated line and never a
 * phrase inside the source's own free-text description — which routinely
 * mentions depths in prose ("rests ... in 25 feet of water about 150 yards
 * offshore") that must not be mistaken for a structured field.
 */
const REPORTED_DEPTH_LINE = /^Reported depth:[ \t]*(.+?)\.?[ \t]*$/im;

/** Coerces a possibly-string, possibly-absent numeric column to a usable
 * positive depth in feet, or `null`. Rejects non-finite and non-positive
 * values outright: a 0 ft or NaN "depth" is worse than no depth, because it
 * would silently classify a site as Open Water. */
function toDepthFt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

/**
 * Best available depth for a site, in feet.
 *
 * Preference order is columns first, then the imported description line, then
 * nothing. Columns win because they're structured and (once `0012` lands) the
 * field a human or a reviewed import writes deliberately; the description line
 * is a fallback read of unreviewed imported text.
 *
 * Never throws and never guesses — an unparseable or absent depth returns
 * `source: "none"` with both bounds `null`, which `classifyDiveSuitability`
 * already handles as "depth unknown" rather than as a certification level.
 */
export function resolveSiteDepthFt(site: DepthCarryingSite | null | undefined): ResolvedSiteDepth {
  if (!site) return NO_DEPTH;

  const columnMin = toDepthFt(site.depth_min_ft);
  const columnMax = toDepthFt(site.depth_max_ft);
  if (columnMin !== null || columnMax !== null) {
    // Order the pair defensively: nothing guarantees a row's min is actually
    // shallower than its max, and `classifyDiveSuitability` reads `minFt` as
    // "shallowest divable depth" — an inverted pair would classify a site by
    // its deepest point and wrongly push it out of recreational range.
    if (columnMin !== null && columnMax !== null) {
      return {
        minFt: Math.min(columnMin, columnMax),
        maxFt: Math.max(columnMin, columnMax),
        source: "column",
        rawText: null,
      };
    }
    return { minFt: columnMin, maxFt: columnMax, source: "column", rawText: null };
  }

  const description = typeof site.description === "string" ? site.description : null;
  if (!description) return NO_DEPTH;

  const match = REPORTED_DEPTH_LINE.exec(description);
  if (!match) return NO_DEPTH;

  const rawText = match[1].trim();
  const parsed = parseDepthRangeFt(rawText);
  if (parsed.minFt === null && parsed.maxFt === null) return NO_DEPTH;

  return { ...parsed, source: "description", rawText };
}
