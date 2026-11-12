"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SiteMap } from "@/components/site-map";
import { NearbyDiveSitesList, type SiteWithDistance } from "@/components/nearby-dive-sites-list";
import { SiteDiscoveryCandidates } from "@/components/site-discovery-candidates";
import { latestStatusPerShop, type LdsStatusRow } from "@/components/lds/lds-status";
import { useAreaResearch } from "@/hooks/use-area-research";
import { useGeolocation, type GeolocationCoords } from "@/hooks/use-geolocation";
import { useNearbySearch } from "@/hooks/use-nearby-search";
import { distanceMiles } from "@/lib/sites/distance";
import { computeMapEmptyStateMessage, matchesSiteFilters, RADIUS_OPTIONS_MILES } from "@/lib/sites/explorer-filters";
import { useExplorerPreferences } from "@/lib/sites/explorer-preferences";
import type { SiteMarker } from "@/lib/sites/types";

// Re-exported so existing imports of these helpers from this module keep working.
export * from "@/lib/sites/explorer-filters";
export { nextSearchStateFromResponse } from "@/hooks/use-nearby-search";
export { nextAiSearchStateFromResponse, type AiSearchResponse, type AiSearchState } from "@/hooks/use-area-research";

export interface DiveSiteExplorerProps {
  /** Full catalogue from the server page: shown before a location resolves, for the "All" radius, and if nearby search fails. */
  sites: SiteMarker[];
  /** Fill-station status rows; defaults to none rather than to placeholder pins. */
  ldsMarkers?: LdsStatusRow[];
  /** True when the page's own server-side `sites` read failed. */
  sitesLoadFailed?: boolean;
  /** Only used to explain that signing in unlocks the wider searches; reading site data is always public. */
  isSignedIn?: boolean;
}

/**
 * Owns the exploration state — location, radius, filters and the nearby
 * search result — once, and feeds the map and the list from that same data
 * so the two can never disagree about which sites are in view.
 */
