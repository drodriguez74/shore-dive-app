import { describe, expect, it } from "vitest";
import {
  computeMapEmptyStateMessage,
  nextAiSearchStateFromResponse,
  nextSearchStateFromResponse,
  siteShoreAccessCategory,
} from "./dive-site-explorer";
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

describe("computeMapEmptyStateMessage — manual map-pan location (2026-08-11)", () => {
  // Found while building "Fetch dive sites here": the existing copy always
  // said "your location", which stops being literally true once `hasCoords`
  // is satisfied by a location the diver picked on the map rather than their
  // own geolocation.

  it("says 'this location' instead of 'your location' when isManualLocation is set", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, isManualLocation: true });
    expect(msg).toContain("No dive sites within 25 mi of this location.");
    expect(msg).not.toMatch(/your location/);
  });

  it("still says 'your location' by default (isManualLocation omitted)", () => {
    const msg = computeMapEmptyStateMessage(BASE);
    expect(msg).toContain("your location");
  });

  it("applies the manual-location wording to the filtered-results branch too", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, siteTypeFilter: "cave", isManualLocation: true });
    expect(msg).toContain("No cave sites within 25 mi of this location.");
  });

  it("applies the manual-location wording to the searched-externally branch too", () => {
    const msg = computeMapEmptyStateMessage({ ...BASE, searchedExternally: true, isManualLocation: true });
    expect(msg).toContain("no dive sites within 25 mi of this location.");
  });
});

describe("nextSearchStateFromResponse", () => {
  // Found 2026-08-10 (founder-reported live bug): the map's pins vanished
  // and the shore-access filter showed zero results, even though the
  // catalogue genuinely has real sites — traced to /api/sites/search-nearby
  // hitting a local DB query failure, which its own contract reports via a
  // 200 response with `error` set and `sites: []` (never a non-200 — a
  // transient DB hiccup shouldn't fail the whole request). The caller used
  // to read only `sites`, so a real backend failure and "genuinely zero
  // sites nearby" produced the identical `{status: "done", sites: []}"`.

  it("treats a response with error set as a failure, not a legitimate empty result", () => {
    const state = nextSearchStateFromResponse(
      { sites: [], error: "TypeError: fetch failed", searchedExternally: false },
      50,
    );
    expect(state.status).toBe("error");
    expect(state.sites).toBeNull();
  });

  it("treats a response with error set and non-empty sites the same way — error always wins", () => {
    // Defensive: the route's own contract says sites is [] whenever error
    // is set, but the caller must not trust that invariant silently — an
    // error means "don't trust this payload," regardless of its shape.
    const state = nextSearchStateFromResponse(
      { sites: [{ id: "x" } as never], error: "some failure", searchedExternally: false },
      50,
    );
    expect(state.status).toBe("error");
    expect(state.sites).toBeNull();
  });

  it("treats a genuinely empty result (no error) as a real done state, not an error", () => {
    // The honest "you really do have zero sites in this radius" case must
    // stay distinct from a failure — this is what lets
    // computeMapEmptyStateMessage say something real instead of every
    // empty result silently becoming a fallback-to-cache.
    const state = nextSearchStateFromResponse({ sites: [], error: null, searchedExternally: true }, 50);
    expect(state.status).toBe("done");
    expect(state.sites).toEqual([]);
    expect(state.searchedExternally).toBe(true);
  });

  it("passes real sites through unchanged on a genuine success", () => {
    const sites = [{ id: "a" } as never, { id: "b" } as never];
    const state = nextSearchStateFromResponse({ sites, error: null, searchedExternally: false }, 100);
    expect(state).toEqual({ status: "done", sites, searchedExternally: false, radiusMiles: 100, truncated: false });
  });

  it("carries a true truncated flag through to the state", () => {
    const state = nextSearchStateFromResponse(
      { sites: [], error: null, searchedExternally: false, truncated: true },
      50,
    );
    expect(state.truncated).toBe(true);
  });

  it("defaults truncated to false when the response omits it (older/mocked response shape)", () => {
    const state = nextSearchStateFromResponse({ sites: [], error: null, searchedExternally: false }, 50);
    expect(state.truncated).toBe(false);
  });

  it("tags the state with the radius it was searched at, matching the request that produced it", () => {
    const state = nextSearchStateFromResponse({ sites: [], error: null, searchedExternally: false }, 250);
    expect(state.radiusMiles).toBe(250);
  });
});

describe("nextAiSearchStateFromResponse", () => {
  // Found live 2026-08-11, the same bug class as nextSearchStateFromResponse
  // above, reproduced on the AI-search-fallback path: POST
  // /api/sites/research-area deliberately returns HTTP 200 with `error` set
  // for an upstream (Brave/Gemini) failure — a real Gemini free-tier quota
  // error rendered identically to "searched the web, found nothing here"
  // before this fix.

  it("treats an HTTP-200 response with error set as a failure, not a legitimate empty result", () => {
    const state = nextAiSearchStateFromResponse(
      { candidates: [], error: "The web-search fallback has hit its free daily limit for now — try again later." },
      true,
      200,
    );
    expect(state.status).toBe("error");
    expect(state.candidates).toEqual([]);
    expect(state.error).toContain("free daily limit");
  });

  it("treats a non-ok response as a failure", () => {
    const state = nextAiSearchStateFromResponse({ error: "Sign in required." }, false, 401);
    expect(state.status).toBe("error");
    expect(state.error).toBe("Sign in required.");
  });

  it("falls back to a status-coded message when a non-ok response has no error field", () => {
    const state = nextAiSearchStateFromResponse({}, false, 500);
    expect(state.status).toBe("error");
    expect(state.error).toContain("500");
  });

  it("treats a genuinely empty result (ok, no error) as a real done state, not an error", () => {
    const state = nextAiSearchStateFromResponse({ candidates: [], error: null }, true, 200);
    expect(state.status).toBe("done");
    expect(state.candidates).toEqual([]);
    expect(state.error).toBeNull();
  });

  it("passes real candidates through unchanged on a genuine success", () => {
    const candidates = [{ name: "Real Site" } as never];
    const state = nextAiSearchStateFromResponse({ candidates, error: null }, true, 200);
    expect(state).toEqual({ status: "done", candidates, error: null });
  });

  it("defaults candidates to an empty array when the response omits the field", () => {
    const state = nextAiSearchStateFromResponse({ error: null }, true, 200);
    expect(state.candidates).toEqual([]);
  });
});
