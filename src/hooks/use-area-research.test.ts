// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAreaResearch } from "./use-area-research";

const CENTER = { latitude: 11.24, longitude: -74.2 };

describe("useAreaResearch", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing without a picked location", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAreaResearch(null));

    await act(() => result.current.run());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.aiSearch.status).toBe("idle");
  });

  it("posts the picked location and exposes the candidates", async () => {
    const candidates = [{ name: "Playa Grande" }];
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAreaResearch(CENTER));

    await act(() => result.current.run());

    expect(result.current.aiSearch).toMatchObject({ status: "done", candidates });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual(CENTER);
  });

  it("reports an upstream failure returned with HTTP 200 as an error, not an empty result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [], error: "quota exceeded" }) }) as Response),
    );
    const { result } = renderHook(() => useAreaResearch(CENTER));

    await act(() => result.current.run());

    expect(result.current.aiSearch).toMatchObject({ status: "error", error: "quota exceeded" });
  });

  it("reports a thrown request as an error and can be reset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const { result } = renderHook(() => useAreaResearch(CENTER));

    await act(() => result.current.run());
    expect(result.current.aiSearch.status).toBe("error");

    act(() => result.current.reset());
    expect(result.current.aiSearch).toEqual({ status: "idle", candidates: [], error: null });
  });
});
