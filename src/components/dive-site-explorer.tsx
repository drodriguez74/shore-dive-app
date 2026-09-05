"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SiteMap } from "@/components/site-map";
import { NearbyDiveSitesList, type SiteWithDistance } from "@/components/nearby-dive-sites-list";
import { SiteDiscoveryCandidates } from "@/components/site-discovery-candidates";
import { latestStatusPerShop, type LdsStatusRow } from "@/components/lds/lds-status";
import { useGeolocation, type GeolocationCoords } from "@/hooks/use-geolocation";
import { distanceMiles } from "@/lib/sites/distance";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import { useExplorerPreferences } from "@/lib/sites/explorer-preferences";
import { classifyDiveDifficulty, DIFFICULTY_LABEL, type DifficultyLevel } from "@/lib/sites/dive-difficulty";
import { SITE_TYPE_LABELS } from "@/lib/sites/site-type-labels";
import type { SiteMarker, SiteType } from "@/lib/sites/types";
import type { CandidateSite } from "@/lib/site-discovery/area-research";

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

/**
 * Founder-reported gap (2026-08-11): `shore-access.ts`'s classification has
 * existed since T21.20 and is rendered per-site (the detail page, the pin
 * preview sheet), but nothing ever let a diver *filter* by it — despite
 * "can I walk in from shore" being this app's entire premise (CLAUDE.md's
 * Map-Driven Exploration pillar) and the founder's own earlier explicit ask
 * ("we just use our default filter of shore dive"). Live data at the time
 * this was added: 27 of 445 sites are shore-accessible (21 `likely` + 6
 * `marginal`) — the other 418 are `unlikely`/boat access. Without this
 * filter there was no way to see just the 27.
 *
 * Deliberately three options, not four. `ShoreAccessConfidence` itself has
 * three values (`likely`/`marginal`/`unlikely`), and the type/difficulty
 * filters above each mirror their source enum one chip per value — but this
 * filter groups `likely` and `marginal` into one "Shore accessible" option
 * instead. Reasoning: a diver filtering for shore dives wants *both* (an
 * easy walk and a long-swim walk are both "I don't need a boat"), and these
 * filter chips are single-select, not checkboxes — mirroring the raw enum
 * would force choosing "easy walk-ins only" or "long swims only" as two
 * separate, mutually-exclusive filters to get what should be one click. The
 * finer likely-vs-marginal distinction stays visible per-site (detail page,
 * pin sheet) — this is a coarse top-level filter, not a replacement for that.
 */
export type ShoreAccessFilter = "all" | "accessible" | "boat";

