// @vitest-environment jsdom

/**
 * Tests for the persisted map/list exploration state (viewport, radius,
 * site-type filter) added 2026-08-09 to fix three reported symptoms of one
 * root cause: the homepage always opening on the California fallback and then
 * jumping, and the radius/filter/map-position all resetting after browsing to
 * a site detail page and back.
 *
 * Setup note, same constraint `use-safe-return-timer.test.ts` documents: the
 * store's cache lives in *module scope*, so it survives between tests.
 * `vi.resetModules()` would hand the hook a second copy of React and break
 * `renderHook`, so state is reset by writing localStorage and dispatching a
 * `storage` event — exercising the store's own cross-tab listener, which is a
 * real code path rather than a test-only backdoor.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_EXPLORER_PREFERENCES,
  useExplorerPreferences,
  type ExplorerPreferences,
} from "./explorer-preferences";

const STORAGE_KEY = "shore-dive:explorer-preferences:v1";

/** Writes storage and fires the cross-tab event so the module-scope cache
 * re-reads — see this file's header for why this is the reset mechanism. */
function seedStorage(raw: string | null) {
  if (raw === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, raw);
  }
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  });
}

function readStorage(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
}

describe("useExplorerPreferences", () => {
  beforeEach(() => {
    seedStorage(null);
  });

  it("falls back to defaults when nothing is persisted", () => {
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.viewport).toBeNull();
    expect(result.current.radiusMiles).toBe(DEFAULT_EXPLORER_PREFERENCES.radiusMiles);
    expect(result.current.siteTypeFilter).toBe("all");
    expect(result.current.difficultyFilter).toBe("all");
    expect(result.current.shoreAccessFilter).toBe("all");
  });

  it("round-trips a viewport, so returning to the map restores where the diver left it", () => {
    const { result } = renderHook(() => useExplorerPreferences());
    act(() => {
      result.current.setViewport({ longitude: -80.1373, latitude: 26.1224, zoom: 11.5 });
    });
    expect(result.current.viewport).toEqual({ longitude: -80.1373, latitude: 26.1224, zoom: 11.5 });
    expect(readStorage().viewport).toEqual({ longitude: -80.1373, latitude: 26.1224, zoom: 11.5 });
  });

  it("round-trips radius and site-type filter", () => {
    const { result } = renderHook(() => useExplorerPreferences());
    act(() => {
      result.current.setRadiusMiles(100);
      result.current.setSiteTypeFilter("shipwreck");
    });
    expect(result.current.radiusMiles).toBe(100);
    expect(result.current.siteTypeFilter).toBe("shipwreck");
  });

  it("round-trips the difficulty filter", () => {
    const { result } = renderHook(() => useExplorerPreferences());
    act(() => {
      result.current.setDifficultyFilter("advanced");
    });
    expect(result.current.difficultyFilter).toBe("advanced");
    expect(readStorage().difficultyFilter).toBe("advanced");

    seedStorage(window.localStorage.getItem(STORAGE_KEY));
    const { result: reloaded } = renderHook(() => useExplorerPreferences());
    expect(reloaded.current.difficultyFilter).toBe("advanced");
  });

  it("round-trips the shore-access filter", () => {
    const { result } = renderHook(() => useExplorerPreferences());
    act(() => {
      result.current.setShoreAccessFilter("accessible");
    });
    expect(result.current.shoreAccessFilter).toBe("accessible");
    expect(readStorage().shoreAccessFilter).toBe("accessible");

    seedStorage(window.localStorage.getItem(STORAGE_KEY));
    const { result: reloaded } = renderHook(() => useExplorerPreferences());
    expect(reloaded.current.shoreAccessFilter).toBe("accessible");
  });

  it("round-trips the unbounded 'All' radius, which JSON.stringify turns into null", () => {
    // Infinity is a legitimate radius (the "All" option) but serializes to
    // null — without the "all" sentinel this silently came back as the 25mi
    // default, i.e. the diver's "All" selection would quietly reset.
    const { result } = renderHook(() => useExplorerPreferences());
    act(() => {
      result.current.setRadiusMiles(Number.POSITIVE_INFINITY);
    });
    expect(readStorage().radiusMiles).toBe("all");

    seedStorage(window.localStorage.getItem(STORAGE_KEY));
    const { result: reloaded } = renderHook(() => useExplorerPreferences());
    expect(reloaded.current.radiusMiles).toBe(Number.POSITIVE_INFINITY);
  });

  it("falls back to defaults on corrupt JSON rather than throwing on a render path", () => {
    seedStorage("{not valid json");
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.radiusMiles).toBe(DEFAULT_EXPLORER_PREFERENCES.radiusMiles);
    expect(result.current.viewport).toBeNull();
  });

  it.each([
    ["NaN coordinates", { longitude: Number.NaN, latitude: 26, zoom: 10 }],
    ["out-of-range latitude", { longitude: -80, latitude: 999, zoom: 10 }],
    ["out-of-range longitude", { longitude: 900, latitude: 26, zoom: 10 }],
    ["out-of-range zoom", { longitude: -80, latitude: 26, zoom: 999 }],
    ["missing zoom", { longitude: -80, latitude: 26 }],
  ])("rejects a persisted viewport with %s instead of handing it to Mapbox", (_label, viewport) => {
    // localStorage is user-writable and survives deploys; a bad coordinate
    // reaching Mapbox throws inside the GL library and takes the map down,
    // rather than degrading.
    seedStorage(JSON.stringify({ viewport, radiusMiles: 25, siteTypeFilter: "all" }));
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.viewport).toBeNull();
  });

  it("rejects an unrecognized site-type filter (e.g. written by an older build)", () => {
    seedStorage(JSON.stringify({ viewport: null, radiusMiles: 25, siteTypeFilter: "not-a-real-type" }));
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.siteTypeFilter).toBe("all");
  });

  it("rejects an unrecognized difficulty filter (e.g. written by an older build, or hand-edited storage)", () => {
    seedStorage(
      JSON.stringify({ viewport: null, radiusMiles: 25, siteTypeFilter: "all", difficultyFilter: "expert" }),
    );
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.difficultyFilter).toBe("all");
  });

  it("rejects an unrecognized shore-access filter (e.g. mirroring the raw enum instead of the grouped one)", () => {
    // The real failure mode this guards: `shore-access.ts`'s raw
    // `ShoreAccessConfidence` has a `"likely"` value, but this filter
    // deliberately groups likely/marginal into `"accessible"` — a persisted
    // `"likely"` (e.g. from a future version that mirrored the raw enum, or
    // hand-edited storage) must fall back to "all", not silently be treated
    // as a valid filter value it was never defined to accept.
    seedStorage(
      JSON.stringify({ viewport: null, radiusMiles: 25, siteTypeFilter: "all", shoreAccessFilter: "likely" }),
    );
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.shoreAccessFilter).toBe("all");
  });

  it("keeps valid fields when only one field is corrupt", () => {
    seedStorage(
      JSON.stringify({
        viewport: { longitude: 999, latitude: 26, zoom: 10 },
        radiusMiles: 100,
        siteTypeFilter: "cave",
        difficultyFilter: "technical",
        shoreAccessFilter: "accessible",
      }),
    );
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.viewport).toBeNull();
    expect(result.current.radiusMiles).toBe(100);
    expect(result.current.siteTypeFilter).toBe("cave");
    expect(result.current.difficultyFilter).toBe("technical");
    expect(result.current.shoreAccessFilter).toBe("accessible");
  });

  it("picks up a change made in another tab", () => {
    const { result } = renderHook(() => useExplorerPreferences());
    expect(result.current.radiusMiles).toBe(25);

    const next: ExplorerPreferences = {
      viewport: null,
      radiusMiles: 250,
      siteTypeFilter: "spring",
      difficultyFilter: "beginner",
      shoreAccessFilter: "boat",
    };
    seedStorage(JSON.stringify(next));

    expect(result.current.radiusMiles).toBe(250);
    expect(result.current.siteTypeFilter).toBe("spring");
    expect(result.current.difficultyFilter).toBe("beginner");
    expect(result.current.shoreAccessFilter).toBe("boat");
  });

  it("updating one field leaves the others intact", () => {
    const { result } = renderHook(() => useExplorerPreferences());
    act(() => {
      result.current.setViewport({ longitude: -80, latitude: 26, zoom: 12 });
    });
    act(() => {
      result.current.setRadiusMiles(50);
    });
    expect(result.current.viewport).toEqual({ longitude: -80, latitude: 26, zoom: 12 });
    expect(result.current.radiusMiles).toBe(50);
  });
});
