import { describe, expect, it } from "vitest";
import { shapeExtraction } from "./extract-candidate";
import type { CandidateSourceInput } from "./types";

const BASE_INPUT: CandidateSourceInput = {
  url: "https://example.com/beachcam",
  contextText: "found via municipal open-data portal",
};

describe("shapeExtraction", () => {
  it("normalizes a fully valid, well-formed model response", () => {
    const result = shapeExtraction(
      { name: "  Sunset Beach Cam  ", normalized_url: "https://example.com/beachcam ", confidence: 0.75 },
      BASE_INPUT,
    );
    expect(result).toEqual({
      name: "Sunset Beach Cam",
      sourceUrl: "https://example.com/beachcam",
      siteId: null,
      confidence: 0.75,
    });
  });

  it("falls back to a generic honest name when the model omits one", () => {
    const result = shapeExtraction({ normalized_url: "https://example.com/beachcam", confidence: 0.5 }, BASE_INPUT);
    expect(result.name).toBe("Unnamed webcam candidate");
  });

  it("falls back to a generic name when the model returns a blank/whitespace-only name", () => {
    const result = shapeExtraction({ name: "   ", normalized_url: "https://example.com/beachcam", confidence: 0.5 }, BASE_INPUT);
    expect(result.name).toBe("Unnamed webcam candidate");
  });

  it("falls back to the original input URL when normalized_url is missing", () => {
    const result = shapeExtraction({ name: "Cam", confidence: 0.5 }, BASE_INPUT);
    expect(result.sourceUrl).toBe(BASE_INPUT.url);
  });

  it("falls back to the original input URL when normalized_url is blank", () => {
    const result = shapeExtraction({ name: "Cam", normalized_url: "   ", confidence: 0.5 }, BASE_INPUT);
    expect(result.sourceUrl).toBe(BASE_INPUT.url);
  });

  it("throws when neither normalized_url nor the original input URL is a valid URL", () => {
    const badInput: CandidateSourceInput = { url: "not a url" };
    expect(() => shapeExtraction({ name: "Cam", confidence: 0.5 }, badInput)).toThrow(/not a valid URL/);
  });

  it("throws when the model's normalized_url is malformed, even if the original input URL was valid", () => {
    expect(() => shapeExtraction({ name: "Cam", normalized_url: "not a url", confidence: 0.5 }, BASE_INPUT)).toThrow(
      /not a valid URL/,
    );
  });

  it("clamps confidence above 1 down to 1", () => {
    const result = shapeExtraction({ name: "Cam", normalized_url: BASE_INPUT.url, confidence: 3 }, BASE_INPUT);
    expect(result.confidence).toBe(1);
  });

  it("clamps confidence below 0 up to 0", () => {
    const result = shapeExtraction({ name: "Cam", normalized_url: BASE_INPUT.url, confidence: -2 }, BASE_INPUT);
    expect(result.confidence).toBe(0);
  });

  it("defaults a missing/non-numeric confidence to 0", () => {
    expect(shapeExtraction({ name: "Cam", normalized_url: BASE_INPUT.url }, BASE_INPUT).confidence).toBe(0);
    expect(
      shapeExtraction({ name: "Cam", normalized_url: BASE_INPUT.url, confidence: "high" }, BASE_INPUT).confidence,
    ).toBe(0);
  });

  it("defaults a non-finite confidence to 0", () => {
    expect(
      shapeExtraction({ name: "Cam", normalized_url: BASE_INPUT.url, confidence: Number.NaN }, BASE_INPUT).confidence,
    ).toBe(0);
  });

  it("carries through the suggested site id, or null when absent", () => {
    const withSite = shapeExtraction(
      { name: "Cam", normalized_url: BASE_INPUT.url, confidence: 0.5 },
      { ...BASE_INPUT, suggestedSiteId: "site-42" },
    );
    expect(withSite.siteId).toBe("site-42");

    const withoutSite = shapeExtraction({ name: "Cam", normalized_url: BASE_INPUT.url, confidence: 0.5 }, BASE_INPUT);
    expect(withoutSite.siteId).toBeNull();
  });
});