export const SHORE_ACCESS_FILTER_LABEL: Record<ShoreAccessFilter, string> = {
  all: "All access",
  accessible: "Shore accessible",
  boat: "Boat access",
};

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
 * so a diver filtering by *multiple* axes at once sees an accurate combined
 * description ("No shore-accessible beginner reef sites…") rather than a
 * message that silently drops an active filter. Shore-access reads first,
 * then difficulty, then type — English adjective ordering ("shore-accessible
 * beginner reef", not "beginner reef shore-accessible"). */
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
  shoreAccessFilter: ShoreAccessFilter;
  searchedExternally: boolean;
  /** True when `hasCoords` is satisfied by a manually-picked map location
   * (2026-08-11's "Fetch dive sites here" feature) rather than the diver's
   * own geolocation — swaps "your location" for "this location" in the
   * copy below so the message stays literally true. Deliberately does NOT
   * add a distinct "already checked this area recently" message: the
   * search-nearby response has no field saying *why* `searchedExternally`
   * came back false (could be the 30-day grid-cell cooldown, could be the
   * anonymous-user gate, could be plenty of local results already) — this
   * codebase's own life-safety-adjacent honesty rule cuts both ways: don't
   * assert a specific reason you can't actually verify. Defaults to
   * `false` so every existing caller/test is unaffected. */
  isManualLocation?: boolean;
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
  const {
    resultCount,
    hasCoords,
    radiusMiles,
    siteTypeFilter,
    difficultyFilter,
    shoreAccessFilter,
    searchedExternally,
    isManualLocation = false,
  } = params;

  if (resultCount > 0 || !hasCoords || !Number.isFinite(radiusMiles)) return null;

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

/**
 * Reads a `SiteMarker`'s already-stored `shore_access` column directly —
 * unlike `siteDifficultyLevel`, this does not recompute a classification
 * from scratch. `classifyShoreAccess()` needs the hand-curated
 * `SOUTH_FLORIDA_ENTRY_POINTS` list and a haversine call per site; running
 * that per marker on every render (up to 500+ sites in view) would be pure
 * duplicated cost when the import pipeline already persisted the answer.
 * Returns `null` for a site that hasn't been classified yet (distinct from
 * `"unlikely"`, matching `shore-access.ts`'s own "no known entry is not
 * evidence of boat-only" rule) — such a site matches only `"all"`, the same
 * pattern `siteDifficultyLevel`'s `level: null` already established.
 */
export function siteShoreAccessCategory(site: SiteMarker): "accessible" | "boat" | null {
  if (site.shore_access === "likely" || site.shore_access === "marginal") return "accessible";
  if (site.shore_access === "unlikely") return "boat";
  return null;
}

interface SearchNearbyResponse {
  sites: SiteMarker[];
  error: string | null;
  searchedExternally: boolean;
  /** True when the route's local read hit `SEARCH_NEARBY_ROW_LIMIT` and
   * more matching sites exist than were returned — same "never present a
   * truncated list as complete" contract `ListSitesResult.truncated`
   * already establishes in `queries.ts`. Optional so this stays
   * backward-compatible with any cached/mocked response shape from before
   * this field existed. */
  truncated?: boolean;
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
  /** See `SearchNearbyResponse.truncated`. `false` for every state that
   * isn't a real, current server result (idle/loading/error) — truncation
   * is a fact about a specific result set, not a thing to guess at when
   * there isn't one. */
  truncated: boolean;
}

/**
 * Decides the next `SearchNearbyState` from a resolved (HTTP-200)
 * `/api/sites/search-nearby` response — extracted as a pure function so
 * this decision is unit-testable without mounting `DiveSiteExplorer`
 * (which needs geolocation + `fetch` mocked to render at all).
 *
 * Found 2026-08-10: the route's own contract (its header comment) reserves
 * `error` for a LOCAL database failure and degrades to `sites: []` with a
 * 200 status specifically so a transient DB hiccup never fails the whole
 * request — but the caller here used to read only `data.sites`, never
 * `data.error`, so a real server-side failure silently looked identical to
 * "genuinely zero sites nearby": both produced `status: "done", sites: []`.
 * A response with `error` set now routes through `"error"` instead —  the
 * same path a network failure already takes, which correctly falls back to
 * client-side filtering of the already-loaded `sites` prop (the cached
 * full catalog from SSR) rather than presenting a backend failure as "no
 * sites here."
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

const IDLE_SEARCH_STATE: SearchNearbyState = {
  status: "idle",
  sites: null,
  searchedExternally: false,
  radiusMiles: null,
  truncated: false,
};

/** State for the AI-assisted web-search fallback (`plan.md` Resolved Spec
 * Decision #10, 2026-08-11) — only offered as a second, explicit action
 * once the free OSM tier has already come up genuinely empty at
 * `manualCenter`. Deliberately its own state, not folded into
 * `SearchNearbyState`: these are two different pipelines (local DB +
 * Overpass vs. Brave Search + Gemini) with two different trigger
 * conditions, and conflating them would make either harder to reason
 * about independently. */
export interface AiSearchState {
  status: "idle" | "loading" | "done" | "error";
  candidates: CandidateSite[];
  error: string | null;
}

const IDLE_AI_SEARCH_STATE: AiSearchState = { status: "idle", candidates: [], error: null };

export interface AiSearchResponse {
  candidates?: CandidateSite[];
  error?: string | null;
}

/**
 * Decides the next `AiSearchState` from a `POST /api/sites/research-area`
 * response — extracted as a pure function for the same testability reason
 * `nextSearchStateFromResponse` above already is, and to fix the same bug
 * class found live in that one, reproduced here (2026-08-11): the route
 * deliberately returns HTTP 200 with `error` set for an upstream
 * (Brave/Gemini) failure — e.g. a Gemini free-tier quota error — so a
 * request that "succeeded" at the HTTP level can still be a real failure.
 * Checking `response.ok` alone treated that identically to "searched the
 * web, found nothing here," the exact dishonest-empty-state this app
 * already fixed once on the main search path and must not regress here.
 */
export function nextAiSearchStateFromResponse(
  data: AiSearchResponse,
  responseOk: boolean,
  statusCode: number,
): AiSearchState {
  if (!responseOk || data.error) {
    return { status: "error", candidates: [], error: data.error ?? `Request failed (${statusCode})` };
  }
  return { status: "done", candidates: data.candidates ?? [], error: null };
}

export interface DiveSiteExplorerProps {
  /** Full, unfiltered `sites` fetch from the Server Component page that
   * renders this wrapper (`src/app/page.tsx`, T11.5/Task 21) — the
   * fallback/initial content before geolocation resolves, when the radius
   * is "All", and if the search-nearby fetch fails. Same fallback contract
   * `NearbyDiveSitesList` had pre-T21.6, just now owned up here instead. */
  sites: SiteMarker[];
  /** Real `lds_status` read from `src/app/page.tsx` (Task 16, T22.6 — this
   * used to be `MOCK_LDS_MARKERS`, rendered on the live homepage
   * unconditionally, not as a fallback). Defaults to `[]`, the honest
   * "nothing verified yet" state, rather than to fabricated shop pins if a
   * future caller forgets to pass it. */
  ldsMarkers?: LdsStatusRow[];
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
export function DiveSiteExplorer({ sites, ldsMarkers = [], isSignedIn = false }: DiveSiteExplorerProps) {
  const { status, coords } = useGeolocation();
  // Radius + site-type filter persist across navigation (reported 2026-08-09:
  // browsing to a site detail page and back silently reset both). Same
  // localStorage-backed external store the map's viewport uses, so all three
  // pieces of exploration state restore together rather than partially.
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
  const [search, setSearch] = useState<SearchNearbyState>(IDLE_SEARCH_STATE);
  // Map-pan discovery (2026-08-11): a diver panning the map to somewhere
  // unloaded (e.g. Santa Marta, La Romana) can explicitly ask to search
  // *there* instead of wherever geolocation puts them — see `SiteMap`'s
  // `onFetchHere` prop. `null` means "no manual override, use geolocation",
  // the same "explicit choice wins over the ambient default" pattern
  // `hasPositionedRef`/`savedViewport` already use in `site-map.tsx` for the
  // map's own position. Once set, geolocation updates no longer silently
  // override it — only "Use my location instead" (below) clears it.
  //
  // `manualCenter` is persisted (2026-09-05, `plan.md` item 22): it lives in
  // `useExplorerPreferences` alongside the map viewport it moves in lockstep
  // with, so navigating to a site detail page and back keeps the map's data
  // over the panned area — not just the camera. Previously a returning diver
  // saw their panned-to region on screen while the search silently ran
  // against their real GPS, so any site they'd just added there vanished.
  const effectiveCoords = manualCenter ?? coords;
  const [aiSearch, setAiSearch] = useState<AiSearchState>(IDLE_AI_SEARCH_STATE);

  // Back/forward-cache recovery (2026-09-05, `plan.md` item 23). When a diver
  // taps a pin, opens the site detail page, then hits Back, most browsers
  // restore this page from the bfcache *without remounting* — so the search
  // effect below never re-runs, and if its in-flight fetch was aborted on
  // the way out (see the effect's cleanup), the map is left frozen on a
  // stale/loading state until a manual refresh. Bumping this nonce on a
  // persisted `pageshow` forces exactly one clean re-fetch.
  const [bfcacheNonce, setBfcacheNonce] = useState(0);
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setBfcacheNonce((n) => n + 1);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  /** Wraps `setManualCenter` so picking a new location also clears any
   * AI-search results from wherever the diver was previously — stale
   * candidates from a different point on the map must never linger. */
  function handleFetchHere(center: GeolocationCoords) {
    setManualCenter(center);
    setAiSearch(IDLE_AI_SEARCH_STATE);
  }

  function handleResetToMyLocation() {
    setManualCenter(null);
    setAiSearch(IDLE_AI_SEARCH_STATE);
  }

  async function handleAiSearch() {
    if (!manualCenter) return;
    setAiSearch({ status: "loading", candidates: [], error: null });
    try {
      const response = await fetch("/api/sites/research-area", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: manualCenter.latitude, longitude: manualCenter.longitude }),
      });
      const data = (await response.json()) as AiSearchResponse;
      setAiSearch(nextAiSearchStateFromResponse(data, response.ok, response.status));
    } catch (error) {
      logger.warn("ai_area_search_failed", { message: errorMessage(error) });
      setAiSearch({ status: "error", candidates: [], error: "Something went wrong — try again." });
    }
  }

  /** Merges a just-added candidate straight into the current server search
   * result — reuses the exact same derivation (`inRadius`/`mapSiteMarkers`
   * below) that already renders `search.sites`, so the new pin appears on
   * the map immediately, no re-fetch needed (the founder's explicit
   * requirement: "I should see the results immediately"). A no-op if
   * `search.sites` is somehow null (shouldn't happen — this is only
   * reachable once a "done" server result already produced an empty
   * array), so this never crashes onto a stale/impossible state. */
  function handleCandidateAdded(site: SiteMarker) {
    setSearch((prev) => (prev.sites ? { ...prev, sites: [...prev.sites, site] } : prev));
  }

  /** Same idea as `handleCandidateAdded`, for LDS/fill-station status
   * reports filed from a map popup (Task 16, 2026-08-20): the row the
   * server actually inserted is appended to a session-local log and the
   * whole thing is re-collapsed with `latestStatusPerShop` — the identical
   * function `listLdsStatusMarkers()` uses server-side, so an in-session
   * report and a server-rendered one resolve by exactly the same rule
   * (latest `last_verified_at` per shop wins) rather than by whichever
   * happened to be appended last. Without this, filing a report from a
   * popup left the pin and popup showing the previous status until a
   * reload, which is indistinguishable from the report not having saved. */
  const [ldsSubmitted, setLdsSubmitted] = useState<LdsStatusRow[]>([]);
  const currentLdsMarkers = useMemo(
    () => (ldsSubmitted.length === 0 ? ldsMarkers : latestStatusPerShop([...ldsMarkers, ...ldsSubmitted])),
    [ldsMarkers, ldsSubmitted],
  );

  // Fires when the effective search center first resolves, or when the
  // radius selector actually changes value — see `nearby-dive-sites-list.tsx`'s
  // pre-T21.6 version for the original, identical reasoning (moved here
  // verbatim, not rewritten). The "All" radius is deliberately never sent
  // to the route — there's no sensible finite value to send, and "show
  // everything already known" is exactly what client-side filtering below
  // already does correctly.
  useEffect(() => {
    if (!effectiveCoords || !Number.isFinite(radiusMiles)) return;

    const controller = new AbortController();
    // Deferred via setTimeout, same react-hooks/set-state-in-effect reason
    // documented at length in media-embed.tsx and use-geolocation.ts —
    // functionally still immediate, just outside the effect's own
    // synchronous body.
    const loadingTimer = setTimeout(() => {
      setSearch({ status: "loading", sites: null, searchedExternally: false, radiusMiles, truncated: false });
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
        const nextState = nextSearchStateFromResponse(data, radiusMiles);
        if (nextState.status === "error") {
          logger.warn("nearby_search_returned_error", { message: data.error });
        }
        setSearch(nextState);
      } catch (error) {
        if (controller.signal.aborted) return;
        // Nice-to-have enhancement, not a page-breaking dependency — log for
        // field debugging (CLAUDE.md: many failures happen offline, at
        // remote sites, after the fact) and fall back to client-side
        // filtering of the `sites` prop below. Never surface this as an
        // error state to the diver.
        logger.warn("nearby_search_fetch_failed", { message: errorMessage(error) });
        setSearch({ status: "error", sites: null, searchedExternally: false, radiusMiles, truncated: false });
      }
    })(effectiveCoords);

    return () => {
      controller.abort();
      clearTimeout(loadingTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCoords?.latitude, effectiveCoords?.longitude, radiusMiles, bfcacheNonce]);

  const sitesWithDistance = useMemo<SiteWithDistance[] | null>(() => {
    if (!effectiveCoords) return null;
    return sites
      .map((site) => ({ site, miles: distanceMiles(effectiveCoords, site) }))
      .sort((a, b) => a.miles - b.miles);
  }, [sites, effectiveCoords]);

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
  // Same "only meaningful when the server result is what's actually being
  // rendered" gating as `searchedExternally` immediately above — `search`
  // can be stale (a prior radius) or not a real result at all
  // (idle/loading/error), and `truncated` must describe the set on screen,
  // not a leftover flag from a different search.
  const resultsTruncated = useServerResult && search.truncated;

  const clientInRadius = useMemo<SiteWithDistance[]>(() => {
    if (!sitesWithDistance) return [];
    return sitesWithDistance.filter((entry) => entry.miles <= radiusMiles);
  }, [sitesWithDistance, radiusMiles]);

  const inRadius: SiteWithDistance[] =
    useServerResult && effectiveCoords
      ? search.sites!.map((site) => ({ site, miles: distanceMiles(effectiveCoords, site) }))
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

  // Filter-by-shore-access (2026-08-11, founder: "why can't we have a shore
  // dive filter?" — see `ShoreAccessFilter`'s own doc comment above for the
  // full rationale). Same shared level as type/difficulty, same reason: a
  // filter that only touched the list would leave stale, filtered-out pins
  // on the map. Same `null`-is-excluded-from-named-filters discipline as
  // difficulty too — a site with no shore-access classification yet matches
  // only `"all"`, never silently counted as either bucket.
  const matchesShoreAccess = (site: SiteMarker) =>
    shoreAccessFilter === "all" || siteShoreAccessCategory(site) === shoreAccessFilter;

  const filteredInRadius = inRadius.filter(
    (entry) => matchesType(entry.site) && matchesDifficulty(entry.site) && matchesShoreAccess(entry.site),
  );
  const filteredSites = sites.filter(
    (site) => matchesType(site) && matchesDifficulty(site) && matchesShoreAccess(site),
  );

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
    effectiveCoords && Number.isFinite(radiusMiles) ? filteredInRadius.map((entry) => entry.site) : filteredSites;

  const mapEmptyStateMessage = computeMapEmptyStateMessage({
    resultCount: mapSiteMarkers.length,
    hasCoords: effectiveCoords !== null,
    radiusMiles,
    siteTypeFilter,
    difficultyFilter,
    shoreAccessFilter,
    searchedExternally,
    isManualLocation: manualCenter !== null,
  });

  // The web-search discovery fallback is available at any *manually-picked*
  // location once its server search has landed — NOT only when the local/OSM
  // search found nothing (founder decision, 2026-09-05, `plan.md` item 29):
  // "some sites here" never means "every site here", and a diver who added
  // one candidate and reloaded the page had no way back to the rest, or to
  // re-run the search. Real per-call cost is bounded server-side by the
  // shared daily cap (`research-area` route), not by hiding the entry point.
  // Still gated to a manual location: offering a metered search on every
  // homepage load at the diver's own GPS would be wrong, and `handleAiSearch`
  // needs a `manualCenter` to search around anyway.
  //
  // `serverFoundNothingHere` still drives the *copy* (a genuine empty result
  // reads differently from "there are sites, but maybe not all of them") and
  // is checked against the RAW server result (`search.sites`), not
  // `mapSiteMarkers` — the latter can be empty purely because a
  // type/difficulty/shore-access filter is hiding real OSM results.
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
              onClick={handleAiSearch}
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
                onClick={handleAiSearch}
                className="mt-1 text-xs font-medium text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-400"
              >
                Try again
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <SiteDiscoveryCandidates candidates={aiSearch.candidates} onAdded={handleCandidateAdded} />
              <button
                type="button"
                onClick={handleAiSearch}
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
