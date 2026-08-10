import { describe, expect, it } from "vitest";
import { shapeReading, type RawModelOutput } from "./shape-reading";

const INPUT = {
  cameraSourceId: "camera-1",
  modelId: "claude-haiku-4-5-20251001",
  capturedAt: "2026-08-06T12:00:00.000Z",
};

describe("shapeReading", () => {
  it("passes through a fully valid response", () => {
    const raw: RawModelOutput = { visibility_meters: 12.5, chop_state: "moderate", confidence: 0.8 };
    expect(shapeReading(raw, INPUT)).toEqual({
      camera_source_id: "camera-1",
      visibility_meters: 12.5,
      chop_state: "moderate",
      confidence: 0.8,
      model_id: "claude-haiku-4-5-20251001",
      captured_at: "2026-08-06T12:00:00.000Z",
    });
  });

  it("treats a non-object response as an empty record (defaults, never throws)", () => {
    const result = shapeReading("not an object", INPUT);
    expect(result.visibility_meters).toBeNull();
    expect(result.chop_state).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("treats null/undefined visibility as not-estimated (null)", () => {
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: 0.5 }, INPUT).visibility_meters).toBeNull();
    expect(shapeReading({ chop_state: null, confidence: 0.5 }, INPUT).visibility_meters).toBeNull();
  });

  it("nulls out a non-numeric visibility_meters", () => {
    const result = shapeReading({ visibility_meters: "far", chop_state: null, confidence: 0.5 }, INPUT);
    expect(result.visibility_meters).toBeNull();
  });

  it("nulls out a non-finite visibility_meters", () => {
    const result = shapeReading({ visibility_meters: Number.NaN, chop_state: null, confidence: 0.5 }, INPUT);
    expect(result.visibility_meters).toBeNull();
    const infinityResult = shapeReading({ visibility_meters: Number.POSITIVE_INFINITY, chop_state: null, confidence: 0.5 }, INPUT);
    expect(infinityResult.visibility_meters).toBeNull();
  });

  it("nulls out a negative visibility_meters", () => {
    const result = shapeReading({ visibility_meters: -1, chop_state: null, confidence: 0.5 }, INPUT);
    expect(result.visibility_meters).toBeNull();
  });

  it("rounds visibility_meters to the DB's numeric(5,2) precision", () => {
    const result = shapeReading({ visibility_meters: 12.3456, chop_state: null, confidence: 0.5 }, INPUT);
    expect(result.visibility_meters).toBe(12.35);
  });

  it("allows a zero visibility_meters (boundary, not treated as falsy/missing)", () => {
    const result = shapeReading({ visibility_meters: 0, chop_state: null, confidence: 0.5 }, INPUT);
    expect(result.visibility_meters).toBe(0);
  });

  it("accepts every valid chop_state enum value", () => {
    for (const state of ["calm", "light", "moderate", "rough", "severe"] as const) {
      expect(shapeReading({ visibility_meters: null, chop_state: state, confidence: 0.5 }, INPUT).chop_state).toBe(state);
    }
  });

  it("nulls out an invalid chop_state string", () => {
    const result = shapeReading({ visibility_meters: null, chop_state: "hurricane", confidence: 0.5 }, INPUT);
    expect(result.chop_state).toBeNull();
  });

  it("nulls out a non-string chop_state", () => {
    const result = shapeReading({ visibility_meters: null, chop_state: 7, confidence: 0.5 }, INPUT);
    expect(result.chop_state).toBeNull();
  });

  it("clamps confidence above 1 down to 1", () => {
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: 1.5 }, INPUT).confidence).toBe(1);
  });

  it("clamps confidence below 0 up to 0", () => {
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: -0.5 }, INPUT).confidence).toBe(0);
  });

  it("defaults a non-numeric confidence to 0 rather than nulling the row", () => {
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: "high" }, INPUT).confidence).toBe(0);
  });

  it("defaults a non-finite confidence to 0", () => {
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: Number.NaN }, INPUT).confidence).toBe(0);
  });

  it("accepts confidence at the exact 0 and 1 boundaries", () => {
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: 0 }, INPUT).confidence).toBe(0);
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: 1 }, INPUT).confidence).toBe(1);
  });

  it("rounds confidence to two decimal places", () => {
    expect(shapeReading({ visibility_meters: null, chop_state: null, confidence: 0.8765 }, INPUT).confidence).toBe(0.88);
  });

  it("always carries through the caller-supplied identity fields", () => {
    const result = shapeReading({ visibility_meters: null, chop_state: null, confidence: 0 }, INPUT);
    expect(result.camera_source_id).toBe(INPUT.cameraSourceId);
    expect(result.model_id).toBe(INPUT.modelId);
    expect(result.captured_at).toBe(INPUT.capturedAt);
  });
});
