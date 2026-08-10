"use client";

/**
 * Persisted map/list exploration state — map viewport, search radius,
 * site-type filter, and (as of T21.26) difficulty filter — so browsing to a
 * site detail page and back doesn't throw away everything the diver just set
 * up.
 *
 * Fixes three symptoms of one root cause (reported 2026-08-09): the homepage
 * always opened on the hardcoded California fallback and then visibly jumped
 * to the diver's real location; the radius selector reset to 25mi on every
 * return visit; and any map panning/zooming was lost. All three came from
 * this state living in component-local `useState` (and a hardcoded
 * `initialViewState`) inside `DiveSiteExplorer`/`SiteMap`, which App Router
 * unmounts on navigation.
 *
 * Storage shape/pattern deliberately mirrors
 * `src/hooks/use-post-dive-prompt-settings.ts` and
 * `src/hooks/use-safe-return-timer.ts`: a module-scope cache + subscriber
 * list read through `useSyncExternalStore`, NOT a `useState` + mount-effect
 * hydration flag. That choice is load-bearing here, not stylistic — the
 * server has no `localStorage`, so a naive initializer would render the
 * default on the server and the persisted value on the client's first paint,
 * which is exactly the hydration-mismatch bug already documented at length in
 * `src/hooks/use-geolocation.ts`. `useSyncExternalStore` reconciles that
 * server/client difference itself via `getServerSnapshot`.
 *
 * This is UI convenience state, not safety state: every read path tolerates
 * corrupt/absent storage by falling back to defaults rather than throwing,
 * and nothing here is ever treated as authoritative about where the diver
 * actually is (that stays `useGeolocation`'s job).
 */

import { useCallback, useSyncExternalStore } from "react";
import type { SiteType } from "./types";
// Type-only: `DifficultyLevel` is a plain string union, so this pulls in no
// runtime code from `dive-difficulty.ts` (elided entirely by `import type`) —
// same reasoning `./types.ts` documents for its own `ShoreAccessConfidence`
// re-export.
import type { DifficultyLevel } from "./dive-difficulty";

const STORAGE_KEY = "shore-dive:explorer-preferences:v1";

export type SiteTypeFilterValue = SiteType | "all";
export type DifficultyFilterValue = DifficultyLevel | "all";

export interface MapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface ExplorerPreferences {
  /** Last map viewport the diver left the map at. `null` means "never moved
   * the map" — the signal `SiteMap` uses to decide whether it may still
   * auto-fly to the diver's resolved geolocation (see its own comments). */
  viewport: MapViewport | null;
  radiusMiles: number;
  siteTypeFilter: SiteTypeFilterValue;
  /** Added 2026-08-09 alongside the difficulty filter/badge UI (T21.26),
   * mirroring `siteTypeFilter` field-for-field: same `"all"` sentinel, same
   * validate-on-read discipline. `DifficultyLevel` itself never includes
   * `null` (see `dive-difficulty.ts`) — a site classifier can return
   * `level: null` for "not enough data", but that is a per-site classifier
   * output, not a selectable filter value, so it has no representation here. */
  difficultyFilter: DifficultyFilterValue;
}

/** Matches `DiveSiteExplorer`'s first radius option and the "no filter"
 * default. `viewport: null` deliberately means "unset", not a coordinate —
 * see the field comment above. */
export const DEFAULT_EXPLORER_PREFERENCES: ExplorerPreferences = {
  viewport: null,
  radiusMiles: 25,
  siteTypeFilter: "all",
  difficultyFilter: "all",
};

const SITE_TYPE_FILTER_VALUES: SiteTypeFilterValue[] = [
  "all",
  "shore_reef",
  "shipwreck",
  "cave",
  "spring",
  "artificial_reef",
  "unclassified",
];

/** Hand-maintained, same as `SITE_TYPE_FILTER_VALUES` above (and for the same
 * reason: `DifficultyLevel` is a type, which has no runtime representation to
 * validate a persisted string against, so the real union is duplicated here
 * as a runtime array). Keep in lockstep with `DifficultyLevel` in
 * `dive-difficulty.ts` — that module owns the four values, this just mirrors
 * them for storage validation. */
const DIFFICULTY_FILTER_VALUES: DifficultyFilterValue[] = [
  "all",
  "beginner",
  "intermediate",
  "advanced",
  "technical",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates a parsed viewport field-by-field rather than trusting the shape.
 * localStorage is user-writable and survives across deploys, so a value
 * written by an older build (or edited by hand) must not be able to hand
 * Mapbox a NaN/out-of-range coordinate — that throws inside the GL library
 * rather than degrading, which would take the whole map down.
 */
function parseViewport(value: unknown): MapViewport | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MapViewport>;
  if (!isFiniteNumber(candidate.longitude) || !isFiniteNumber(candidate.latitude)) return null;
  if (!isFiniteNumber(candidate.zoom)) return null;
  if (candidate.latitude < -90 || candidate.latitude > 90) return null;
  if (candidate.longitude < -180 || candidate.longitude > 180) return null;
  if (candidate.zoom < 0 || candidate.zoom > 24) return null;
  return { longitude: candidate.longitude, latitude: candidate.latitude, zoom: candidate.zoom };
}

