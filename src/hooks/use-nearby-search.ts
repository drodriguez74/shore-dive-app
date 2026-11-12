"use client";

import { useCallback, useEffect, useState } from "react";
import type { GeolocationCoords } from "@/hooks/use-geolocation";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import type { SiteMarker } from "@/lib/sites/types";

export interface SearchNearbyResponse {
  sites: SiteMarker[];
  error: string | null;
  searchedExternally: boolean;
  /** The server hit its row cap — more matching sites exist than were returned. */
  truncated?: boolean;
}

export interface SearchNearbyState {
  status: "idle" | "loading" | "done" | "error";
  sites: SiteMarker[] | null;
  searchedExternally: boolean;
  /** The radius this state was produced for; a result for another radius is stale. */
  radiusMiles: number | null;
  truncated: boolean;
}

const IDLE_SEARCH_STATE: SearchNearbyState = {
  status: "idle",
  sites: null,
  searchedExternally: false,
  radiusMiles: null,
  truncated: false,
};

/**
 * The route answers HTTP 200 with `error` set when its own database read
 * failed. That must become an error state, never "done, zero sites" — a
 * backend failure is not "no sites here".
 */
export function nextSearchStateFromResponse(data: SearchNearbyResponse, radiusMiles: number): SearchNearbyState {
  if (data.error) {
    return { status: "error", sites: null, searchedExternally: false, radiusMiles, truncated: false };
  }
  return {
    status: "done",
    sites: data.sites,
    searchedExternally: data.searchedExternally,
    radiusMiles,
    truncated: data.truncated ?? false,
  };
}

/**
 * Runs `/api/sites/search-nearby` whenever the search centre or a finite
 * radius changes. The "All" radius is never sent — callers fall back to the
 * already-loaded catalogue for it, as they do on any failure.
 */
export function useNearbySearch(center: GeolocationCoords | null, radiusMiles: number) {
  const [search, setSearch] = useState<SearchNearbyState>(IDLE_SEARCH_STATE);

  // A page restored from the back/forward cache is not remounted, so a fetch
  // aborted on the way out would never re-run; a persisted `pageshow` forces one.
  const [restoreNonce, setRestoreNonce] = useState(0);
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setRestoreNonce((n) => n + 1);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const latitude = center?.latitude;
  const longitude = center?.longitude;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined || !Number.isFinite(radiusMiles)) return;

    const controller = new AbortController();
    // Deferred so the effect body itself sets no state (react-hooks/set-state-in-effect).
    const loadingTimer = setTimeout(() => {
      setSearch({ status: "loading", sites: null, searchedExternally: false, radiusMiles, truncated: false });
    }, 0);

    void (async () => {
      try {
        const params = new URLSearchParams({
          lat: String(latitude),
          lng: String(longitude),
          radiusMiles: String(radiusMiles),
        });
        const response = await fetch(`/api/sites/search-nearby?${params.toString()}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`search-nearby responded ${response.status}`);
        const data = (await response.json()) as SearchNearbyResponse;
        const nextState = nextSearchStateFromResponse(data, radiusMiles);
        if (nextState.status === "error") logger.warn("nearby_search_returned_error", { message: data.error });
        // A result that beats the deferred "loading" update must not be overwritten by it.
        clearTimeout(loadingTimer);
        setSearch(nextState);
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.warn("nearby_search_fetch_failed", { message: errorMessage(error) });
        clearTimeout(loadingTimer);
        setSearch({ status: "error", sites: null, searchedExternally: false, radiusMiles, truncated: false });
      }
    })();

    return () => {
      controller.abort();
      clearTimeout(loadingTimer);
    };
  }, [latitude, longitude, radiusMiles, restoreNonce]);

  /** Adds a just-created site to the current result so its pin appears without a re-fetch. */
  const addSite = useCallback((site: SiteMarker) => {
    setSearch((prev) => (prev.sites ? { ...prev, sites: [...prev.sites, site] } : prev));
  }, []);

  return { search, addSite };
}
