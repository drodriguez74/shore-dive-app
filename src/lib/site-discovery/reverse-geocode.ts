import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";

/**
 * Turns map-pan coordinates into a place name Brave Search can actually
 * search well on (`plan.md` Resolved Spec Decision #10, `area-research.ts`'s
 * own header) — "dive sites near 18.4273, -68.9728" searches poorly, since
 * almost everything written about a place names it rather than its
 * coordinates.
 *
 * Reuses the existing `NEXT_PUBLIC_MAPBOX_TOKEN` (already provisioned for
 * `site-map.tsx`) against Mapbox's own reverse-geocoding endpoint — no new
 * vendor, no new env var. This is a server-only call (invoked from
 * `area-research.ts`, itself only ever called from an API route), so the
 * `NEXT_PUBLIC_` prefix just means it's the same publishable token the map
 * already ships to the browser, not a new secret being exposed anywhere it
 * wasn't already.
 */

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Resolves `{latitude, longitude}` to a short, human place name (e.g. "La
 * Romana, Dominican Republic"), or `null` if the token is missing, the
 * lookup fails, or Mapbox has nothing for this point (e.g. open ocean far
 * from any named place) — callers must treat `null` as "fall back to
 * something else," never crash. Never throws.
 */
export async function placeNameNear(point: LatLng): Promise<string | null> {
  if (!MAPBOX_TOKEN) {
    logger.warn("reverse_geocode.missing_token");
    return null;
  }

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${point.longitude},${point.latitude}.json` +
    `?access_token=${MAPBOX_TOKEN}&limit=1`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn("reverse_geocode.non_ok_response", { status: response.status });
      return null;
    }

    const data = (await response.json()) as { features?: { place_name?: string }[] };
    const placeName = data.features?.[0]?.place_name;
    return typeof placeName === "string" && placeName.length > 0 ? placeName : null;
  } catch (error) {
    logger.warn("reverse_geocode.request_failed", { message: errorMessage(error) });
    return null;
  }
}