/** `Infinity` is a legitimate radius here (the "All" option) but does not
 * survive `JSON.stringify` — it serializes to `null`. Persisted as the
 * sentinel string `"all"` and restored back to `Infinity`. */
function parseRadius(value: unknown): number {
  if (value === "all") return Number.POSITIVE_INFINITY;
  if (isFiniteNumber(value) && value > 0) return value;
  return DEFAULT_EXPLORER_PREFERENCES.radiusMiles;
}

function serializeRadius(radiusMiles: number): number | "all" {
  return Number.isFinite(radiusMiles) ? radiusMiles : "all";
}

function parseSiteTypeFilter(value: unknown): SiteTypeFilterValue {
  return SITE_TYPE_FILTER_VALUES.includes(value as SiteTypeFilterValue)
    ? (value as SiteTypeFilterValue)
    : DEFAULT_EXPLORER_PREFERENCES.siteTypeFilter;
}

function parseDifficultyFilter(value: unknown): DifficultyFilterValue {
  return DIFFICULTY_FILTER_VALUES.includes(value as DifficultyFilterValue)
    ? (value as DifficultyFilterValue)
    : DEFAULT_EXPLORER_PREFERENCES.difficultyFilter;
}

function readPersisted(): ExplorerPreferences {
  if (typeof window === "undefined") return DEFAULT_EXPLORER_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_EXPLORER_PREFERENCES;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      viewport: parseViewport(parsed.viewport),
      radiusMiles: parseRadius(parsed.radiusMiles),
      siteTypeFilter: parseSiteTypeFilter(parsed.siteTypeFilter),
      difficultyFilter: parseDifficultyFilter(parsed.difficultyFilter),
    };
  } catch {
    // Corrupt/unreadable storage is not exceptional here — this is UI
    // convenience state. Fall back to defaults silently rather than logging
    // per-read noise or throwing on a hot render path.
    return DEFAULT_EXPLORER_PREFERENCES;
  }
}

let cached: ExplorerPreferences | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): ExplorerPreferences {
  if (cached === null) cached = readPersisted();
  return cached;
}

function getServerSnapshot(): ExplorerPreferences {
  return DEFAULT_EXPLORER_PREFERENCES;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function commit(next: ExplorerPreferences): void {
  cached = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          viewport: next.viewport,
          radiusMiles: serializeRadius(next.radiusMiles),
          siteTypeFilter: next.siteTypeFilter,
          difficultyFilter: next.difficultyFilter,
        }),
      );
    } catch {
      // Private browsing / storage full: preferences still apply for this
      // session in memory, they just won't survive a reload. Not worth
      // surfacing to a diver.
    }
  }
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  // Cross-tab sync, matching use-safe-return-timer.ts: a radius change in
  // another tab shouldn't leave this one showing stale preferences.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cached = readPersisted();
    for (const listener of listeners) listener();
  });
}

export interface UseExplorerPreferencesResult extends ExplorerPreferences {
  /** False until the persisted value is known to reflect the real client-side
   * value. Consumers that must not render a default-then-jump flash (the map's
   * `initialViewState`, which Mapbox reads exactly once) should wait on this. */
  isHydrated: boolean;
  setViewport: (viewport: MapViewport) => void;
  setRadiusMiles: (radiusMiles: number) => void;
  setSiteTypeFilter: (siteTypeFilter: SiteTypeFilterValue) => void;
  setDifficultyFilter: (difficultyFilter: DifficultyFilterValue) => void;
}

export function useExplorerPreferences(): UseExplorerPreferencesResult {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const setViewport = useCallback((viewport: MapViewport) => {
    commit({ ...getSnapshot(), viewport });
  }, []);

  const setRadiusMiles = useCallback((radiusMiles: number) => {
    commit({ ...getSnapshot(), radiusMiles });
  }, []);

  const setSiteTypeFilter = useCallback((siteTypeFilter: SiteTypeFilterValue) => {
    commit({ ...getSnapshot(), siteTypeFilter });
  }, []);

  const setDifficultyFilter = useCallback((difficultyFilter: DifficultyFilterValue) => {
    commit({ ...getSnapshot(), difficultyFilter });
  }, []);

  return { ...preferences, isHydrated, setViewport, setRadiusMiles, setSiteTypeFilter, setDifficultyFilter };
}
