/**
 * NOAA bathymetry client — the depth input `reef-bands.ts`'s
 * `deriveReefBandsWithDepth` needs to do what habitat geometry alone cannot:
 * separate two reef lines sitting on near-continuous hardbottom. See
 * `reef-bands.ts`'s header, "Resolved via bathymetry — T21.24", for the full
 * account of why distance/habitat alone could not split Datura Ave, LBTS's
 * first and second reef, and the live numbers this module's output was
 * validated against.
 *
 * ## Service, and why it's usable under this project's no-budget constraint
 *
 * `bag_bathymetry` is NOAA's mosaic of Bathymetric Attributed Grid (BAG)
 * surveys — public, unauthenticated ArcGIS ImageServer, no API key, no
 * published quota, no cost (CLAUDE.md's Funding & Cost Model). Verified live
 * 2026-08-09 at 26.17,-80.095 (between Datura's two reefs): `-4.78 m`,
 * sourced from `W00566_MB_1m_MLLW_5of6`, a 1 m-resolution multibeam survey
 * covering this exact stretch of the Fort Lauderdale coast.
 *
 * `DEM_mosaics/DEM_all` (NOAA's CUDEM, ~3.4 m/pixel, same ArcGIS request
 * family) is queried as a fallback — verified live returning `-5.48 m` at the
 * same point. BAG is multibeam-survey-only and has real coverage gaps
 * between surveys; CUDEM is a continuously-gridded compilation with much
 * broader coastal coverage but coarser resolution. Used two ways:
 *
 * 1. If a whole BAG request fails outright (network failure, timeout,
 *    non-2xx, or an ArcGIS-error-in-a-200-body — the same trap
 *    `urm-client.ts` documents), the identical request is retried once
 *    against CUDEM before giving up.
 * 2. In a batch, individual points BAG reports as `NoData` (real — the point
 *    sits outside every BAG survey footprint, not a failed lookup) are
 *    backfilled with a second CUDEM `getSamples` call restricted to just
 *    those points, so one missing BAG tile in the middle of an
 *    otherwise-good transect doesn't blank out a single sample for no
 *    externally-visible reason.
 *
 * Both are point/multipoint `identify`/`getSamples` operations on an
 * ImageServer — the same request family `urm-client.ts` already uses against
 * FWC's MapServer, so this follows its conventions: a descriptive
 * `User-Agent`, an `AbortController` timeout, structured `logger` calls at
 * the I/O boundary, and — per CLAUDE.md's exception-handling standard —
 * **never throws**. A network failure, a timeout, a non-2xx, or an ArcGIS
 * error resolves to `depthFt: null, error: <message>`; a caller must treat a
 * non-null `error` as "the depth lookup didn't happen," never as "there is no
 * bathymetry here" — the same distinction `urm-client.ts`'s header draws for
 * habitat.
 *
 * ## Sign and unit conversion
 *
 * Both services return **negative metres relative to MLLW** (mean lower low
 * water) — more negative is deeper. This codebase stores depth as
 * **positive feet** everywhere (`DepthRangeFt` in `dive-suitability.ts`), so
 * every value leaving this module goes through exactly one conversion,
 * `metersToDepthFt` below. A sign or unit slip here wouldn't crash — it would
 * silently hand `classifyDiveSuitability` a wrong number that reads as a
 * plausible depth, which is exactly the class of bug CLAUDE.md's
 * safety-critical-code standard exists to catch. `bathymetry-client.test.ts`
 * pins the conversion against the live-verified `-4.77755 m -> 15.68 ft`
 * figure above, not an arbitrary fixture.
 *
 * A reading at or above the MLLW datum (>= 0 m) is deliberately converted to
 * `null`, not `Math.abs()`-ed into a false positive depth: every caller
 * queries points already out on an offshore transect, so a non-negative
 * reading most likely means the point sits on dry land or an exposed
 * intertidal flat, not underwater — reporting a "depth" there would be worse
 * than reporting nothing.
 */

import { errorMessage } from "@/lib/error-message";
import type { LatLng } from "./distance";
import { logger } from "./logger";
import type { DepthSample } from "./reef-bands";

const BAG_IMAGE_SERVER = "https://gis.ngdc.noaa.gov/arcgis/rest/services/bag_bathymetry/ImageServer";
const DEM_IMAGE_SERVER = "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer";

