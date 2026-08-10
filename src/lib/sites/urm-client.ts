/**
 * Florida Unified Reef Map (FWC) client — the I/O boundary that feeds
 * `reef-bands.ts` (Task 21, T21.20).
 *
 * `deriveReefBands` needs to know *what habitat is at a given point offshore*,
 * which means it needs polygon geometry, not just polygon vertices. The
 * previous input to that module was the vertex list of every nearby polygon,
 * and that was the bug: vertices trace polygon **boundaries**, so one reef
 * polygon running miles along-shore contributes a sample at essentially every
 * distance from the entry, filling the sand gaps the banding algorithm exists
 * to find. Live evidence before the fix — Datura Ave, LBTS collapsed to a
 * single 149-1771 yd "band" against known ground truth of a first reef at
 * ~150 yd, a sand gap, and a second reef at ~700-880 yd.
 *
 * So this module returns whole polygons (all rings), and `sampleTransect`
 * (in `reef-bands.ts`) walks straight offshore testing point-in-polygon at
 * each step. That is both how a diver actually experiences the profile and
 * exact rather than incidental.
 *
 * The service is FWC's public, unauthenticated ArcGIS MapServer — no API key,
 * no quota published, no cost, which is what makes it usable under this
 * project's no-budget constraint (CLAUDE.md, Funding & Cost Model). Per
 * CLAUDE.md's I/O standard this function never throws: a network failure, a
 * timeout, a non-2xx, or an ArcGIS-level error all resolve to
 * `{ polygons: [], error: <message> }`. A caller must treat a non-null `error`
 * as "the habitat lookup didn't happen", never as "there is no reef here" —
 * conflating those would tell a diver a reef line doesn't exist because a
 * request timed out.
 */

import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";
import type { ReefPolygon } from "./reef-bands";

/**
 * Layer 16 of FWC's Unified Florida Reef Tract Benthic Habitat MapServer —
 * the benthic-habitat polygon layer carrying `ClassLv1` (`Pavement`,
 * `Ridge`, `Aggregate Reef`, `Unconsolidated Sediment`, ...). Verified live
 * 2026-08-09 against the Datura Ave entry: 76 features within 2000 m.
 */
const URM_QUERY_ENDPOINT =
  "https://gis.myfwc.com/hosting/rest/services/Open_Data/Unified_Florida_Reef_Tract_Benthic_Habitat/MapServer/16/query";

/**
 * Larger than `osm-import.ts`'s 8 s on purpose: this response is *big*
 * (~1.4 MB for a 2000 m radius off LBTS, since reef-tract polygons carry
 * thousands of vertices each) and measured at ~0.6 s on a good connection.
 * A slow-but-working response is still worth waiting for; an indefinite hang
 * is not.
 */
const FETCH_TIMEOUT_MS = 20000;

/**
 * Decimal places of lat/lng the service should return. 6 dp is ~0.11 m —
 * far finer than the ~23 m (25 yd) transect step this data feeds, and it
 * halves the payload (2.5 MB -> 1.4 MB, measured live). Anything coarser
 * would start moving polygon edges by a distance a diver could notice.
 */
const GEOMETRY_PRECISION = 6;

/** Sent for the same reason `osm-import.ts` sends one — see the long
 * root-cause note there. A missing/generic UA cost an entire session to
 * diagnose against Overpass (every call 406'd). Identifying the app is also
 * simple etiquette toward a free public government service. */
const USER_AGENT = "ShoreDive/1.0 (shore-dive-app; benthic-habitat lookup, Task 21)";

/** ArcGIS returns `rings` as [ring][vertex][x, y] with x = longitude. */
interface ArcGisFeature {
  attributes?: { ClassLv1?: string | null };
  geometry?: { rings?: number[][][] };
}

/**
 * ArcGIS reports application-level failures (bad geometry, layer not found,
 * throttling) as an `error` object inside an **HTTP 200** body, so checking
 * `response.ok` alone is not enough to know the query succeeded.
 */
