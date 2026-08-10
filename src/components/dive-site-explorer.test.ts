import { describe, expect, it } from "vitest";
import { computeMapEmptyStateMessage } from "./dive-site-explorer";

/**
 * Regression coverage for the founder-reported bug (2026-08-10): the map's
 * pins rendered on load, then silently vanished once real geolocation
 * resolved to a radius-filtered empty set, with no on-map explanation for
 * why. This is the decision tree behind the message that now explains it —
 * see `computeMapEmptyStateMessage`'s own header for the four real branches.
 */

const BASE = {
  resultCount: 0,
  hasCoords: true,
  radiusMiles: 25,
  siteTypeFilter: "all" as const,
  difficultyFilter: "all" as const,
  searchedExternally: false,
};

describe("computeMapEmptyStateMessage — nothing to explain", () => {
  it("returns null when there are results", () => {
    expect(computeMapEmptyStateMessage({ ...BASE, resultCount: 5 })).toBeNull();
  });

  it("returns null before geolocation has resolved (still showing the full fallback set)", () => {
    expect(computeMapEmptyStateMessage({ ...BASE, hasCoords: false })).toBeNull();
  });

  it("returns null for the 'All' radius — a global empty result isn't this function's job", () => {
    expect(computeMapEmptyStateMessage({ ...BASE, radiusMiles: Infinity })).toBeNull();
  });
});

describe("computeMapEmptyStateMessage — the founder-reported case: no filters, radius-empty", () => {
  it("names the radius plainly and suggests expanding when a larger radius exists", () => {
    const msg = computeMapEmptyStateMessage(BASE);
    expect(msg).toContain("No dive sites within 25 mi of your location.");
    expect(msg).toMatch(/try expanding the radius/i);
  });

  it("drops the 'try expanding' suggestion at the largest radius option (250 mi) — nowhere further to go", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, radiusMiles: 250 });
    expect(msg).toContain("No dive sites within 250 mi of your location.");
    expect(msg).not.toMatch(/try expanding/i);
  });

  it("mentions the OpenStreetMap check when an external search actually ran", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, searchedExternally: true });
    expect(msg).toMatch(/OpenStreetMap/);
  });
});

describe("computeMapEmptyStateMessage — a filter, not just distance, produced the empty result", () => {
  it("names the active type filter", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, siteTypeFilter: "cave" });
    expect(msg).toContain("No cave sites within 25 mi of your location.");
  });

  it("names both filters together when type and difficulty are both active", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, siteTypeFilter: "cave", difficultyFilter: "beginner" });
    expect(msg).toContain("No beginner cave sites within 25 mi of your location.");
  });

  it("suggests clearing filters (not just expanding radius) when a filter is active", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, siteTypeFilter: "cave" });
    expect(msg).toMatch(/clearing filters/i);
  });

  it("never mentions OpenStreetMap when a filter (not distance) is why results are empty", () => {
    // searchedExternally being true is irrelevant here — the external search
    // doesn't know about client-side type/difficulty filters, so crediting it
    // would misattribute why the result is empty.
    const msg = computeMapEmptyStateMessage({ ...BASE, siteTypeFilter: "cave", searchedExternally: true });
    expect(msg).not.toMatch(/OpenStreetMap/);
  });
});