/** Bathymetry responses are tiny (one pixel value, or a short array of them)
 * compared to `urm-client.ts`'s polygon payloads, so this is shorter than
 * that module's 20 s — but still generous enough that a slow-but-working
 * response is worth waiting for rather than treated as a failure. */
const FETCH_TIMEOUT_MS = 15000;

/** Sent for the same reason `urm-client.ts` and `osm-import.ts` send one —
 * see the latter's long root-cause note on what a missing/generic UA cost a
 * prior session against Overpass. */
const USER_AGENT = "ShoreDive/1.0 (shore-dive-app; bathymetry lookup, Task 21 T21.24)";

const FEET_PER_METER = 3.28084;

/**
 * Converts a raw MLLW-relative reading (negative metres = underwater) to a
 * positive depth in feet, or `null`. See this module's header for why `>= 0`
 * returns `null` instead of an absolute value.
 */
function metersToDepthFt(metersBelowDatum: number | null): number | null {
  if (metersBelowDatum === null || !Number.isFinite(metersBelowDatum)) return null;
  if (metersBelowDatum >= 0) return null;
  return Math.abs(metersBelowDatum) * FEET_PER_METER;
}

/** `"NoData"` for an uncovered pixel, or a numeric string otherwise — same
 * "stringly-typed raster value" shape from both `identify` and `getSamples`. */
