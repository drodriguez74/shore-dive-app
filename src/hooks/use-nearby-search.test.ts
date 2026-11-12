// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNearbySearch } from "./use-nearby-search";
import type { SiteMarker } from "@/lib/sites/types";

const SITE = { id: "a", name: "A", latitude: 26.7, longitude: -80.1 } as SiteMarker;
const CENTER = { latitude: 26.7, longitude: -80.1 };

function respondWith(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response);
}

describe("useNearbySearch", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("searches around the centre and exposes the result for that radius", async () => {
    const fetchMock = respondWith({ sites: [SITE], error: null, searchedExternally: true, truncated: true });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNearbySearch(CENTER, 25));

    await waitFor(() => expect(result.current.search.status).toBe("done"));
    expect(result.current.search).toMatchObject({ sites: [SITE], radiusMiles: 25, searchedExternally: true, truncated: true });
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe("/api/sites/search-nearby?lat=26.7&lng=-80.1&radiusMiles=25");
  });

  it("does not search without a location or for the 'All' radius", async () => {
    const fetchMock = respondWith({ sites: [], error: null, searchedExternally: false });
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useNearbySearch(null, 25));
    renderHook(() => useNearbySearch(CENTER, Infinity));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a database error reported in a 200 response", respondWith({ sites: [], error: "unreachable", searchedExternally: false })],
    ["a non-OK response", respondWith({}, false)],
    [
      "a network failure",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    ],
  ])("treats %s as an error, never as zero sites", async (_label, fetchMock) => {
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNearbySearch(CENTER, 25));

    await waitFor(() => expect(result.current.search.status).toBe("error"));
    expect(result.current.search.sites).toBeNull();
  });

  it("re-runs when the radius changes and when the page is restored from the back/forward cache", async () => {
    const fetchMock = respondWith({ sites: [], error: null, searchedExternally: false });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(({ radius }) => useNearbySearch(CENTER, radius), { initialProps: { radius: 25 } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender({ radius: 50 });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    act(() => {
      const event = new Event("pageshow") as PageTransitionEvent;
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("adds a newly created site to the current result", async () => {
    vi.stubGlobal("fetch", respondWith({ sites: [], error: null, searchedExternally: false }));
    const { result } = renderHook(() => useNearbySearch(CENTER, 25));
    await waitFor(() => expect(result.current.search.status).toBe("done"));

    act(() => result.current.addSite(SITE));

    expect(result.current.search.sites).toEqual([SITE]);
  });
});