interface ArcGisQueryResponse {
  features?: ArcGisFeature[];
  exceededTransferLimit?: boolean;
  error?: { code?: number; message?: string };
}

export interface FetchReefPolygonsResult {
  polygons: ReefPolygon[];
  error: string | null;
  /**
   * The service capped the result set — some habitat polygons in range were
   * *not* returned. Surfaced rather than swallowed because a missing polygon
   * silently becomes a missing reef band, i.e. an under-reported swim
   * distance. Callers deriving bands from a truncated result must not
   * present the outcome as a complete profile.
   */
  truncated: boolean;
}

/**
 * Fetches every benthic-habitat polygon intersecting a `radiusMeters` buffer
 * around the entry point.
 *
 * Returns whole polygons (all rings, outer + holes) because containment, not
 * proximity, is the question `sampleTransect` asks of them. Features with no
 * geometry or no `ClassLv1` are dropped here rather than downstream — an
 * unclassified polygon can't tell a diver anything, and letting it through as
 * an empty habitat class would make it indistinguishable from sand.
 */
export async function fetchReefPolygons(params: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}): Promise<FetchReefPolygonsResult> {
  const { latitude, longitude, radiusMeters } = params;

  const body = new URLSearchParams({
    geometry: JSON.stringify({ x: longitude, y: latitude, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    distance: String(radiusMeters),
    units: "esriSRUnit_Meter",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "ClassLv1",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: String(GEOMETRY_PRECISION),
    f: "json",
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(URM_QUERY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: body.toString(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const message = `Unified Reef Map returned ${response.status}`;
      logger.warn("urm_client.non_ok_response", {
        status: response.status,
        latitude,
        longitude,
        radiusMeters,
      });
      return { polygons: [], error: message, truncated: false };
    }

    const payload = (await response.json()) as ArcGisQueryResponse;

    // HTTP 200 with an `error` body — an ArcGIS convention, not an edge case.
    if (payload.error) {
      const message = `Unified Reef Map error ${payload.error.code ?? "?"}: ${
        payload.error.message ?? "unknown"
      }`;
      logger.warn("urm_client.service_error", {
        code: payload.error.code,
        message: payload.error.message,
        latitude,
        longitude,
        radiusMeters,
      });
      return { polygons: [], error: message, truncated: false };
    }

    const polygons = (payload.features ?? [])
      .map(toReefPolygon)
      .filter((polygon): polygon is ReefPolygon => polygon !== null);

    const truncated = payload.exceededTransferLimit === true;
    if (truncated) {
      logger.warn("urm_client.result_truncated", {
        latitude,
        longitude,
        radiusMeters,
        polygonCount: polygons.length,
      });
    }

    logger.info("urm_client.query_succeeded", {
      latitude,
      longitude,
      radiusMeters,
      polygonCount: polygons.length,
      truncated,
    });

    return { polygons, error: null, truncated };
  } catch (error) {
    // Network failure, JSON-parse failure, or the AbortController timeout
    // above (surfaces as a DOMException "AbortError").
    const message = errorMessage(error);
    logger.error("urm_client.query_failed", {
      latitude,
      longitude,
      radiusMeters,
      error: message,
    });
    return { polygons: [], error: message, truncated: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Wire feature -> domain polygon, or `null` if it carries nothing usable. */
function toReefPolygon(feature: ArcGisFeature): ReefPolygon | null {
  const habitatClass = feature.attributes?.ClassLv1?.trim();
  if (!habitatClass) return null;

  const rings = feature.geometry?.rings;
  if (!Array.isArray(rings) || rings.length === 0) return null;

  // A ring needs at least three vertices to enclose any area; anything
  // shorter is degenerate data that would contribute nothing to a
  // point-in-polygon test but would still be iterated over.
  const usableRings = rings.filter((ring) => Array.isArray(ring) && ring.length >= 3);
  if (usableRings.length === 0) return null;

  return { habitatClass, rings: usableRings };
}
