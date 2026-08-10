import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateCap, resolveDailyCap, type RateCapCheckResult } from "./rate-cap";
import { fetchCameraSnapshot } from "./snapshot-fetch";
import { extractVisibilityAndChop } from "./vision-client";
import { shapeReading } from "./shape-reading";
import { WEBCAM_EXTRACTION_MODEL_ID } from "./model";
import { logger } from "./logger";
import type { ApprovedCameraSource, WebcamReadingInsert } from "./types";

/**
 * Orchestrates one run of the Visual Telemetry Extraction Pipeline
 * (Task 18): check the founder-confirmation feature flag, check the T18.5
 * rate cap, pull approved camera sources (T17.1's allowlist gate), and run
 * the fetch -> vision-model -> shape -> write pipeline for each one, bounded
 * by whatever cap headroom remains.
 *
 * Called from both the cron (`GET`) and manual/dev (`POST`) paths of
 * `src/app/api/cron/webcam-extraction/route.ts` — the route layer owns
 * request auth, this module owns the actual work, so both entry points
 * share identical behavior.
 */

/**
 * Explicit founder-confirmation gate — see `model.ts`'s header for the
 * full reasoning. Defaults to disabled (any value other than the literal
 * string "true" is treated as off, including unset). This is the one
 * switch that turns real API spend on; nothing else in this pipeline
 * should bypass it.
 */
export function isWebcamExtractionEnabled(): boolean {
  return process.env.WEBCAM_EXTRACTION_ENABLED === "true";
}

export interface ExtractionRunSummary {
  enabled: boolean;
  /** True when the run stopped immediately because the daily cap was already reached (or its count was unavailable). */
  capReached: boolean;
  callsToday: number;
  cap: number;
  camerasConsidered: number;
  succeeded: number;
  failed: number;
}

async function countReadingsToday(supabase: SupabaseClient): Promise<number> {
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("webcam_readings")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfToday.toISOString());

  if (error) {
    throw new Error(`Failed to count today's webcam_readings: ${error.message}`);
  }
  return count ?? 0;
}

async function fetchApprovedCameraSources(supabase: SupabaseClient, limit: number): Promise<ApprovedCameraSource[]> {
  if (limit <= 0) return [];

  const { data, error } = await supabase
    .from("camera_sources")
    .select("id, name, source_url")
    .eq("status", "approved")
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch approved camera_sources: ${error.message}`);
  }
  return (data ?? []) as ApprovedCameraSource[];
}

async function insertReading(supabase: SupabaseClient, reading: WebcamReadingInsert): Promise<void> {
  const { error } = await supabase.from("webcam_readings").insert(reading);
  if (error) {
    throw new Error(`Failed to insert webcam_readings row: ${error.message}`);
  }
}

async function extractOneCamera(supabase: SupabaseClient, camera: ApprovedCameraSource): Promise<void> {
  const capturedAt = new Date().toISOString();
  const snapshot = await fetchCameraSnapshot(camera.source_url);
  const raw = await extractVisibilityAndChop({
    imageBase64: snapshot.base64,
    imageMediaType: snapshot.mediaType,
    cameraName: camera.name,
  });
  const reading = shapeReading(raw, {
    cameraSourceId: camera.id,
    modelId: WEBCAM_EXTRACTION_MODEL_ID,
    capturedAt,
  });
  await insertReading(supabase, reading);
}

/**
 * Runs one extraction pass. Never throws for expected/operational failures
 * (feature disabled, cap reached, a single camera's extraction failing) —
 * those are reported in the returned summary so the route handler can
 * always respond 200 with a status body. It CAN throw for genuinely
 * unexpected setup failures (e.g. missing Supabase env vars), which the
 * route handler catches and turns into a 500 — see that file.
 */
export async function runWebcamExtraction(): Promise<ExtractionRunSummary> {
  if (!isWebcamExtractionEnabled()) {
    logger.info("run-skipped-disabled", {
      note: "WEBCAM_EXTRACTION_ENABLED is not \"true\" — see model.ts for why this defaults off.",
    });
    return {
      enabled: false,
      capReached: false,
      callsToday: 0,
      cap: resolveDailyCap(),
      camerasConsidered: 0,
      succeeded: 0,
      failed: 0,
    };
  }

  const supabase = createAdminClient();

  const rateCheck: RateCapCheckResult = await checkRateCap(() => countReadingsToday(supabase));
  if (!rateCheck.allowed) {
    logger.warn("run-skipped-cap", { reason: rateCheck.reason, callsToday: rateCheck.callsToday, cap: rateCheck.cap });
    return {
      enabled: true,
      capReached: true,
      callsToday: rateCheck.callsToday,
      cap: rateCheck.cap,
      camerasConsidered: 0,
      succeeded: 0,
      failed: 0,
    };
  }

  const remaining = rateCheck.cap - rateCheck.callsToday;
  const cameras = await fetchApprovedCameraSources(supabase, remaining);

  let succeeded = 0;
  let failed = 0;

  for (const camera of cameras) {
    try {
      await extractOneCamera(supabase, camera);
      succeeded += 1;
      logger.info("extraction-succeeded", { cameraId: camera.id, cameraName: camera.name });
    } catch (error) {
      failed += 1;
      logger.error("extraction-failed", {
        cameraId: camera.id,
        cameraName: camera.name,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return {
    enabled: true,
    capReached: false,
    callsToday: rateCheck.callsToday,
    cap: rateCheck.cap,
    camerasConsidered: cameras.length,
    succeeded,
    failed,
  };
}
