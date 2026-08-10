import { logger } from "./logger";

/**
 * Fetches a still frame from an approved `camera_sources.source_url`
 * (T17.1's allowlist gate — callers must only pass an approved source's
 * URL; see `run-extraction.ts`).
 *
 * HONEST STATUS: this is real, working fetch/encode logic — it will
 * correctly turn *some* reachable image URL into base64 today — but it has
 * never been run against a real webcam feed, because no real camera source
 * exists yet. T17.2 ("ingestion connector for the first personally-
 * negotiated camera source") is still unchecked in TASKS.md, so
 * `camera_sources` has no live rows to fetch from in any real deployment.
 * Same "real code, no live upstream to prove it against yet" pattern as
 * `bundle-verification.ts`'s default `SignatureVerifier`. Don't treat a
 * clean typecheck/build as proof this correctly handles every real-world
 * webcam endpoint shape (MJPEG streams, HLS playlists, and single-frame
 * snapshot endpoints all behave differently) — re-verify once T17.2 lands.
 */

export interface CameraSnapshot {
  /** Base64-encoded image bytes (no data-URL prefix). */
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

const SUPPORTED_MEDIA_TYPES: readonly CameraSnapshot["mediaType"][] = ["image/jpeg", "image/png", "image/webp"];

/**
 * Fetches `sourceUrl` and returns its bytes as a base64-encoded still
 * image. Assumes `sourceUrl` resolves directly to a single still frame
 * (a JPEG/PNG/WebP snapshot endpoint) — it does NOT handle HLS (.m3u8)
 * playlists or MJPEG multipart streams, both of which `camera_sources`'
 * schema comment (0003_camera_sources.sql) explicitly allows as valid
 * `source_url` shapes. Extracting a single frame from those formats needs
 * real media-handling logic (e.g. ffmpeg) this worker does not have —
 * T17.2's connector is the natural place to normalize any such source down
 * to a plain snapshot URL before it ever reaches this function, or this
 * function needs extending once a real non-still-image source shows up.
 * Throws (rather than guessing) on an unrecognized content-type so a bad
 * assumption here fails loudly instead of silently feeding garbage into
 * the vision model.
 */
export async function fetchCameraSnapshot(sourceUrl: string): Promise<CameraSnapshot> {
  let response: Response;
  try {
    response = await fetch(sourceUrl, { cache: "no-store" });
  } catch (error) {
    logger.error("snapshot-fetch-network-error", {
      sourceUrl,
      error: error instanceof Error ? error.message : error,
    });
    throw new Error(`Failed to fetch webcam snapshot from ${sourceUrl}: network error`);
  }

  if (!response.ok) {
    logger.error("snapshot-fetch-http-error", { sourceUrl, status: response.status });
    throw new Error(`Failed to fetch webcam snapshot from ${sourceUrl}: HTTP ${response.status}`);
  }

  const mediaType = resolveMediaType(response.headers.get("content-type"));
  if (!mediaType) {
    logger.error("snapshot-fetch-unsupported-content-type", {
      sourceUrl,
      contentType: response.headers.get("content-type"),
    });
    throw new Error(
      `Webcam source ${sourceUrl} returned an unsupported content-type — expected a still image (jpeg/png/webp), got "${response.headers.get("content-type")}". HLS/MJPEG streams are not supported by this function yet — see this file's header comment.`,
    );
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  return { base64, mediaType };
}

function resolveMediaType(contentType: string | null): CameraSnapshot["mediaType"] | null {
  if (!contentType) return null;
  const match = SUPPORTED_MEDIA_TYPES.find((mediaType) => contentType.toLowerCase().includes(mediaType.split("/")[1]));
  return match ?? null;
}