function parseRawMeters(value: string | undefined): number | null {
  if (value === undefined || value === "NoData") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface ArcGisIdentifyResponse {
  value?: string;
  error?: { code?: number; message?: string };
}

interface ArcGisSamplesResponse {
  samples?: Array<{ locationId: number; value?: string }>;
  error?: { code?: number; message?: string };
}

/** Single-point query against one ImageServer. Internal — `fetchDepthFt` is
 * the public, fallback-aware wrapper around this. */
async function identifyOne(
  baseUrl: string,
  point: LatLng,
): Promise<{ metersBelowDatum: number | null; error: string | null }> {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ x: point.longitude, y: point.latitude, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    // Suppresses the full source-survey footprint polygon (thousands of
    // vertices) that `identify` otherwise embeds in every response — this
    // module only ever wants the pixel value.
    returnCatalogItems: "false",
    f: "json",
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/identify`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { metersBelowDatum: null, error: `Bathymetry service returned ${response.status}` };
    }

    const payload = (await response.json()) as ArcGisIdentifyResponse;

    // ArcGIS reports application-level failures as an `error` object inside
    // an HTTP 200 body — `urm-client.ts`'s header documents this at length.
    if (payload.error) {
      return {
        metersBelowDatum: null,
        error: `Bathymetry service error ${payload.error.code ?? "?"}: ${payload.error.message ?? "unknown"}`,
      };
    }

    return { metersBelowDatum: parseRawMeters(payload.value), error: null };
  } catch (error) {
    return { metersBelowDatum: null, error: errorMessage(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Batch query against one ImageServer via `getSamples`. Internal —
 * `fetchDepthsFt` is the public, fallback-aware wrapper. */
async function samplesOne(
  baseUrl: string,
  points: LatLng[],
): Promise<{ metersById: Map<number, number | null>; error: string | null }> {
  if (points.length === 0) return { metersById: new Map(), error: null };

  const body = new URLSearchParams({
    geometry: JSON.stringify({
      points: points.map((p) => [p.longitude, p.latitude]),
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryMultipoint",
    // One value per point rather than a resampled line profile — this module
    // always supplies discrete points, never a line for the service to walk.
    returnFirstValueOnly: "true",
    f: "json",
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/getSamples`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { metersById: new Map(), error: `Bathymetry service returned ${response.status}` };
    }

    const payload = (await response.json()) as ArcGisSamplesResponse;

    if (payload.error) {
      return {
        metersById: new Map(),
        error: `Bathymetry service error ${payload.error.code ?? "?"}: ${payload.error.message ?? "unknown"}`,
      };
    }

    const metersById = new Map<number, number | null>();
    for (const sample of payload.samples ?? []) {
      metersById.set(sample.locationId, parseRawMeters(sample.value));
    }
    return { metersById, error: null };
  } catch (error) {
    return { metersById: new Map(), error: errorMessage(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface DepthResult {
  depthFt: number | null;
  error: string | null;
}

/**
 * Depth at a single point, in feet. Tries BAG first; falls back to CUDEM
 * whenever BAG's request fails outright *or* succeeds but reports `NoData`
 * (real coverage gap, not a failure — see this module's header). Never
 * throws.
 */
export async function fetchDepthFt(point: LatLng): Promise<DepthResult> {
  const primary = await identifyOne(BAG_IMAGE_SERVER, point);

  if (primary.error === null && primary.metersBelowDatum !== null) {
    logger.info("bathymetry_client.point_resolved", {
      source: "bag",
      latitude: point.latitude,
      longitude: point.longitude,
    });
    return { depthFt: metersToDepthFt(primary.metersBelowDatum), error: null };
  }

  if (primary.error) {
    logger.warn("bathymetry_client.bag_identify_failed", {
      error: primary.error,
      latitude: point.latitude,
      longitude: point.longitude,
    });
  }

  const fallback = await identifyOne(DEM_IMAGE_SERVER, point);

  if (fallback.error) {
    // BAG may have reported NoData (not an error) rather than failed
    // outright, in which case `primary.error` is null and the honest error
    // to surface is CUDEM's alone. When both genuinely failed, combine both
    // messages — reporting only one would hide that the other service was
    // also down, which matters for diagnosing a real outage versus one
    // service's normal coverage gap.
    const message =
      primary.error && fallback.error
        ? `BAG: ${primary.error}; DEM fallback: ${fallback.error}`
        : (primary.error ?? fallback.error);
    logger.error("bathymetry_client.identify_failed", {
      bagError: primary.error,
      demError: fallback.error,
      latitude: point.latitude,
      longitude: point.longitude,
    });
    return { depthFt: null, error: message };
  }

  logger.info("bathymetry_client.point_resolved", {
    source: "dem",
    latitude: point.latitude,
    longitude: point.longitude,
  });
  return { depthFt: metersToDepthFt(fallback.metersBelowDatum), error: null };
}

export interface FetchDepthsResult {
  samples: DepthSample[];
  error: string | null;
}

/**
 * Depth at many points in as few round-trips as possible: one batch
 * `getSamples` call to BAG, and — only for points BAG reported `NoData` for —
 * one more batch call to CUDEM to backfill just those gaps. A full-batch BAG
 * failure (not "some points lack coverage," an actual failed request) retries
 * the whole batch against CUDEM once. Never throws; `samples` is always the
 * same length and order as `points`.
 *
 * This is the batch counterpart CLAUDE.md's engineering standards ask for —
 * a caller sampling a ~2000 yd, 25 yd-step transect (81 points) would
 * otherwise need 81 sequential round-trips, hammering a free public service
 * for no reason `getSamples` doesn't already solve in one request.
 */
export async function fetchDepthsFt(points: LatLng[]): Promise<FetchDepthsResult> {
  if (points.length === 0) return { samples: [], error: null };

  const primary = await samplesOne(BAG_IMAGE_SERVER, points);

  if (primary.error) {
    logger.warn("bathymetry_client.bag_batch_failed", { error: primary.error, pointCount: points.length });

    const fallback = await samplesOne(DEM_IMAGE_SERVER, points);
    if (fallback.error) {
      logger.error("bathymetry_client.batch_failed", {
        bagError: primary.error,
        demError: fallback.error,
        pointCount: points.length,
      });
      // Both requests genuinely failed here (this branch only runs after a
      // primary failure, so `primary.error` is always set) — combine both
      // messages rather than hiding that the fallback was also down.
      return {
        samples: points.map((p) => ({ ...p, depthFt: null })),
        error: `BAG: ${primary.error}; DEM fallback: ${fallback.error}`,
      };
    }

    logger.info("bathymetry_client.batch_resolved", { source: "dem", pointCount: points.length });
    return {
      samples: points.map((p, i) => ({ ...p, depthFt: metersToDepthFt(fallback.metersById.get(i) ?? null) })),
      error: null,
    };
  }

  // BAG succeeded as a request; individual points can still be `NoData`
  // (outside every BAG survey footprint) — real and expected, not a failure.
  // Backfill just those from CUDEM rather than discarding an otherwise-good
  // transect over a couple of coverage gaps.
  const noDataIndices = points.map((_, i) => i).filter((i) => (primary.metersById.get(i) ?? null) === null);

  const backfill = new Map<number, number | null>();
  if (noDataIndices.length > 0) {
    const gapPoints = noDataIndices.map((i) => points[i]);
    const demResult = await samplesOne(DEM_IMAGE_SERVER, gapPoints);

    if (demResult.error) {
      // A failed backfill degrades those specific points to "no depth
      // signal," not the whole batch to an error — the rest of the transect
      // is still good data.
      logger.warn("bathymetry_client.gap_backfill_failed", {
        error: demResult.error,
        gapCount: noDataIndices.length,
      });
    } else {
      logger.info("bathymetry_client.gap_backfill_resolved", { gapCount: noDataIndices.length });
      noDataIndices.forEach((originalIndex, gapIndex) => {
        backfill.set(originalIndex, demResult.metersById.get(gapIndex) ?? null);
      });
    }
  }

  const samples = points.map((p, i) => {
    const meters = primary.metersById.get(i) ?? backfill.get(i) ?? null;
    return { ...p, depthFt: metersToDepthFt(meters) };
  });

  return { samples, error: null };
}

export interface DepthTransectOptions {
  /** Must match the value used for the corresponding `sampleTransect` call
   * (`reef-bands.ts`) for `deriveReefBandsWithDepth` to line the two sample
   * sets up. Defaults to 90 (due east), the same default `sampleTransect`
   * uses. */
  bearingDegrees?: number;
  maxYards?: number;
  stepYards?: number;
}

const DEFAULT_BEARING_DEGREES = 90;
const DEFAULT_MAX_YARDS = 2000;
const DEFAULT_STEP_YARDS = 25;

/** Must match `reef-bands.ts`'s earth-radius constant and destination-point
 * formula exactly. `deriveReefBandsWithDepth` matches a habitat sample to a
 * depth sample by recomputing each one's distance from the entry and
 * rounding to the nearest yard, which only lands cleanly if both transects
 * place their points using the identical spherical model — a divergence here
 * would silently misalign every sample by a few yards instead of failing
 * loudly. Duplicated rather than imported so this file makes no changes to
 * `reef-bands.ts`'s existing code paths (see `reef-bands.ts`'s
 * `deriveReefBandsWithDepth` doc comment for why isolation matters right
 * now); a future consolidation should extract this once both modules are not
 * being edited by parallel, mutually-invisible work. */
const EARTH_RADIUS_MILES = 3958.8;
const YARDS_PER_MILE = 1760;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;

function destinationPoint(origin: LatLng, bearingDegrees: number, yards: number): LatLng {
  const angularDistance = yards / YARDS_PER_MILE / EARTH_RADIUS_MILES;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.latitude);
  const lng1 = toRadians(origin.longitude);

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
  const lat2 = Math.asin(sinLat2);
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * sinLat2,
    );

  return { latitude: toDegrees(lat2), longitude: toDegrees(lng2) };
}

/**
 * Walks straight offshore from `entry` sampling depth at each step, in one
 * batched request via `fetchDepthsFt` — the depth counterpart of
 * `sampleTransect` (`reef-bands.ts`). Unlike `sampleTransect`, which omits
 * steps that fall outside every habitat polygon, this always returns one
 * sample per step: bathymetry coverage is continuous where it exists, and a
 * `null` `depthFt` (NoData from both services, see this module's header) is
 * itself a meaningful, honestly-reported outcome rather than something to
 * omit.
 */
export async function sampleDepthTransect(
  entry: LatLng,
  options: DepthTransectOptions = {},
): Promise<FetchDepthsResult> {
  const {
    bearingDegrees = DEFAULT_BEARING_DEGREES,
    maxYards = DEFAULT_MAX_YARDS,
    stepYards = DEFAULT_STEP_YARDS,
  } = options;

  // Mirrors `sampleTransect`'s own guard: a non-positive step would loop
  // forever, a non-positive range has no samples to give.
  if (!(stepYards > 0) || !(maxYards > 0)) return { samples: [], error: null };

  const points: LatLng[] = [];
  for (let yards = 0; yards <= maxYards; yards += stepYards) {
    points.push(yards === 0 ? entry : destinationPoint(entry, bearingDegrees, yards));
  }

  return fetchDepthsFt(points);
}
