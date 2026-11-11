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
