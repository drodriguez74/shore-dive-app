import { describe, expect, it } from "vitest";
import {
  areSameSite,
  clusterSites,
  nameSimilarity,
  normalizeSiteName,
  NAME_SIMILARITY_THRESHOLD,
  type DedupeCandidate,
} from "./dedupe";

/**
 * Cases are drawn from the real aggregation inputs, not invented: FWC's
 * Broward artificial-reef records, OpenStreetMap nodes already imported, and
 * an operator-published South Florida site list. The pairs that matter are the
 * ones where a naive implementation fails in one direction or the other.
 */

function site(id: string, name: string, latitude: number, longitude: number): DedupeCandidate {
  return { id, name, latitude, longitude };
}

/** ~1 mile of latitude ≈ 0.0145°; used to place fixtures at known distances. */
const MILE_LAT = 0.0145;

describe("normalizeSiteName", () => {
  it("drops noise tokens so a qualifier doesn't prevent a match", () => {
    expect(normalizeSiteName("Okinawa Reef")).toEqual(["okinawa"]);
    expect(normalizeSiteName("SS Copenhagen Shipwreck")).toEqual(["copenhagen", "shipwreck"]);
  });

  it("drops a trailing ordinal, so 'Mercedes I' and 'Mercedes' agree", () => {
    expect(normalizeSiteName("Mercedes I")).toEqual(normalizeSiteName("Mercedes"));
  });

  it("keeps a leading number, which is usually meaningful", () => {
    expect(normalizeSiteName("Pompano 3rd Reef")).toContain("3rd");
  });

  it("falls back to raw tokens rather than matching everything when a name is all noise", () => {
    // A site literally named "The Reef" must not normalize to [] and then
    // score 0/1 against everything — or worse, match anything nearby.
    expect(normalizeSiteName("The Reef").length).toBeGreaterThan(0);
  });
});

describe("nameSimilarity", () => {
  it("scores real same-site name variants above the merge threshold", () => {
    expect(nameSimilarity("MERCEDES", "MERCEDES I")).toBeGreaterThanOrEqual(NAME_SIMILARITY_THRESHOLD);
    expect(nameSimilarity("Eternal Reef", "Eternal Reefs")).toBeGreaterThanOrEqual(NAME_SIMILARITY_THRESHOLD);
    expect(nameSimilarity("OKINAWA REEF", "Okinawa")).toBeGreaterThanOrEqual(NAME_SIMILARITY_THRESHOLD);
  });

  it("scores genuinely different sites below the threshold", () => {
    expect(nameSimilarity("Lady Luck", "Guy Harvey")).toBeLessThan(NAME_SIMILARITY_THRESHOLD);
    expect(nameSimilarity("Jay Scutti", "Jim Atria")).toBeLessThan(NAME_SIMILARITY_THRESHOLD);
  });
});

describe("areSameSite", () => {
  it("merges co-located records even when names disagree entirely", () => {
    // FWC ships near-duplicate deployment rows at identical coordinates under
    // slightly different program names. At ~0m these cannot be separate dives.
    const a = site("a", "Eternal Reef", 26.1425, -80.0816);
    const b = site("b", "C2-Eternal Reef", 26.1426, -80.0819);
    expect(areSameSite(a, b)).toBe(true);
  });

  it("merges the same wreck across sources despite coordinate drift, when names agree", () => {
    // FWC warns its positions are largely unverified historical data, so the
    // same wreck legitimately differs by ~100m+ between catalogues.
    const fwc = site("fwc", "MERCEDES", 26.1, -80.08);
    const osm = site("osm", "Mercedes I", 26.1 + MILE_LAT * 0.08, -80.08);
    expect(areSameSite(fwc, osm)).toBe(true);
  });

  it("keeps distinct named vessels in the same deployment area separate", () => {
    // The real failure mode of a distance-only rule: Broward's "rodeo" sites
    // are separate vessels, separate depths, separate dives.
    const a = site("a", "RODEO 25", 26.23, -80.06);
    const b = site("b", "RODEO SITE - RENEGADE", 26.23 + MILE_LAT * 0.1, -80.06);
    expect(areSameSite(a, b)).toBe(false);
  });

  it("does not merge similarly-named sites that are far apart", () => {
    // The real failure mode of a name-only rule: these share most tokens and
    // are several miles apart.
    const a = site("a", "Wreck Trek Boca", 26.35, -80.06);
    const b = site("b", "Wreck Trek Deerfield", 26.31, -80.06);
    expect(areSameSite(a, b)).toBe(false);
  });

  it("is symmetric", () => {
    const a = site("a", "MERCEDES", 26.1, -80.08);
    const b = site("b", "Mercedes I", 26.1001, -80.08);
    expect(areSameSite(a, b)).toBe(areSameSite(b, a));
  });
});

describe("clusterSites", () => {
  it("returns one cluster per distinct site and preserves every input", () => {
    const input = [
      site("1", "MERCEDES", 26.1, -80.08),
      site("2", "Mercedes I", 26.1001, -80.0801),
      site("3", "Lady Luck", 26.2, -80.09),
      site("4", "Guy Harvey", 26.25, -80.1),
    ];
    const clusters = clusterSites(input);
    expect(clusters).toHaveLength(3);
    expect(clusters.flat()).toHaveLength(input.length);
    const merged = clusters.find((c) => c.length === 2)!;
    expect(merged.map((c) => c.id).sort()).toEqual(["1", "2"]);
  });

  it("merges transitively — the reason this is a graph and not a pairwise pass", () => {
    // A~B and B~C, but A and C never match directly (A/C are past the
    // name-required radius from each other). All three are one site.
    const a = site("a", "Copenhagen", 26.2059, -80.0838);
    const b = site("b", "SS Copenhagen", 26.2059 + MILE_LAT * 0.16, -80.0838);
    const c = site("c", "Copenhagen Wreck", 26.2059 + MILE_LAT * 0.32, -80.0838);
    expect(areSameSite(a, c)).toBe(false);
    expect(clusterSites([a, b, c])).toHaveLength(1);
  });

  it("does not chain distinct sites into one blob via the name-agnostic radius", () => {
    // Guard on the transitivity risk: a line of differently-named sites spaced
    // just beyond the co-location radius must stay separate rather than
    // collapsing into a single cluster.
    const spaced = [
      site("1", "Alpha Ledge", 26.0, -80.0),
      site("2", "Bravo Ledge", 26.0 + MILE_LAT * 0.06, -80.0),
      site("3", "Charlie Ledge", 26.0 + MILE_LAT * 0.12, -80.0),
      site("4", "Delta Ledge", 26.0 + MILE_LAT * 0.18, -80.0),
    ];
    expect(clusterSites(spaced)).toHaveLength(4);
  });

  it("is order-stable: the same input yields the same grouping", () => {
    const input = [
      site("1", "MERCEDES", 26.1, -80.08),
      site("2", "Mercedes I", 26.1001, -80.0801),
      site("3", "Lady Luck", 26.2, -80.09),
    ];
    const first = clusterSites(input).map((c) => c.map((x) => x.id).sort().join(","));
    const second = clusterSites([...input]).map((c) => c.map((x) => x.id).sort().join(","));
    expect(first).toEqual(second);
  });

  it("handles empty and single-item input", () => {
    expect(clusterSites([])).toEqual([]);
    expect(clusterSites([site("1", "Solo", 26, -80)])).toHaveLength(1);
  });
});
