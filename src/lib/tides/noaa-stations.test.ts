import { describe, expect, it } from "vitest";
import { findNearestNoaaStation, noaaTidePredictionsUrl, NOAA_STATION_MAX_DISTANCE_MILES } from "./noaa-stations";

/**
 * Real coordinates, reused rather than invented: every Florida fixture below
 * is a curated `ShoreEntryPoint` already in `src/lib/sites/shore-access.ts`
 * (`SOUTH_FLORIDA_ENTRY_POINTS`), so these tests double as a live check that
 * this catalogue's own real shore-dive entries land near a real NOAA
 * station, not just that the matching arithmetic works in the abstract.
 * Expected station ids/names/distances were independently verified against
 * NOAA's own `stations.json?type=tidepredictions` response (the same source
 * `noaa-reference-stations.json` was generated from) before being pinned
 * here, the same "pin a named real-world case" discipline
 * `shore-access.test.ts` uses for its Datura baseline.
 */

describe("findNearestNoaaStation", () => {
  it("matches the Datura Avenue (LBTS) shore entry to the Anglin Fishing Pier station, ~0.2mi away", () => {
    const result = findNearestNoaaStation({ latitude: 26.1867, longitude: -80.09498 });
    expect(result).not.toBeNull();
    expect(result!.station.id).toBe("8722899");
    expect(result!.station.name).toContain("Anglin");
    expect(result!.distanceMiles).toBeGreaterThan(0);
    expect(result!.distanceMiles).toBeLessThan(1);
  });

  it("matches the Phil Foster Park (Blue Heron Bridge) entry to the Port of Palm Beach station, ~1.1mi away", () => {
    const result = findNearestNoaaStation({ latitude: 26.7841, longitude: -80.04242 });
    expect(result).not.toBeNull();
    expect(result!.station.id).toBe("8722588");
    expect(result!.distanceMiles).toBeGreaterThan(0.5);
    expect(result!.distanceMiles).toBeLessThan(2);
  });

  it("matches the Delray Municipal Beach entry to the South Delray Beach (ICWW) station, ~0.6mi away", () => {
    const result = findNearestNoaaStation({ latitude: 26.45227, longitude: -80.05817 });
    expect(result).not.toBeNull();
    expect(result!.station.id).toBe("8722761");
    expect(result!.distanceMiles).toBeGreaterThan(0.1);
    expect(result!.distanceMiles).toBeLessThan(2);
  });

  it("matches the North Beach Oceanside Park (Miami Beach) entry to a real nearby station within the cutoff", () => {
    const result = findNearestNoaaStation({ latitude: 25.8652239, longitude: -80.1189714 });
    expect(result).not.toBeNull();
    expect(result!.distanceMiles).toBeLessThan(NOAA_STATION_MAX_DISTANCE_MILES);
  });

  it("returns null for a real dive site far from any NOAA station (Tulamben, Bali — NOAA/CO-OPS has no non-US coverage)", () => {
    const result = findNearestNoaaStation({ latitude: -8.2822, longitude: 115.5931 });
    expect(result).toBeNull();
  });

  it("returns null for an inland/mid-ocean point with nothing within the cutoff", () => {
    // Mid-Pacific, nowhere near any US coastline or territory.
    const result = findNearestNoaaStation({ latitude: 10, longitude: -160 });
    expect(result).toBeNull();
  });

  it("never returns a station farther than NOAA_STATION_MAX_DISTANCE_MILES", () => {
    // A broad sample of real and near-real coordinates, US and non-US —
    // the invariant under test is the cutoff itself, not any one match.
    const points = [
      { latitude: 26.1867, longitude: -80.09498 }, // Datura, FL
      { latitude: 32.8328, longitude: -117.2713 }, // La Jolla Cove, CA
      { latitude: 40.7128, longitude: -74.006 }, // NYC
      { latitude: -8.2822, longitude: 115.5931 }, // Bali
      { latitude: 51.5074, longitude: -0.1278 }, // London
    ];
    for (const point of points) {
      const result = findNearestNoaaStation(point);
      if (result) {
        expect(result.distanceMiles).toBeLessThanOrEqual(NOAA_STATION_MAX_DISTANCE_MILES);
      }
    }
  });
});

describe("noaaTidePredictionsUrl", () => {
  it("builds NOAA's own public prediction page URL for a station id", () => {
    expect(noaaTidePredictionsUrl("8722899")).toBe(
      "https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=8722899",
    );
  });

  it("URL-encodes the station id defensively, even though real ids are always numeric", () => {
    expect(noaaTidePredictionsUrl("abc/123")).toBe(
      "https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=abc%2F123",
    );
  });
});
