/**
 * Great-circle distance between two lat/lng points, in miles (Haversine
 * formula) — used by `nearby-dive-sites-list.tsx`'s radius filter. Good
 * enough for "how far is this dive site from me"; doesn't need road-
 * distance accuracy.
 */

const EARTH_RADIUS_MILES = 3958.8;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function distanceMiles(a: LatLng, b: LatLng): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_MILES * c;
}

/**
 * Filters `items` to those within `radiusMiles` of `center` and sorts the
 * result nearest-first. Generic over anything shaped like `LatLng` so it
 * works for `SiteMarker` (`src/lib/sites/types.ts`) without this module
 * depending on that type — used by `src/app/api/sites/search-nearby/route.ts`
 * (Task 21, T21.3) to reuse the same radius-filter/sort logic
 * `nearby-dive-sites-list.tsx` already applies client-side, without
 * duplicating it.
 */
/**
 * Miles per degree of latitude. Deliberately rounded *down* from the real
 * ~69.05–69.4 range: every use below divides by this to get a degree span,
 * so a smaller divisor yields a slightly *larger* box. See
 * `boundingBoxForRadius` — being generous is the safe direction here.
 */
const MILES_PER_DEGREE_LATITUDE = 69;

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * The smallest lat/lng box that fully contains the circle of `radiusMiles`
 * around `center` — a coarse, index-friendly prefilter for
 * `listSitesInBounds` (`src/lib/sites/queries.ts`), which a caller then
 * narrows to the true circle with `sortByDistanceWithinRadius` above.
 *
 * **This must always be a superset of the circle.** A box even slightly too
 * small silently drops sites that are genuinely within the radius — the same
 * class of invisible data loss the bounded-query work exists to fix, just
 * moved one layer up. Three deliberate choices keep it conservative:
 *
 * - `MILES_PER_DEGREE_LATITUDE` is rounded down (see above), so both spans
 *   come out marginally wider than strictly required.
 * - The longitude span is computed at whichever edge of the box sits
 *   *furthest from the equator*, not at the center latitude. Degrees of
 *   longitude get shorter toward the poles, so the center latitude would
 *   under-cover the box's poleward edge.
 * - Near the poles `cos(latitude)` approaches zero and the required span
 *   diverges; past a full circumference the box is widened to the entire
 *   -180..180 range rather than emitting nonsense.
 *
 * Latitude is clamped to ±90 (it doesn't wrap). Longitude *does* wrap, and
 * a box crossing the antimeridian is returned with `west > east` — the
 * documented signal `listSitesInBounds` detects and expresses as an `.or()`
 * filter instead of an unsatisfiable `.gte`/`.lte` conjunction.
 */
export function boundingBoxForRadius(center: LatLng, radiusMiles: number): BoundingBox {
  const latDelta = radiusMiles / MILES_PER_DEGREE_LATITUDE;

  const north = Math.min(center.latitude + latDelta, 90);
  const south = Math.max(center.latitude - latDelta, -90);

  // Longitude degrees shrink toward the poles, so size the span using the
  // box edge with the largest |latitude| — the worst case inside the box.
  const worstCaseLatitude = Math.max(Math.abs(north), Math.abs(south));
  const cosLatitude = Math.cos((worstCaseLatitude * Math.PI) / 180);

  // At/near a pole the span required to cover the radius exceeds the whole
  // globe; return the full range rather than dividing by ~0.
  if (cosLatitude <= 0) {
    return { north, south, east: 180, west: -180 };
  }

  const lngDelta = radiusMiles / (MILES_PER_DEGREE_LATITUDE * cosLatitude);
  if (lngDelta >= 180) {
    return { north, south, east: 180, west: -180 };
  }

  // Wrap into [-180, 180]. This is what produces `west > east` for a
  // box straddling the antimeridian.
  const wrapLongitude = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;

  return {
    north,
    south,
    east: wrapLongitude(center.longitude + lngDelta),
    west: wrapLongitude(center.longitude - lngDelta),
  };
}

export function sortByDistanceWithinRadius<T extends LatLng>(items: T[], center: LatLng, radiusMiles: number): T[] {
  return items
    .map((item) => ({ item, distance: distanceMiles(center, item) }))
    .filter(({ distance }) => distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance)
    .map(({ item }) => item);
}
