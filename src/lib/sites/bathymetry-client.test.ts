import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDepthFt, fetchDepthsFt, sampleDepthTransect } from "./bathymetry-client";

// No live network: `fetch` is stubbed per test. Response shapes mirror what
// gis.ngdc.noaa.gov actually returned when this module was verified live
// 2026-08-09 (see this module's header) — `identify` returns
// `{value: "<meters>"}` or `{value: "NoData"}`, `getSamples` returns
// `{samples: [{locationId, value}]}`, and both report application-level
// failures as `{error: {...}}` inside an HTTP 200 body.

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return { ok, status, json: async () => body } as Response;
}

const POINT = { latitude: 26.17, longitude: -80.095 };

describe("fetchDepthFt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("converts a live-verified BAG reading to positive feet — the sign/unit conversion this module exists to get right", async () => {
    // Live value from this module's header: -4.77755 m at 26.17,-80.095.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ value: "-4.77755" })));

    const result = await fetchDepthFt(POINT);
    expect(result.error).toBeNull();
    // -4.77755 m * 3.28084 ft/m = 15.6749... ft. A sign error would produce
    // -15.67 (negative) or 4.78 (unconverted metres); either would silently
    // corrupt a certification judgement downstream.
    expect(result.depthFt).toBeCloseTo(15.67, 1);
    expect(result.depthFt).not.toBeLessThan(0);
  });

  it("reports NoData as null depth with no error, not as a failure", async () => {
    // BAG NoData, then the DEM fallback also NoData — both are honest "no
    // coverage" answers, not errors.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ value: "NoData" }))
      .mockResolvedValueOnce(jsonResponse({ value: "NoData" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthFt(POINT);
    expect(result.depthFt).toBeNull();
    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // BAG, then the DEM fallback
  });

  it("treats a reading at or above the MLLW datum as not underwater, not as a false positive depth", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ value: "0.5" })));
    const result = await fetchDepthFt(POINT);
    // A naive Math.abs() would report 1.6 ft of "depth" for a point that is
    // actually above the waterline.
    expect(result.depthFt).toBeNull();
    expect(result.error).toBeNull();
  });

  it("falls back to CUDEM when the primary BAG request fails outright", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ value: "-5.48084" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthFt(POINT);
    expect(result.error).toBeNull();
    expect(result.depthFt).toBeCloseTo(17.98, 1);
    const [firstUrl] = fetchMock.mock.calls[0] as [string];
    const [secondUrl] = fetchMock.mock.calls[1] as [string];
    expect(firstUrl).toContain("bag_bathymetry");
    expect(secondUrl).toContain("DEM_mosaics");
  });

  it("reports the DEM error when both services fail outright", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthFt(POINT);
    expect(result.depthFt).toBeNull();
    // Both services genuinely failed — the combined message must not hide
    // either one behind the other.
    expect(result.error).toContain("503");
    expect(result.error).toContain("500");
  });

  it("reports an ArcGIS error delivered inside an HTTP 200 body, same trap urm-client.ts documents", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 400, message: "Unable to complete operation." } }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 400, message: "Unable to complete operation." } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthFt(POINT);
    expect(result.depthFt).toBeNull();
    expect(result.error).toContain("400");
    expect(result.error).toContain("Unable to complete operation.");
  });

  it("returns an explicit error on a network failure instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    const result = await fetchDepthFt(POINT);
    expect(result.depthFt).toBeNull();
    // The mock throws for both the BAG call and the DEM fallback, so the
    // combined message contains "fetch failed" from each.
    expect(result.error).toContain("fetch failed");
  });

  it("sends a descriptive User-Agent and a point spatial filter", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ value: "-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDepthFt(POINT);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("bag_bathymetry/ImageServer/identify");
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("shore-dive-app");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("geometryType")).toBe("esriGeometryPoint");
    expect(JSON.parse(body.get("geometry") ?? "{}")).toMatchObject({ x: POINT.longitude, y: POINT.latitude });
  });
});

