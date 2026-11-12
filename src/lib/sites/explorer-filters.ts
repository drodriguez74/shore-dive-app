import { classifyDiveDifficulty, DIFFICULTY_LABEL, type DifficultyLevel } from "./dive-difficulty";
import { SITE_TYPE_LABELS } from "./site-type-labels";
import type { SiteMarker, SiteType } from "./types";

/**
 * Filter vocabulary and empty-state wording shared by the map and the
 * nearby-sites list, so the two can never describe the same result set
 * differently. Pure — no React, no I/O.
 */

/** Radius choices in miles; `Infinity` is the "All" option. */
export const RADIUS_OPTIONS_MILES = [25, 50, 100, 250, Infinity] as const;

/** Largest finite radius — past it, "try expanding the radius" is no longer useful advice. */
const MAX_RADIUS_MILES = Math.max(...RADIUS_OPTIONS_MILES.filter(Number.isFinite));

export type SiteTypeFilter = SiteType | "all";
export type DifficultyFilter = DifficultyLevel | "all";

/**
 * `likely` and `marginal` shore access are one option on purpose: the chips
 * are single-select, and a diver asking "can I walk in?" wants both. The
 * finer distinction stays on the site detail page and pin sheet.
 */
export type ShoreAccessFilter = "all" | "accessible" | "boat";

export const SHORE_ACCESS_FILTER_LABEL: Record<ShoreAccessFilter, string> = {
  all: "All access",
  accessible: "Shore accessible",
  boat: "Boat access",
};

export function radiusLabel(miles: number): string {
  return Number.isFinite(miles) ? `${miles} mi` : "All";
}

/**
 * Lowercase noun-phrase prefix for empty-state copy ("shore-accessible
 * beginner reef ", or "" with no filter active), naming every active filter
 * so a message never silently drops one.
 */
export function describeActiveFilters(
  siteTypeFilter: SiteTypeFilter,
  difficultyFilter: DifficultyFilter,
  shoreAccessFilter: ShoreAccessFilter = "all",
): string {
  const parts: string[] = [];
  if (shoreAccessFilter === "accessible") parts.push("shore-accessible");
  if (shoreAccessFilter === "boat") parts.push("boat-access");
  if (difficultyFilter !== "all") parts.push(DIFFICULTY_LABEL[difficultyFilter].toLowerCase());
  if (siteTypeFilter !== "all") parts.push(SITE_TYPE_LABELS[siteTypeFilter].toLowerCase());
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

/** `null` means "not enough measured data" — such a site matches only the "all" filter, never "beginner". */
export function siteDifficultyLevel(site: SiteMarker): DifficultyLevel | null {
  return classifyDiveDifficulty(
    { latitude: site.latitude, longitude: site.longitude },
    { minFt: site.depth_min_ft ?? null, maxFt: site.depth_max_ft ?? null },
    site.site_type,
  ).level;
}

/**
 * Reads the stored `shore_access` classification rather than recomputing it
 * per pin. `null` (not yet classified) is distinct from "boat": no known
 * entry point is not evidence a site is boat-only.
 */
export function siteShoreAccessCategory(site: SiteMarker): "accessible" | "boat" | null {
  if (site.shore_access === "likely" || site.shore_access === "marginal") return "accessible";
  if (site.shore_access === "unlikely") return "boat";
  return null;
}

export interface SiteFilters {
  siteTypeFilter: SiteTypeFilter;
  difficultyFilter: DifficultyFilter;
  shoreAccessFilter: ShoreAccessFilter;
}

/** One predicate for both the map's pins and the list's rows. */
export function matchesSiteFilters(site: SiteMarker, filters: SiteFilters): boolean {
  const { siteTypeFilter, difficultyFilter, shoreAccessFilter } = filters;
  return (
    (siteTypeFilter === "all" || site.site_type === siteTypeFilter) &&
    (difficultyFilter === "all" || siteDifficultyLevel(site) === difficultyFilter) &&
    (shoreAccessFilter === "all" || siteShoreAccessCategory(site) === shoreAccessFilter)
  );
}

export interface MapEmptyStateParams extends SiteFilters {
  resultCount: number;
  hasCoords: boolean;
  radiusMiles: number;
  searchedExternally: boolean;
  /** The site data couldn't be loaded — an empty map then means "unknown", never "none here". */
  loadFailed?: boolean;
  /** The search centre is a spot the diver picked on the map, so copy says "this location". */
  isManualLocation?: boolean;
}

export const MAP_LOAD_FAILED_MESSAGE =
  "Couldn't load dive sites right now — the site database is unreachable. This doesn't mean there are none here; try again shortly.";

/**
 * Explains an empty map in words, so a genuine "nothing nearby" never looks
 * like a failure (or vice versa). Returns `null` when there is nothing to
 * explain: results exist, no location yet, or the radius is "All". It never
 * asserts *why* an external search didn't run — the response doesn't say.
 */
export function computeMapEmptyStateMessage(params: MapEmptyStateParams): string | null {
  const {
    resultCount,
    hasCoords,
    radiusMiles,
    siteTypeFilter,
    difficultyFilter,
    shoreAccessFilter,
    searchedExternally,
    isManualLocation = false,
    loadFailed = false,
  } = params;

  if (resultCount > 0) return null;
  if (loadFailed) return MAP_LOAD_FAILED_MESSAGE;
  if (!hasCoords || !Number.isFinite(radiusMiles)) return null;

  const noFilterActive = siteTypeFilter === "all" && difficultyFilter === "all" && shoreAccessFilter === "all";
  const canExpand = radiusMiles < MAX_RADIUS_MILES;
  const locationPhrase = isManualLocation ? "this location" : "your location";

  if (!noFilterActive) {
    const suffix = canExpand ? " Try expanding the radius or clearing filters." : "";
    return `No ${describeActiveFilters(siteTypeFilter, difficultyFilter, shoreAccessFilter)}sites within ${radiusLabel(radiusMiles)} of ${locationPhrase}.${suffix}`;
  }

  if (searchedExternally) {
    return `Checked OpenStreetMap too — no dive sites within ${radiusLabel(radiusMiles)} of ${locationPhrase}.`;
  }

  const suffix = canExpand ? " Try expanding the radius — the app has sites well outside this range." : "";
  return `No dive sites within ${radiusLabel(radiusMiles)} of ${locationPhrase}.${suffix}`;
}