export function DiveSiteExplorer({
  sites,
  ldsMarkers = [],
  isSignedIn = false,
  sitesLoadFailed = false,
}: DiveSiteExplorerProps) {
  const { status, coords } = useGeolocation();
  // Persisted, so leaving for a site page and coming back restores the same view.
  const {
    radiusMiles,
    siteTypeFilter,
    difficultyFilter,
    shoreAccessFilter,
    manualCenter,
    setRadiusMiles,
    setSiteTypeFilter,
    setDifficultyFilter,
    setShoreAccessFilter,
    setManualCenter,
  } = useExplorerPreferences();

  // A spot the diver picked on the map wins over geolocation until they clear it.
  const effectiveCoords = manualCenter ?? coords;
  const { search, addSite } = useNearbySearch(effectiveCoords, radiusMiles);
  const research = useAreaResearch(manualCenter);
  const aiSearch = research.aiSearch;

  function handleFetchHere(center: GeolocationCoords) {
    setManualCenter(center);
    research.reset();
  }

  function handleResetToMyLocation() {
    setManualCenter(null);
    research.reset();
  }

  // Status reports filed from a map popup this session, merged by the same
  // latest-per-shop rule the server uses, so the pin updates without a reload.
  const [ldsSubmitted, setLdsSubmitted] = useState<LdsStatusRow[]>([]);
  const currentLdsMarkers = useMemo(
    () => (ldsSubmitted.length === 0 ? ldsMarkers : latestStatusPerShop([...ldsMarkers, ...ldsSubmitted])),
    [ldsMarkers, ldsSubmitted],
  );

  const sitesWithDistance = useMemo<SiteWithDistance[] | null>(() => {
    if (!effectiveCoords) return null;
    return sites
      .map((site) => ({ site, miles: distanceMiles(effectiveCoords, site) }))
      .sort((a, b) => a.miles - b.miles);
  }, [sites, effectiveCoords]);

  // The server result is used only once it has landed for the *current*
  // radius; otherwise fall back to filtering the already-loaded catalogue.
  const searchMatchesCurrentRadius = search.radiusMiles === radiusMiles;
  const useServerResult =
    Number.isFinite(radiusMiles) && searchMatchesCurrentRadius && search.status === "done" && search.sites !== null;
  const isSearching = Number.isFinite(radiusMiles) && searchMatchesCurrentRadius && search.status === "loading";
  const searchedExternally = useServerResult && search.searchedExternally;
  const resultsTruncated = useServerResult && search.truncated;

  const clientInRadius = useMemo<SiteWithDistance[]>(() => {
    if (!sitesWithDistance) return [];
    return sitesWithDistance.filter((entry) => entry.miles <= radiusMiles);
  }, [sitesWithDistance, radiusMiles]);

  const inRadius: SiteWithDistance[] =
    useServerResult && effectiveCoords
      ? search.sites!.map((site) => ({ site, miles: distanceMiles(effectiveCoords, site) }))
      : clientInRadius;

  // Filters apply here, above both children — filtering only the list would leave stale pins on the map.
  const filters = { siteTypeFilter, difficultyFilter, shoreAccessFilter };
  const filteredInRadius = inRadius.filter((entry) => matchesSiteFilters(entry.site, filters));
  const filteredSites = sites.filter((site) => matchesSiteFilters(site, filters));

  // The map shows exactly what the list shows.
  const mapSiteMarkers =
    effectiveCoords && Number.isFinite(radiusMiles) ? filteredInRadius.map((entry) => entry.site) : filteredSites;

  const mapEmptyStateMessage = computeMapEmptyStateMessage({
    resultCount: mapSiteMarkers.length,
    hasCoords: effectiveCoords !== null,
    radiusMiles,
    ...filters,
    searchedExternally,
    isManualLocation: manualCenter !== null,
    loadFailed: sitesLoadFailed || (searchMatchesCurrentRadius && search.status === "error"),
  });

  // Web search is offered at any manually-picked location, not only where the
  // free search found nothing ("some sites here" never means "every site
  // here"); cost is bounded by the route's daily cap. The copy still differs
  // for a genuinely empty result, judged on the raw result, not the filtered one.
  const serverFoundNothingHere = manualCenter !== null && useServerResult && (search.sites?.length ?? 0) === 0;
  const webSearchAvailableHere = manualCenter !== null && useServerResult;

  return (
    <>
      <div className="flex-1">
        {manualCenter && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>Showing sites near a location you picked on the map.</span>
            <button
              type="button"
              onClick={handleResetToMyLocation}
              className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
            >
              Use my location instead
            </button>
          </div>
        )}
        <SiteMap
          ldsMarkers={currentLdsMarkers}
          siteMarkers={mapSiteMarkers}
          emptyStateMessage={mapEmptyStateMessage}
          onFetchHere={handleFetchHere}
          isFetchingHere={isSearching}
          onUseMyLocation={handleResetToMyLocation}
          isSignedIn={isSignedIn}
          onLdsSubmitted={(marker) => setLdsSubmitted((prev) => [...prev, marker])}
        />
        {resultsTruncated && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Showing the closest sites — more exist in this area than fit one search. Narrow the radius for the full
            picture.
          </p>
        )}
      </div>

      {webSearchAvailableHere && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {serverFoundNothingHere
              ? "Nothing found here yet via the free OpenStreetMap search."
              : aiSearch.status === "done"
                ? "Web-search results for this location:"
                : "Not seeing a dive site you know is here?"}
          </p>
          {!isSignedIn ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Link
                href="/login"
                className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
              >
                Sign in
              </Link>{" "}
              to also search the web for dive sites here.
            </p>
          ) : aiSearch.status === "idle" ? (
            <button
              type="button"
              onClick={research.run}
              className="mt-2 min-h-[32px] rounded-full border border-sky-600 bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-700"
            >
              Search the web for dive sites here
            </button>
          ) : aiSearch.status === "loading" ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Searching the web…</p>
          ) : aiSearch.status === "error" ? (
            <div className="mt-2">
              <p className="text-xs text-rose-700 dark:text-rose-400">{aiSearch.error}</p>
              <button
                type="button"
                onClick={research.run}
                className="mt-1 text-xs font-medium text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-400"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <SiteDiscoveryCandidates candidates={aiSearch.candidates} onAdded={addSite} />
              <button
                type="button"
                onClick={research.run}
                className="mt-3 text-xs font-medium text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
              >
                Search the web again
              </button>
            </div>
          )}
        </div>
      )}

      <NearbyDiveSitesList
        sites={filteredSites}
        status={status}
        coords={effectiveCoords}
        radiusMiles={radiusMiles}
        onRadiusChange={setRadiusMiles}
        radiusOptions={RADIUS_OPTIONS_MILES}
        isSearching={isSearching}
        inRadius={filteredInRadius}
        searchedExternally={searchedExternally}
        truncated={resultsTruncated}
        siteTypeFilter={siteTypeFilter}
        onSiteTypeFilterChange={setSiteTypeFilter}
        difficultyFilter={difficultyFilter}
        onDifficultyFilterChange={setDifficultyFilter}
        shoreAccessFilter={shoreAccessFilter}
        onShoreAccessFilterChange={setShoreAccessFilter}
        isSignedIn={isSignedIn}
      />
    </>
  );
}
