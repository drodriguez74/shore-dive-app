import { describe, expect, it } from "vitest";
import { computeMapEmptyStateMessage, siteShoreAccessCategory } from "./dive-site-explorer";
import type { SiteMarker } from "@/lib/sites/types";

function site(overrides: Partial<SiteMarker> = {}): SiteMarker {
  return {
    id: "site-1",
    name: "Test Site",
    latitude: 26.1,
    longitude: -80.1,
    provenance: "COMMUNITY",
    legal_access_status: null,
    site_type: "shore_reef",
    hasHazardReport: false,
    ...overrides,
  };
}

describe("siteShoreAccessCategory", () => {
  it("groups 'likely' and 'marginal' into 'accessible'", () => {
    expect(siteShoreAccessCategory(site({ shore_access: "likely" }))).toBe("accessible");
    expect(siteShoreAccessCategory(site({ shore_access: "marginal" }))).toBe("accessible");
  });

  it("maps 'unlikely' to 'boat'", () => {
    expect(siteShoreAccessCategory(site({ shore_access: "unlikely" }))).toBe("boat");
  });

  it("returns null for a not-yet-classified site, distinct from 'boat'", () => {
    // shore-access.ts's own rule: no known entry is not evidence of
    // boat-only. A site whose shore_access is genuinely null (never
    // classified) must not be silently swept into the boat-access bucket.
    expect(siteShoreAccessCategory(site({ shore_access: null }))).toBeNull();
    expect(siteShoreAccessCategory(site({ shore_access: undefined }))).toBeNull();
  });
});

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
  shoreAccessFilter: "all" as const,
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

describe("computeMapEmptyStateMessage — shore-access filter (2026-08-11)", () => {
  it("names 'shore-accessible' when that filter alone produced the empty result", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, shoreAccessFilter: "accessible" });
    expect(msg).toContain("No shore-accessible sites within 25 mi of your location.");
  });

  it("names 'boat-access' for the boat-access filter, not an overclaiming 'boat-only'", () => {
    // shore-access.ts's own rule: "unlikely" is never rendered as a
    // certainty. The filter label mirrors that hedge rather than asserting
    // these sites categorically require a boat.
    const msg = computeMapEmptyStateMessage({ ...BASE, shoreAccessFilter: "boat" });
    expect(msg).toContain("No boat-access sites within 25 mi of your location.");
  });

  it("combines shore-access with type and difficulty, shore-access reading first", () => {
    const msg = computeMapEmptyStateMessage({
      ...BASE,
      shoreAccessFilter: "accessible",
      difficultyFilter: "beginner",
      siteTypeFilter: "cave",
    });
    expect(msg).toContain("No shore-accessible beginner cave sites within 25 mi of your location.");
  });

  it("treats shoreAccessFilter as an active filter for the noFilterActive branch", () => {
    // Regression guard: noFilterActive must check all three filters, not
    // just type/difficulty — otherwise a shore-access-only filter would
    // wrongly fall into the "no filter active" wording branch (which
    // credits/blames distance and OpenStreetMap, not the filter).
    const msg = computeMapEmptyStateMessage({ ...BASE, shoreAccessFilter: "accessible", searchedExternally: true });
    expect(msg).not.toMatch(/OpenStreetMap/);
    expect(msg).toMatch(/clearing filters/i);
  });
});
