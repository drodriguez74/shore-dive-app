import { describe, expect, it } from "vitest";
import { distanceMiles } from "./distance";

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
