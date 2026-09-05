import { describe, expect, it } from "vitest";
import { normalizeCandidate } from "./gemini-client";

const VALID: Record<string, unknown> = {
  name: "Playa Grande Reef",
  latitude: 18.4273,
  longitude: -68.9728,
  site_type: "shore_reef",
  depth_min_ft: 10,
  depth_max_ft: 40,
  shore_access_claim: "Reachable by a short surface swim from the beach.",
  research_summary: "A shallow fringing reef described by a local dive shop's site guide.",
  research_sources: [{ title: "Local Dive Shop", url: "https://example.com/reef" }],
};

describe("normalizeCandidate", () => {
  it("passes through a fully valid candidate", () => {
    expect(normalizeCandidate(VALID)).toEqual(VALID);
  });

  it("drops a candidate with no name", () => {
    expect(normalizeCandidate({ ...VALID, name: "" })).toBeNull();
    expect(normalizeCandidate({ ...VALID, name: undefined })).toBeNull();
  });

  it("drops a candidate with no research summary", () => {
    expect(normalizeCandidate({ ...VALID, research_summary: "" })).toBeNull();
  });

  it("drops a candidate with no shore_access_claim", () => {
    expect(normalizeCandidate({ ...VALID, shore_access_claim: "" })).toBeNull();
  });

  it("drops a candidate with zero real citations — no unsourced claim is usable", () => {
    expect(normalizeCandidate({ ...VALID, research_sources: [] })).toBeNull();
  });

  it("filters out a malformed research source instead of keeping a broken entry", () => {
    const result = normalizeCandidate({
      ...VALID,
      research_sources: [{ title: "Real", url: "https://example.com/a" }, { title: "Missing url" }, "not an object"],
    });
    expect(result?.research_sources).toEqual([{ title: "Real", url: "https://example.com/a" }]);
  });

  it("falls back to 'unclassified' for an invalid site_type rather than inventing one", () => {
    const result = normalizeCandidate({ ...VALID, site_type: "not-a-real-type" });
    expect(result?.site_type).toBe("unclassified");
  });

  it("nulls out a non-numeric latitude/longitude rather than keeping garbage", () => {
    const result = normalizeCandidate({ ...VALID, latitude: "not a number", longitude: undefined });
    expect(result?.latitude).toBeNull();
    expect(result?.longitude).toBeNull();
  });

  it("nulls out non-finite depth values", () => {
    const result = normalizeCandidate({ ...VALID, depth_min_ft: Number.NaN, depth_max_ft: Number.POSITIVE_INFINITY });
    expect(result?.depth_min_ft).toBeNull();
    expect(result?.depth_max_ft).toBeNull();
  });

  it("treats a non-object input as invalid, never throws", () => {
    expect(normalizeCandidate("not an object")).toBeNull();
    expect(normalizeCandidate(null)).toBeNull();
    expect(normalizeCandidate(undefined)).toBeNull();
  });
});
