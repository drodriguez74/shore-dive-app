"use client";

import { useEffect, useMemo, useState } from "react";
import { SiteMap } from "@/components/site-map";
import { NearbyDiveSitesList, type SiteWithDistance } from "@/components/nearby-dive-sites-list";
import { MOCK_LDS_MARKERS } from "@/components/lds/lds-status";
import { useGeolocation, type GeolocationCoords } from "@/hooks/use-geolocation";
import { distanceMiles } from "@/lib/sites/distance";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import { useExplorerPreferences } from "@/lib/sites/explorer-preferences";
import { classifyDiveDifficulty, DIFFICULTY_LABEL, type DifficultyLevel } from "@/lib/sites/dive-difficulty";
import { SITE_TYPE_LABELS } from "@/lib/sites/site-type-labels";
import type { SiteMarker, SiteType } from "@/lib/sites/types";

// Declared this early specifically so `MAX_RADIUS_MILES` below (used by
// `computeMapEmptyStateMessage`) can reference it — both are top-level
// `const`s evaluated once at module load in file order, and this one has to
// exist before anything reads from it, or it throws (temporal dead zone),
// not just returns `undefined`.
const RADIUS_OPTIONS_MILES = [25, 50, 100, 250, Infinity] as const;

/** `"all"` is the default/no-filter state — every `SiteType` value plus
 * this sentinel, never a real 7th type. */
export type SiteTypeFilter = SiteType | "all";

/** `"all"` is the default/no-filter state (T21.26), mirroring `SiteTypeFilter`
 * above. Deliberately does NOT add a distinct "no data" filter value —
 * `classifyDiveDifficulty()`'s own `level: null` already means "not enough
 * measured signal", and a `DifficultyFilter` value has to be something a
 * diver can *select*, not a classifier output. See `siteDifficultyLevel`
 * below for how the two meet: a `null`-level site matches only `"all"`. */
export type DifficultyFilter = DifficultyLevel | "all";

/** Moved here from `nearby-dive-sites-list.tsx` (2026-08-10) so `SiteMap`'s
 * own empty-state messaging — see `mapEmptyStateMessage` below — can share
 * the exact wording the list already uses, rather than drifting into a
 * second, slightly different phrasing. `nearby-dive-sites-list.tsx` already
 * imports `siteDifficultyLevel` from this file for the identical reason (one
 * shared source of truth for state this component owns); importing the
 * reverse direction from the list into this file would have created a
 * circular import. */
export function radiusLabel(miles: number): string {
  return Number.isFinite(miles) ? `${miles} mi` : "All";
}

/** Builds a lowercase noun-phrase prefix ("beginner reef ", "advanced ",
 * "cave ", or "" when no filter is active) for empty-state copy — one helper
 * so a diver filtering by *both* difficulty and type sees an accurate
 * combined description ("No beginner reef sites…") rather than a message
 * that silently drops one active filter. Difficulty reads first (the
 * sentence conventionally goes adjective-then-noun: "beginner reef", not
 * "reef beginner"). */
