"use client";

import { useEffect, useState } from "react";

export interface GeolocationCoords {
  latitude: number;
  longitude: number;
}

export type GeolocationStatus = "pending" | "success" | "unavailable";

export interface UseGeolocationResult {
  status: GeolocationStatus;
  coords: GeolocationCoords | null;
}

/**
 * One-shot browser geolocation lookup, shared by `site-map.tsx` (recenter
 * the map) and `nearby-dive-sites-list.tsx` (radius filter). Geolocation is
 * a browser-API boundary (CLAUDE.md's engineering standard) — permission
 * can be denied, the API can be unsupported, or the browser can throw
 * synchronously (e.g. a permissions-policy-restricted embed). Every path
 * resolves to "unavailable" rather than throwing or leaving a caller
 * waiting on "pending" forever.
 */
export function useGeolocation(): UseGeolocationResult {
  // Always starts "pending" — on both server AND the client's first paint,
  // deliberately not branched on `typeof navigator` here. A prior version
  // did branch on it, which is a real hydration-mismatch bug caught live via
  // agent-browser: `navigator` doesn't exist during SSR, so the server
  // render always computed "unavailable" while the client's first paint
  // (before this effect has run) computed "pending" from the real browser
  // `navigator` — two different initial trees for the same render. Every
  // environment-dependent outcome (unsupported/denied/success) is resolved
  // only inside the effect below, i.e. only after hydration, which is safe.
  const [status, setStatus] = useState<GeolocationStatus>("pending");
  const [coords, setCoords] = useState<GeolocationCoords | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      // Deferred via setTimeout, same react-hooks/set-state-in-effect reason
      // documented at length in media-embed.tsx — functionally still
      // immediate, just outside the effect's own synchronous body.
      const timer = setTimeout(() => setStatus("unavailable"), 0);
      return () => clearTimeout(timer);
    }

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          setStatus("success");
        },
        () => {
          setStatus("unavailable");
        },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
      );
    } catch {
      // `getCurrentPosition` throwing synchronously is rare (e.g. a
      // permissions-policy-restricted embed) but still possible. Deferred via
      // setTimeout, same react-hooks/set-state-in-effect reason documented at
      // length in media-embed.tsx — functionally still immediate, just
      // outside the effect's own synchronous body.
      const timer = setTimeout(() => setStatus("unavailable"), 0);
      return () => clearTimeout(timer);
    }
  }, []);

  return { status, coords };
}
