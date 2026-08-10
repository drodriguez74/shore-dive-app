import { describe, expect, it } from "vitest";
import { boundingBoxForRadius, distanceMiles, sortByDistanceWithinRadius } from "./distance";

describe("distanceMiles", () => {
  it("returns 0 for the same point", () => {
    expect(distanceMiles({ latitude: 32.8328, longitude: -117.2713 }, { latitude: 32.8328, longitude: -117.2713 })).toBe(0);
  });

  it("matches a known reference distance within a small tolerance (NYC to LA, ~2451 mi)", () => {
    const nyc = { latitude: 40.7128, longitude: -74.006 };
    const la = { latitude: 34.0522, longitude: -118.2437 };
    expect(distanceMiles(nyc, la)).toBeGreaterThan(2400);
    expect(distanceMiles(nyc, la)).toBeLessThan(2500);
  });

  it("is symmetric (a to b equals b to a)", () => {
    const a = { latitude: 32.8328, longitude: -117.2713 };
    const b = { latitude: 26.1224, longitude: -80.1373 };
    expect(distanceMiles(a, b)).toBeCloseTo(distanceMiles(b, a), 9);
  });

  it("puts La Jolla Cove and Casino Point (both real seeded CA sites) roughly 90 miles apart", () => {
    const laJolla = { latitude: 32.8328, longitude: -117.2713 };
    const casinoPoint = { latitude: 33.3428, longitude: -118.3208 };
    const miles = distanceMiles(laJolla, casinoPoint);
    expect(miles).toBeGreaterThan(70);
    expect(miles).toBeLessThan(110);
  });
});

describe("sortByDistanceWithinRadius", () => {
  const center = { latitude: 32.8328, longitude: -117.2713 }; // La Jolla Cove

  it("excludes items outside the radius", () => {
    const laJolla = { id: "near", latitude: 32.8328, longitude: -117.2713 };
    const nyc = { id: "far", latitude: 40.7128, longitude: -74.006 };
    const result = sortByDistanceWithinRadius([laJolla, nyc], center, 25);
    expect(result.map((r) => r.id)).toEqual(["near"]);
  });

  it("sorts nearest-first", () => {
    const near = { id: "near", latitude: 32.84, longitude: -117.27 }; // ~a mile or two away
    const mid = { id: "mid", latitude: 33.3428, longitude: -118.3208 }; // Casino Point, ~90mi
    const far = { id: "far", latitude: 34.0522, longitude: -118.2437 }; // LA, farther still
    const result = sortByDistanceWithinRadius([far, near, mid], center, 200);
    expect(result.map((r) => r.id)).toEqual(["near", "mid", "far"]);
  });

  it("includes an item exactly at the radius boundary", () => {
    const casinoPoint = { id: "boundary", latitude: 33.3428, longitude: -118.3208 };
    const miles = distanceMiles(center, casinoPoint);
    const result = sortByDistanceWithinRadius([casinoPoint], center, miles);
    expect(result.map((r) => r.id)).toEqual(["boundary"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(sortByDistanceWithinRadius([], center, 25)).toEqual([]);
  });

  it("preserves the rest of each item's shape, not just id/lat/lng", () => {
    const site = { id: "1", latitude: 32.8328, longitude: -117.2713, name: "La Jolla Cove", provenance: "VERIFIED" as const };
    const result = sortByDistanceWithinRadius([site], center, 5);
    expect(result[0]).toEqual(site);
  });
});

describe("boundingBoxForRadius", () => {
  /** Walks the compass around `center` at exactly `radiusMiles` and asserts
   * every resulting point falls inside the box. This is THE property that
   * matters: a box that isn't a superset of the circle silently drops sites
   * that are genuinely in range. Longitude comparison accounts for a box
   * that wraps the antimeridian (west > east). */
  function assertCoversCircle(center: { latitude: number; longitude: number }, radiusMiles: number) {
    const box = boundingBoxForRadius(center, radiusMiles);
    const wrapsAntimeridian = box.west > box.east;

    for (let bearing = 0; bearing < 360; bearing += 5) {
      const rad = (bearing * Math.PI) / 180;
      // Offsets using a *larger* miles-per-degree than the implementation's
      // conservative 69, so these probe points sit at/just inside the true
      // circle edge — if the box only barely covered them the test would be
      // proving nothing.
      const latOffset = (radiusMiles * Math.cos(rad)) / 69.4;
      const probeLat = center.latitude + latOffset;
      const lngOffset =
        (radiusMiles * Math.sin(rad)) / (69.4 * Math.max(Math.cos((probeLat * Math.PI) / 180), 1e-6));
      const probeLng = ((((center.longitude + lngOffset + 180) % 360) + 360) % 360) - 180;

      expect(probeLat).toBeLessThanOrEqual(box.north + 1e-9);
      expect(probeLat).toBeGreaterThanOrEqual(box.south - 1e-9);

      const lngInside = wrapsAntimeridian
        ? probeLng >= box.west - 1e-9 || probeLng <= box.east + 1e-9
        : probeLng >= box.west - 1e-9 && probeLng <= box.east + 1e-9;
      expect(lngInside).toBe(true);
    }
  }

  it("fully contains the circle at a mid-latitude (Fort Lauderdale, 25mi)", () => {
    assertCoversCircle({ latitude: 26.1224, longitude: -80.1373 }, 25);
  });

  it("fully contains the circle at the equator", () => {
    assertCoversCircle({ latitude: 0, longitude: 0 }, 50);
  });

  it("fully contains the circle at a high latitude, where longitude degrees are short", () => {
    assertCoversCircle({ latitude: 71, longitude: 25 }, 40);
  });

  it("sizes longitude off the poleward edge, not the center latitude", () => {
    // Northern hemisphere: the box's north edge is furthest from the equator,
    // so the span must exceed what the center latitude alone would imply.
    const center = { latitude: 60, longitude: 0 };
    const box = boundingBoxForRadius(center, 60);
    const spanFromCenterLatitude = 60 / (69 * Math.cos((60 * Math.PI) / 180));
    expect(box.east).toBeGreaterThan(spanFromCenterLatitude);
  });

  it("clamps latitude at the poles instead of exceeding ±90", () => {
    const box = boundingBoxForRadius({ latitude: 89.5, longitude: 10 }, 200);
    expect(box.north).toBe(90);
    expect(box.south).toBeGreaterThanOrEqual(-90);
  });

  it("widens to the full longitude range near a pole rather than dividing by ~0", () => {
    const box = boundingBoxForRadius({ latitude: 90, longitude: 0 }, 10);
    expect(box.west).toBe(-180);
    expect(box.east).toBe(180);
  });

  it("widens to the full longitude range when the radius exceeds half the globe", () => {
    const box = boundingBoxForRadius({ latitude: 0, longitude: 0 }, 20000);
    expect(box.west).toBe(-180);
    expect(box.east).toBe(180);
  });

  it("signals an antimeridian-crossing box as west > east (the contract listSitesInBounds detects)", () => {
    const box = boundingBoxForRadius({ latitude: -17.7, longitude: 179.5 }, 60);
    expect(box.west).toBeGreaterThan(box.east);
    expect(box.west).toBeLessThanOrEqual(180);
    expect(box.east).toBeGreaterThanOrEqual(-180);
  });

  it("covers the circle even when the box wraps the antimeridian", () => {
    assertCoversCircle({ latitude: -17.7, longitude: 179.5 }, 60);
  });
});