export function describeActiveFilters(siteTypeFilter: SiteTypeFilter, difficultyFilter: DifficultyFilter): string {
  const parts: string[] = [];
  if (difficultyFilter !== "all") parts.push(DIFFICULTY_LABEL[difficultyFilter].toLowerCase());
  if (siteTypeFilter !== "all") parts.push(SITE_TYPE_LABELS[siteTypeFilter].toLowerCase());
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

/**
 * Largest *finite* radius option — the point past which "try expanding"
 * stops being useful advice. Deliberately not just
 * `RADIUS_OPTIONS_MILES[RADIUS_OPTIONS_MILES.length - 1]`: that array's own
 * last element is `Infinity` (the "All" option), and a bare last-element read
 * picked it up here first, making `radiusMiles < MAX_RADIUS_MILES` true for
 * every finite radius — so the "you're already at the max, stop suggesting
 * you expand" case could never actually fire for the real largest numbered
 * option (250 mi). Caught by a test asserting the suffix drops off at 250 mi,
 * which it didn't. `Number.isFinite` filters `Infinity` out before the max.
 */
const MAX_RADIUS_MILES = Math.max(...RADIUS_OPTIONS_MILES.filter(Number.isFinite));

export interface MapEmptyStateParams {
  resultCount: number;
  hasCoords: boolean;
  radiusMiles: number;
  siteTypeFilter: SiteTypeFilter;
  difficultyFilter: DifficultyFilter;
  searchedExternally: boolean;
}

/**
 * Founder-reported bug (2026-08-10): the map's pins render fine on first
 * paint (`filteredSites`, before geolocation resolves), then silently vanish
 * moments later once real geolocation resolves and `mapSiteMarkers` swaps to
 * the — possibly empty — radius-filtered set. With no on-map explanation, a
 * correct "you genuinely have no nearby sites" result and an actual failure
 * looked identical: a map that goes blank right after load. Extracted as its
 * own pure function (rather than left inline in the component body) so this
 * decision tree — four real branches, easy to get subtly wrong — is
 * unit-testable without mounting `DiveSiteExplorer`, which needs geolocation
 * and `fetch` mocked to render at all.
 *
 * `NearbyDiveSitesList` already explains this exact situation in words ("No
 * sites within 25 mi of your location yet"); this mirrors that same wording
 * via the shared `radiusLabel`/`describeActiveFilters` helpers above, so the
 * map says the same thing rather than a second, possibly-drifting phrasing.
 *
 * Returns `null` whenever there's nothing to explain: results exist, coords
 * haven't resolved yet (still showing the full fallback set), or the radius
 * is "All" (an empty *global* result is a real, different situation this
 * function doesn't claim to explain — "All" has no larger radius to suggest
 * expanding to).
 */
export function computeMapEmptyStateMessage(params: MapEmptyStateParams): string | null {
  const { resultCount, hasCoords, radiusMiles, siteTypeFilter, difficultyFilter, searchedExternally } = params;

  if (resultCount > 0 || !hasCoords || !Number.isFinite(radiusMiles)) return null;

  const noFilterActive = siteTypeFilter === "all" && difficultyFilter === "all";
  const canExpand = radiusMiles < MAX_RADIUS_MILES;

  if (!noFilterActive) {
    const suffix = canExpand ? " Try expanding the radius or clearing filters." : "";
    return `No ${describeActiveFilters(siteTypeFilter, difficultyFilter)}sites within ${radiusLabel(radiusMiles)} of your location.${suffix}`;
  }

  if (searchedExternally) {
    return `Checked OpenStreetMap too — no dive sites within ${radiusLabel(radiusMiles)} of your location.`;
  }

  const suffix = canExpand ? " Try expanding the radius — the app has sites well outside this range." : "";
  return `No dive sites within ${radiusLabel(radiusMiles)} of your location.${suffix}`;
}

/**
 * `classifyDiveDifficulty()` runs entirely off fields already present on
 * every `SiteMarker` in view (`latitude`/`longitude`, `depth_min_ft`/
 * `depth_max_ft`, `site_type` — see `SITE_MARKER_COLUMNS` in `queries.ts`),
 * so this is a pure client-side derivation, no new query or migration. One
 * shared helper (exported, imported by `nearby-dive-sites-list.tsx` for its
 * badge) so the filter here and the badge there can never independently
 * mis-derive the same value from the same site — mirrors why
 * `queries.ts`'s `normalizeMarker()` exists as a single mapping instead of
 * two hand-written copies.
 */
export function siteDifficultyLevel(site: SiteMarker): DifficultyLevel | null {
  return classifyDiveDifficulty(
    { latitude: site.latitude, longitude: site.longitude },
    { minFt: site.depth_min_ft ?? null, maxFt: site.depth_max_ft ?? null },
    site.site_type,
  ).level;
}

interface SearchNearbyResponse {
  sites: SiteMarker[];
  error: string | null;
  searchedExternally: boolean;
}

/** Same shape/reasoning `nearby-dive-sites-list.tsx` documented before
 * T21.6 moved this state up — see that file's git history / this
 * component's own comments below for why `radiusMiles` is tagged onto the
 * state instead of trusted implicitly. */
interface SearchNearbyState {
  status: "idle" | "loading" | "done" | "error";
  sites: SiteMarker[] | null;
  searchedExternally: boolean;
  radiusMiles: number | null;
}

const IDLE_SEARCH_STATE: SearchNearbyState = {
  status: "idle",
  sites: null,
  searchedExternally: false,
  radiusMiles: null,
};

export interface DiveSiteExplorerProps {
  /** Full, unfiltered `sites` fetch from the Server Component page that
   * renders this wrapper (`src/app/page.tsx`, T11.5/Task 21) — the
   * fallback/initial content before geolocation resolves, when the radius
   * is "All", and if the search-nearby fetch fails. Same fallback contract
   * `NearbyDiveSitesList` had pre-T21.6, just now owned up here instead. */
  sites: SiteMarker[];
  /** Resolved server-side by `src/app/page.tsx`. Used only to explain the
   * `T21.13` auth gate in the empty state — being signed in is what unlocks
   * the OpenStreetMap search, and without saying so an anonymous diver in a
   * new area hits a silent dead end ("no dive sites near you", no hint that
   * more are findable). Never gates *reading* site data, which stays public. */
  isSignedIn?: boolean;
}

/**
 * T21.6 (plan.md Resolved Decision #8) — shared radius-driven state between
 * the map and the nearby-sites list.
 *
 * Before this component existed, the radius `<select>` lived inside
 * `NearbyDiveSitesList` and only ever affected that component's own
 * rendered rows — `SiteMap` always received the full, unfiltered `sites`
 * prop regardless of the selected radius, so changing the radius visibly
 * updated the list but never moved a single map pin. This component owns
 * geolocation resolution, the selected radius, and the `/api/sites/search-
 * nearby` (T21.3) result set exactly ONCE, and feeds both `SiteMap` and
 * `NearbyDiveSitesList` from that same data — the fetch/state logic below
 * is moved wholesale from the pre-T21.6 `NearbyDiveSitesList` (not
 * duplicated), which is now a simpler presentational component driven
 * entirely by props (see its own header comment).
 *
 * Deliberately sequenced with T21.7 (GeoJSON Source + symbol Layer
 * migration, plan.md Resolved Decision #9) per TASKS.md's own text — a
 * radius change now just re-passes a new `siteMarkers` array into `SiteMap`,
 * which turns into a cheap GeoJSON `setData()` call under the symbol-layer
 * migration rather than tearing down/rebuilding hundreds of `<Marker>` DOM
 * nodes on every radius change.
 *
 * `src/hooks/use-geolocation.ts`'s hydration-mismatch lesson still applies
 * here: nothing in this component branches a `useState` initializer on
 * `typeof navigator`/`typeof window` — `useGeolocation()` already handles
 * that correctly, and every value derived from its result is computed in
 * effects/render, never in an initializer that could disagree between the
 * server render and the client's first paint.
 *
 * `SiteMap` keeps its own internal `useGeolocation()` call for the
 * map-recenter `flyTo` behavior (`T11.5.8`) — that's a separate, already-
 * working concern this task explicitly doesn't touch, so it's left as its
 * own independent hook call rather than threaded through here too (same
 * duplication that already existed pre-T21.6 between `SiteMap` and
 * `NearbyDiveSitesList`, just relocated, not introduced by this change).
 */
export function DiveSiteExplorer({ sites, isSignedIn = false }: DiveSiteExplorerProps) {
  const { status, coords } = useGeolocation();
  // Radius + site-type filter persist across navigation (reported 2026-08-09:
  // browsing to a site detail page and back silently reset both). Same
  // localStorage-backed external store the map's viewport uses, so all three
  // pieces of exploration state restore together rather than partially.
  const {
    radiusMiles,
    siteTypeFilter,
    difficultyFilter,
    setRadiusMiles,
    setSiteTypeFilter,
    setDifficultyFilter,
  } = useExplorerPreferences();
  const [search, setSearch] = useState<SearchNearbyState>(IDLE_SEARCH_STATE);

  // Fires only when real coordinates first resolve, or when the radius
  // selector actually changes value — see `nearby-dive-sites-list.tsx`'s
  // pre-T21.6 version for the original, identical reasoning (moved here
  // verbatim, not rewritten). The "All" radius is deliberately never sent
  // to the route — there's no sensible finite value to send, and "show
  // everything already known" is exactly what client-side filtering below
  // already does correctly.
  useEffect(() => {
    if (!coords || !Number.isFinite(radiusMiles)) return;

    const controller = new AbortController();
    // Deferred via setTimeout, same react-hooks/set-state-in-effect reason
    // documented at length in media-embed.tsx and use-geolocation.ts —
    // functionally still immediate, just outside the effect's own
    // synchronous body.
    const loadingTimer = setTimeout(() => {
      setSearch({ status: "loading", sites: null, searchedExternally: false, radiusMiles });
    }, 0);

    (async (resolvedCoords: GeolocationCoords) => {
      try {
        const params = new URLSearchParams({
          lat: String(resolvedCoords.latitude),
          lng: String(resolvedCoords.longitude),
          radiusMiles: String(radiusMiles),
        });
        const response = await fetch(`/api/sites/search-nearby?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`search-nearby responded ${response.status}`);
        }
        const data = (await response.json()) as SearchNearbyResponse;
        setSearch({ status: "done", sites: data.sites, searchedExternally: data.searchedExternally, radiusMiles });
      } catch (error) {
        if (controller.signal.aborted) return;
        // Nice-to-have enhancement, not a page-breaking dependency — log for
        // field debugging (CLAUDE.md: many failures happen offline, at
        // remote sites, after the fact) and fall back to client-side
        // filtering of the `sites` prop below. Never surface this as an
        // error state to the diver.
        logger.warn("nearby_search_fetch_failed", { message: errorMessage(error) });
        setSearch({ status: "error", sites: null, searchedExternally: false, radiusMiles });
      }
    })(coords);

    return () => {
      controller.abort();
      clearTimeout(loadingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.latitude, coords?.longitude, radiusMiles]);

  const sitesWithDistance = useMemo<SiteWithDistance[] | null>(() => {
    if (!coords) return null;
    return sites.map((site) => ({ site, miles: distanceMiles(coords, site) })).sort((a, b) => a.miles - b.miles);
  }, [sites, coords]);

  // Prefer the real server search result (T21.3 — local-first, on-demand
  // Overpass fallback) once it's actually landed for the *current* radius.
  // Everything else (pending geolocation-resolved-but-fetch-not-done-yet,
  // radius is "All", or the fetch failed) falls back to client-side
  // filtering of the already-fetched `sites` prop — same content this panel
  // always rendered pre-T21.4, never a worse state than that.
  const searchMatchesCurrentRadius = search.radiusMiles === radiusMiles;
  const useServerResult =
    Number.isFinite(radiusMiles) && searchMatchesCurrentRadius && search.status === "done" && search.sites !== null;
  const isSearching = Number.isFinite(radiusMiles) && searchMatchesCurrentRadius && search.status === "loading";
  const searchedExternally = useServerResult && search.searchedExternally;

  const clientInRadius = useMemo<SiteWithDistance[]>(() => {
    if (!sitesWithDistance) return [];
    return sitesWithDistance.filter((entry) => entry.miles <= radiusMiles);
  }, [sitesWithDistance, radiusMiles]);

  const inRadius: SiteWithDistance[] =
    useServerResult && coords
      ? search.sites!.map((site) => ({ site, miles: distanceMiles(coords, site) }))
      : clientInRadius;

  // Filter-by-type (2026-08-09, founder: "we can have tags in the dive
  // sites and be able to filter by tag"), built on the existing `site_type`
  // axis rather than a new schema — no new migration needed. Deliberately
  // applied at this shared level, not inside either child component, for
  // the exact same reason T21.6 lifted radius state up here: a filter that
  // only touched the list would silently leave stale, filtered-out pins on
  // the map, recreating the bug this component exists to prevent.

  const matchesType = (site: SiteMarker) => siteTypeFilter === "all" || site.site_type === siteTypeFilter;

  // Filter-by-difficulty (T21.26, founder ask: make `classifyDiveDifficulty`
  // — already wired into the site detail page — usable while browsing the
  // map/list too). Applied at this same shared level as the type filter,
  // for the identical reason: a filter that only touched the list would
  // silently leave stale, filtered-out pins on the map.
  //
  // **Decision on `level: null` sites** (classifier's own honest "not enough
  // measured data" state, distinct from an actual `beginner` classification):
  // they show only under the "all" filter and are excluded from all four
  // named difficulty filters. A `null`-level site never equals a specific
  // `DifficultyFilter` string, so this falls out of a plain equality check
  // rather than needing a special case — but the *absence* of a special case
  // is itself the deliberate choice: a `null`-level site must never be
  // silently swept into "beginner" (the lowest band) just because it's the
  // most permissive-looking bucket, nor hidden under every filter as if it
  // didn't exist. "All" is where it remains visible; the list badge (see
  // `nearby-dive-sites-list.tsx`) renders nothing for it rather than a
  // misleading placeholder, so "no data" is never confused with a real level.
  const matchesDifficulty = (site: SiteMarker) =>
    difficultyFilter === "all" || siteDifficultyLevel(site) === difficultyFilter;

  const filteredInRadius = inRadius.filter((entry) => matchesType(entry.site) && matchesDifficulty(entry.site));
  const filteredSites = sites.filter((site) => matchesType(site) && matchesDifficulty(site));

  // T21.6's actual fix: the site set fed to the map. Once geolocation has
  // resolved and a finite radius is selected, the map's pins are exactly
  // the same set the list below renders (server result or client-filtered
  // fallback, whichever `inRadius` above resolved to, then type- and
  // difficulty-filtered) — this is the shared data source that didn't exist
  // before this task. Before coordinates resolve, or when the radius is
  // "All", both the map and the list fall back to the same full, unfiltered
  // (except by type/difficulty) `sites` prop (never a worse state than what
  // either component showed pre-T21.6). Per CLAUDE.md's pin-visuals scope
  // note: difficulty is filter-only here, never a pin color/icon dimension —
  // `mapSiteMarkers` just narrows which pins render, `SiteMap`/`pin-icons.ts`
  // are otherwise untouched.
  const mapSiteMarkers =
    coords && Number.isFinite(radiusMiles) ? filteredInRadius.map((entry) => entry.site) : filteredSites;

  const mapEmptyStateMessage = computeMapEmptyStateMessage({
    resultCount: mapSiteMarkers.length,
    hasCoords: coords !== null,
    radiusMiles,
    siteTypeFilter,
    difficultyFilter,
    searchedExternally,
  });

  return (
    <>
      <div className="flex-1">
        <SiteMap ldsMarkers={MOCK_LDS_MARKERS} siteMarkers={mapSiteMarkers} emptyStateMessage={mapEmptyStateMessage} />
      </div>

      <NearbyDiveSitesList
        sites={filteredSites}
        status={status}
        coords={coords}
        radiusMiles={radiusMiles}
        onRadiusChange={setRadiusMiles}
        radiusOptions={RADIUS_OPTIONS_MILES}
        isSearching={isSearching}
        inRadius={filteredInRadius}
        searchedExternally={searchedExternally}
        siteTypeFilter={siteTypeFilter}
        onSiteTypeFilterChange={setSiteTypeFilter}
        difficultyFilter={difficultyFilter}
        onDifficultyFilterChange={setDifficultyFilter}
        isSignedIn={isSignedIn}
      />
    </>
  );
}
