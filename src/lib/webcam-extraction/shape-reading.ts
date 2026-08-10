import { isChopState, type ChopState, type WebcamReadingInsert } from "./types";
import { logger } from "./logger";

/**
 * Pure result-shaping/validation logic (T18.3/T18.5's "confidence/result
 * shaping" needs no live credentials to be genuinely correct today, per
 * this feature's real-vs-stubbed split — see `vision-client.ts`'s header
 * for the full breakdown). This is the one place a model's raw output
 * becomes a row this app is willing to write to `webcam_readings`.
 *
 * Defense in depth: `output_config.format` (used in `vision-client.ts`)
 * constrains the *shape* of the model's JSON response, but shape
 * constraints don't guarantee semantic correctness — a model could still
 * return `confidence: 1.5` or a `chop_state` string that doesn't match the
 * schema's enum if something upstream (a schema mismatch, an SDK version
 * skew, a model that ignores the constraint) goes wrong. Treat the raw
 * response as untrusted input and validate/clamp every field, the same way
 * `bundle-verification.ts` never trusts a manifest just because it parsed.
 */

/** The (untrusted) shape expected back from the vision model — see `vision-client.ts`'s JSON schema, which this mirrors. */
export interface RawModelOutput {
  visibility_meters: number | null;
  chop_state: string | null;
  confidence: number;
}

export interface ShapeReadingInput {
  cameraSourceId: string;
  modelId: string;
  /** ISO 8601 — when the source frame was captured. */
  capturedAt: string;
}

/**
 * Validates and clamps a raw model response into the exact shape
 * `webcam_readings` expects. Never throws — an out-of-range or malformed
 * field is corrected/dropped (logged) rather than propagated, since a
 * single malformed field in an otherwise-usable reading shouldn't discard
 * the whole extraction. Malformed `visibility_meters`/`chop_state` become
 * `null` (matches the DB columns' "not estimated" semantics); a malformed
 * `confidence` is clamped into [0, 1] rather than nulled, since every row
 * requires a non-null confidence (0004_webcam_readings.sql `not null`
 * constraint) and clamping toward the nearer bound is a safer failure mode
 * than fabricating a mid-range value.
 */
export function shapeReading(raw: unknown, input: ShapeReadingInput): WebcamReadingInsert {
  const record = isRecord(raw) ? raw : {};

  if (!isRecord(raw)) {
    logger.warn("shape-reading-non-object-response", { cameraSourceId: input.cameraSourceId });
  }

  const visibilityMeters = normalizeVisibility(record.visibility_meters, input.cameraSourceId);
  const chopState = normalizeChopState(record.chop_state, input.cameraSourceId);
  const confidence = normalizeConfidence(record.confidence, input.cameraSourceId);

  return {
    camera_source_id: input.cameraSourceId,
    visibility_meters: visibilityMeters,
    chop_state: chopState,
    confidence,
    model_id: input.modelId,
    captured_at: input.capturedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeVisibility(value: unknown, cameraSourceId: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    logger.warn("shape-reading-invalid-visibility", { cameraSourceId, value });
    return null;
  }
  if (value < 0) {
    logger.warn("shape-reading-negative-visibility", { cameraSourceId, value });
    return null;
  }
  // Matches the DB column's numeric(5,2) precision — round rather than let
  // Postgres silently truncate a value this code already validated.
  return Math.round(value * 100) / 100;
}

function normalizeChopState(value: unknown, cameraSourceId: string): ChopState | null {
  if (value === null || value === undefined) return null;
  if (!isChopState(value)) {
    logger.warn("shape-reading-invalid-chop-state", { cameraSourceId, value });
    return null;
  }
  return value;
}

function normalizeConfidence(value: unknown, cameraSourceId: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    logger.warn("shape-reading-invalid-confidence-defaulting-to-zero", { cameraSourceId, value });
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 100) / 100;
}