describe("fetchDepthsFt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const POINTS = [
    { latitude: 26.1867, longitude: -80.0948 },
    { latitude: 26.1867, longitude: -80.093 },
    { latitude: 26.1867, longitude: -80.09 },
  ];

  it("returns one depth per point, in order, converted to positive feet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          samples: [
            { locationId: 0, value: "-0.13" },
            { locationId: 1, value: "-3.765" },
            { locationId: 2, value: "-5.9" },
          ],
        }),
      ),
    );

    const result = await fetchDepthsFt(POINTS);
    expect(result.error).toBeNull();
    expect(result.samples).toHaveLength(3);
    expect(result.samples[0].depthFt).toBeCloseTo(0.43, 1);
    expect(result.samples[1].depthFt).toBeCloseTo(12.35, 1);
    expect(result.samples[2].depthFt).toBeCloseTo(19.36, 1);
    // Every sample carries the original point's coordinates through.
    expect(result.samples[1].latitude).toBe(POINTS[1].latitude);
    expect(result.samples[1].longitude).toBe(POINTS[1].longitude);
  });

  it("backfills only the NoData points from CUDEM, keeping BAG values for the rest", async () => {
    const fetchMock = vi
      .fn()
      // Primary BAG batch: point 1 is NoData.
      .mockResolvedValueOnce(
        jsonResponse({
          samples: [
            { locationId: 0, value: "-10" },
            { locationId: 1, value: "NoData" },
            { locationId: 2, value: "-20" },
          ],
        }),
      )
      // Backfill batch, restricted to just the gap point.
      .mockResolvedValueOnce(jsonResponse({ samples: [{ locationId: 0, value: "-11" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthsFt(POINTS);
    expect(result.error).toBeNull();
    expect(result.samples[0].depthFt).toBeCloseTo(32.8, 1); // from BAG, unchanged
    expect(result.samples[1].depthFt).toBeCloseTo(36.09, 1); // backfilled from DEM
    expect(result.samples[2].depthFt).toBeCloseTo(65.6, 1); // from BAG, unchanged

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, backfillInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const backfillBody = new URLSearchParams(backfillInit.body as string);
    const backfillGeometry = JSON.parse(backfillBody.get("geometry") ?? "{}");
    // Only the one gap point was sent to the backfill request, not all three.
    expect(backfillGeometry.points).toHaveLength(1);
  });

  it("falls back the whole batch to CUDEM when the BAG batch request fails outright", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }))
      .mockResolvedValueOnce(
        jsonResponse({
          samples: [
            { locationId: 0, value: "-10" },
            { locationId: 1, value: "-15" },
            { locationId: 2, value: "-20" },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthsFt(POINTS);
    expect(result.error).toBeNull();
    expect(result.samples).toHaveLength(3);
    expect(result.samples[0].depthFt).toBeCloseTo(32.8, 1);
  });

  it("returns null depth for every point, with an error, when both services fail outright", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 503 }))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthsFt(POINTS);
    expect(result.error).toContain("503");
    expect(result.error).toContain("500");
    expect(result.samples).toHaveLength(3);
    expect(result.samples.every((s) => s.depthFt === null)).toBe(true);
  });

  it("does not fail the whole batch when only the backfill request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          samples: [
            { locationId: 0, value: "-10" },
            { locationId: 1, value: "NoData" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthsFt(POINTS.slice(0, 2));
    expect(result.error).toBeNull(); // the batch as a whole still succeeded
    expect(result.samples[0].depthFt).toBeCloseTo(32.8, 1);
    expect(result.samples[1].depthFt).toBeNull(); // gap could not be backfilled
  });

  it("returns an empty result for an empty input without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDepthsFt([]);
    expect(result).toEqual({ samples: [], error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sampleDepthTransect", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const ENTRY = { latitude: 26.1867, longitude: -80.09498 };

  it("places each sample at its intended distance offshore, matching sampleTransect's stepping", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        samples: [0, 1, 2].map((locationId) => ({ locationId, value: "-5" })),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sampleDepthTransect(ENTRY, { stepYards: 500, maxYards: 1000 });
    expect(result.error).toBeNull();
    expect(result.samples).toHaveLength(3); // 0, 500, 1000 — same as sampleTransect

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    const geometry = JSON.parse(body.get("geometry") ?? "{}");
    expect(geometry.points).toHaveLength(3);
    expect(geometry.points[0]).toEqual([ENTRY.longitude, ENTRY.latitude]);
  });

  it("never omits a step, unlike sampleTransect — a NoData point is still reported, as null", async () => {
    // Primary batch: point 1 is NoData. Second call is the DEM backfill of
    // just that one gap point, also NoData.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          samples: [
            { locationId: 0, value: "-5" },
            { locationId: 1, value: "NoData" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ samples: [{ locationId: 0, value: "NoData" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sampleDepthTransect(ENTRY, { stepYards: 500, maxYards: 500 });
    expect(result.samples).toHaveLength(2);
    expect(result.samples[1].depthFt).toBeNull();
  });

  it("returns empty rather than looping forever on a non-positive step or range", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await sampleDepthTransect(ENTRY, { stepYards: 0 })).toEqual({ samples: [], error: null });
    expect(await sampleDepthTransect(ENTRY, { stepYards: -25 })).toEqual({ samples: [], error: null });
    expect(await sampleDepthTransect(ENTRY, { maxYards: 0 })).toEqual({ samples: [], error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
