import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReefPolygons } from "./urm-client";

// No live network: `fetch` is stubbed per test against fixture-shaped ArcGIS
// responses. The fixtures below mirror what gis.myfwc.com actually returned
// for the Datura Ave entry (verified live 2026-08-09) — rings as
// [ring][vertex][longitude, latitude], `ClassLv1` in `attributes`.

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return { ok, status, json: async () => body } as Response;
}

const ENTRY = { latitude: 26.1867, longitude: -80.09498, radiusMeters: 2000 };

const RING = [
  [-80.0935, 26.1855],
  [-80.0925, 26.1855],
  [-80.0925, 26.1875],
  [-80.0935, 26.1875],
  [-80.0935, 26.1855],
];

describe("fetchReefPolygons", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes features into polygons, keeping every ring", () => {
    const hole = [
      [-80.0933, 26.186],
      [-80.0928, 26.186],
      [-80.0928, 26.187],
      [-80.0933, 26.187],
      [-80.0933, 26.186],
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          features: [
            { attributes: { ClassLv1: "Pavement" }, geometry: { rings: [RING] } },
            { attributes: { ClassLv1: "Aggregate Reef" }, geometry: { rings: [RING, hole] } },
          ],
        }),
      ),
    );

    return fetchReefPolygons(ENTRY).then((result) => {
      expect(result.error).toBeNull();
      expect(result.truncated).toBe(false);
      expect(result.polygons).toHaveLength(2);
      expect(result.polygons[0].habitatClass).toBe("Pavement");
      // Holes must survive normalization — dropping them would make points
      // inside a sand channel read as reef (see isPointInPolygon).
      expect(result.polygons[1].rings).toHaveLength(2);
    });
  });

  it("sends a descriptive User-Agent and a point+distance spatial filter", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ features: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchReefPolygons(ENTRY);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("Unified_Florida_Reef_Tract_Benthic_Habitat");
    // A missing/generic UA is what made every Overpass call 406 for a whole
    // session (see osm-import.ts); don't let this regress silently.
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("shore-dive-app");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("geometryType")).toBe("esriGeometryPoint");
    expect(body.get("units")).toBe("esriSRUnit_Meter");
    expect(body.get("distance")).toBe("2000");
    expect(body.get("outSR")).toBe("4326");
    expect(body.get("outFields")).toBe("ClassLv1");
    expect(body.get("returnGeometry")).toBe("true");
    expect(JSON.parse(body.get("geometry") ?? "{}")).toMatchObject({
      x: ENTRY.longitude,
      y: ENTRY.latitude,
    });
  });

  it("drops features with no geometry, no class, or a degenerate ring", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          features: [
            { attributes: { ClassLv1: "Ridge" }, geometry: { rings: [RING] } },
            { attributes: { ClassLv1: "Ridge" } },
            { attributes: { ClassLv1: null }, geometry: { rings: [RING] } },
            { attributes: { ClassLv1: "  " }, geometry: { rings: [RING] } },
            { attributes: { ClassLv1: "Ridge" }, geometry: { rings: [] } },
            // Two vertices enclose no area — nothing a containment test can use.
            { attributes: { ClassLv1: "Ridge" }, geometry: { rings: [RING.slice(0, 2)] } },
          ],
        }),
      ),
    );

    const result = await fetchReefPolygons(ENTRY);
    expect(result.polygons).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it("reports an ArcGIS error delivered inside an HTTP 200 body", async () => {
    // ArcGIS convention, not an edge case: checking response.ok alone would
    // read this as a successful query returning zero reef.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { code: 400, message: "Unable to complete operation." } })),
    );

    const result = await fetchReefPolygons(ENTRY);
    expect(result.polygons).toEqual([]);
    expect(result.error).toContain("400");
    expect(result.error).toContain("Unable to complete operation.");
  });

  it("flags a truncated result rather than presenting it as the full profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          features: [{ attributes: { ClassLv1: "Pavement" }, geometry: { rings: [RING] } }],
          exceededTransferLimit: true,
        }),
      ),
    );

    const result = await fetchReefPolygons(ENTRY);
    expect(result.truncated).toBe(true);
    expect(result.polygons).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it("returns an explicit error on a non-2xx response instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, { ok: false, status: 503 })));

    const result = await fetchReefPolygons(ENTRY);
    expect(result.polygons).toEqual([]);
    expect(result.error).toContain("503");
  });

  it("returns an explicit error on a network failure instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );

    const result = await fetchReefPolygons(ENTRY);
    expect(result.polygons).toEqual([]);
    expect(result.error).toBe("fetch failed");
  });

  it("returns an explicit error when the body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token < in JSON");
            },
          }) as unknown as Response,
      ),
    );

    const result = await fetchReefPolygons(ENTRY);
    expect(result.polygons).toEqual([]);
    expect(result.error).toContain("Unexpected token");
  });
});
