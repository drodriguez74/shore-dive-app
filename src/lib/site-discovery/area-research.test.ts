import { describe, expect, it } from "vitest";
import { discardImplausibleCoordinates, friendlyErrorMessage, type CandidateSite } from "./area-research";

// Bonita Springs, FL — the actual founder-reported case (2026-08-11): a
// "Venice Beach" candidate correctly named/described for Naples/Cape Coral
// came back with Venice Beach, CALIFORNIA's coordinates from the
// coordinate-follow-up pass — a namesake mixup 2,500+ miles away.
const SEARCH_POINT = { latitude: 26.35, longitude: -81.87 };

function candidate(overrides: Partial<CandidateSite> = {}): CandidateSite {
  return {
    name: "Test Site",
    latitude: null,
    longitude: null,
    site_type: "unclassified",
    depth_min_ft: null,
    depth_max_ft: null,
    shore_access_claim: "Boat access.",
    research_summary: "A real site.",
    research_sources: [{ title: "Source", url: "https://example.com" }],
    ...overrides,
  };
}

describe("discardImplausibleCoordinates", () => {
  it("leaves a nearby coordinate untouched", () => {
    // ~15 mi from the search point — well within a plausible search radius.
    const nearby = candidate({ name: "Nearby Reef", latitude: 26.2, longitude: -81.8 });
    const result = discardImplausibleCoordinates(SEARCH_POINT, [nearby]);
    expect(result[0].latitude).toBe(26.2);
    expect(result[0].longitude).toBe(-81.8);
  });

  it("nulls a wildly implausible coordinate — the real Venice Beach, CA namesake case", () => {
    const wrongVeniceBeach = candidate({ name: "Venice Beach", latitude: 33.9771, longitude: -118.467575 });
    const result = discardImplausibleCoordinates(SEARCH_POINT, [wrongVeniceBeach]);
    expect(result[0].latitude).toBeNull();
    expect(result[0].longitude).toBeNull();
    // Everything else about the candidate is preserved — only the
    // coordinate was untrustworthy, not the whole finding.
    expect(result[0].name).toBe("Venice Beach");
  });

  it("nulls a real but too-distant site (~150+ mi) rather than presenting it as 'near here'", () => {
    // Devil's Den, Williston FL — a real site, but ~150+ mi from Bonita
    // Springs, not "near Naples/Cape Coral" for map-pin purposes.
    const tooFar = candidate({ name: "Devil's Den", latitude: 29.4071, longitude: -82.476 });
    const result = discardImplausibleCoordinates(SEARCH_POINT, [tooFar]);
    expect(result[0].latitude).toBeNull();
    expect(result[0].longitude).toBeNull();
  });

  it("leaves an already-null coordinate as null, no distance computed", () => {
    const noCoords = candidate({ name: "Unknown Location" });
    const result = discardImplausibleCoordinates(SEARCH_POINT, [noCoords]);
    expect(result[0].latitude).toBeNull();
    expect(result[0].longitude).toBeNull();
  });

  it("handles a mixed batch independently — one nearby kept, one distant nulled", () => {
    const nearby = candidate({ name: "Nearby Reef", latitude: 26.2, longitude: -81.8 });
    const farAway = candidate({ name: "Venice Beach", latitude: 33.9771, longitude: -118.467575 });
    const result = discardImplausibleCoordinates(SEARCH_POINT, [nearby, farAway]);
    expect(result[0].latitude).toBe(26.2);
    expect(result[1].latitude).toBeNull();
  });
});

describe("friendlyErrorMessage", () => {
  // Found live 2026-08-11: the @google/genai SDK's own Error.message for a
  // real API failure is the raw JSON error body (a multi-hundred-character
  // nested blob) — this is the translation layer that keeps that out of
  // the UI, so it needs to actually recognize the real error shape Google
  // sends, not just an idealized one.
  const REAL_QUOTA_ERROR =
    '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.' +
    ' For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.' +
    ' \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests,' +
    ' limit: 20, model: gemini-3.6-flash\\nPlease retry in 44.200615458s.","status":"RESOURCE_EXHAUSTED"}}';

  it("gives an honest, readable message for the real free-tier quota error", () => {
    const message = friendlyErrorMessage(REAL_QUOTA_ERROR);
    expect(message).toBe("The web-search fallback has hit its free daily limit for now — try again later.");
    expect(message).not.toContain("{");
    expect(message).not.toContain("RESOURCE_EXHAUSTED");
  });

  it("recognizes a generic rate-limit message too, not only this exact API's wording", () => {
    expect(friendlyErrorMessage("rate limit exceeded")).toContain("free daily limit");
    expect(friendlyErrorMessage("Quota exceeded")).toContain("free daily limit");
  });

  it("falls back to a generic message for any other failure, never raw API text", () => {
    const message = friendlyErrorMessage('{"error":{"code":500,"message":"internal server error"}}');
    expect(message).toBe("Something went wrong searching the web — try again.");
    expect(message).not.toContain("{");
  });
});
