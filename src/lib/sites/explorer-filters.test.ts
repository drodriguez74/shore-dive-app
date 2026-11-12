import { describe, expect, it } from "vitest";
import { matchesSiteFilters, type SiteFilters } from "./explorer-filters";
import type { SiteMarker } from "./types";

const ALL: SiteFilters = { siteTypeFilter: "all", difficultyFilter: "all", shoreAccessFilter: "all" };

function site(overrides: Partial<SiteMarker> = {}): SiteMarker {
  return {
    id: "s",
    name: "S",
    latitude: 26.7,
    longitude: -80.1,
    provenance: "COMMUNITY",
    legal_access_status: null,
    site_type: "shore_reef",
    hasHazardReport: false,
    ...overrides,
  };
}

describe("matchesSiteFilters", () => {
  it("matches everything with no filter active", () => {
    expect(matchesSiteFilters(site(), ALL)).toBe(true);
  });

  it("filters by site type", () => {
    expect(matchesSiteFilters(site({ site_type: "cave" }), { ...ALL, siteTypeFilter: "cave" })).toBe(true);
    expect(matchesSiteFilters(site({ site_type: "cave" }), { ...ALL, siteTypeFilter: "shipwreck" })).toBe(false);
  });

  it("groups likely and marginal shore access together, and keeps unclassified sites out of both named buckets", () => {
    const accessible = { ...ALL, shoreAccessFilter: "accessible" as const };
    const boat = { ...ALL, shoreAccessFilter: "boat" as const };

    expect(matchesSiteFilters(site({ shore_access: "likely" }), accessible)).toBe(true);
    expect(matchesSiteFilters(site({ shore_access: "marginal" }), accessible)).toBe(true);
    expect(matchesSiteFilters(site({ shore_access: "unlikely" }), boat)).toBe(true);
    expect(matchesSiteFilters(site({ shore_access: null }), accessible)).toBe(false);
    expect(matchesSiteFilters(site({ shore_access: null }), boat)).toBe(false);
    expect(matchesSiteFilters(site({ shore_access: null }), ALL)).toBe(true);
  });

  it("never sweeps a site with no measured difficulty into a named difficulty", () => {
    const unknown = site({ site_type: "unclassified", depth_min_ft: null, depth_max_ft: null });
    expect(matchesSiteFilters(unknown, { ...ALL, difficultyFilter: "beginner" })).toBe(false);
    expect(matchesSiteFilters(unknown, ALL)).toBe(true);
  });

  it("requires every active filter to match", () => {
    const filters: SiteFilters = { siteTypeFilter: "cave", difficultyFilter: "all", shoreAccessFilter: "accessible" };
    expect(matchesSiteFilters(site({ site_type: "cave", shore_access: "likely" }), filters)).toBe(true);
    expect(matchesSiteFilters(site({ site_type: "cave", shore_access: "unlikely" }), filters)).toBe(false);
  });
});
