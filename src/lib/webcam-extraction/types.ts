/**
 * Shared types for the Visual Telemetry Extraction Pipeline (Task 18).
 * Kept in one place so the DB row shape (0004_webcam_readings.sql), the
 * vision-model response shape, and the UI (T18.4) all agree on the same
 * vocabulary instead of drifting independently.
 */

/**
 * Matches the `webcam_chop_state` Postgres enum in
 * `supabase/migrations/0004_webcam_readings.sql`. Keep these two lists in
 * sync by hand — there's no generated-types pipeline wired up yet (no live
 * Supabase project exists, P0-A.1).
 */
export const CHOP_STATES = ["calm", "light", "moderate", "rough", "severe"] as const;
export type ChopState = (typeof CHOP_STATES)[number];

export function isChopState(value: unknown): value is ChopState {
  return typeof value === "string" && (CHOP_STATES as readonly string[]).includes(value);
}

/** A `camera_sources` allowlist row (0003_camera_sources.sql), narrowed to the fields this pipeline needs. */
export interface ApprovedCameraSource {
  id: string;
  name: string;
  source_url: string;
}

/** A row as stored in / read from `webcam_readings` (0004_webcam_readings.sql). */
export interface WebcamReading {
  id: string;
  cameraSourceId: string;
  visibilityMeters: number | null;
  chopState: ChopState | null;
  /** 0-1. */
  confidence: number;
  modelId: string;
  /** ISO 8601 — when the source frame was captured. */
  capturedAt: string;
  /** ISO 8601 — when this row was inserted (server-side bookkeeping; see T18.5's rate cap). */
  createdAt: string;
}

/** The exact shape written to `webcam_readings` by the worker (snake_case, matching the DB columns). */
export interface WebcamReadingInsert {
  camera_source_id: string;
  visibility_meters: number | null;
  chop_state: ChopState | null;
  confidence: number;
  model_id: string;
  captured_at: string;
}

/** The raw shape a `select("*")` (or equivalent) against `webcam_readings` returns — snake_case, matching the DB columns exactly. */
export interface WebcamReadingRow {
  id: string;
  camera_source_id: string;
  visibility_meters: number | null;
  chop_state: string | null;
  confidence: number;
  model_id: string;
  captured_at: string;
  created_at: string;
}

/**
 * Maps a raw DB row into the UI-facing `WebcamReading` shape (used by
 * `src/components/webcam-readings/reading-badge.tsx`, T18.4). Validates
 * `chop_state` against the known enum rather than trusting the DB
 * round-trip blindly — cheap defense in depth, same reasoning as
 * `shape-reading.ts`'s "don't trust a field just because it came from a
 * structured source."
 */
export function mapWebcamReadingRow(row: WebcamReadingRow): WebcamReading {
  return {
    id: row.id,
    cameraSourceId: row.camera_source_id,
    visibilityMeters: row.visibility_meters,
    chopState: isChopState(row.chop_state) ? row.chop_state : null,
    confidence: row.confidence,
    modelId: row.model_id,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
  };
}
