"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { legalAccessLabel } from "@/components/legal-access-badge";
import { formatShoreDistance } from "@/components/site-dive-profile";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import { classifyShoreAccess, shoreAccessFromStoredFields, type ShoreEntryPoint } from "@/lib/sites/shore-access";
import { usesCoastalDistanceModel } from "@/lib/sites/water-access";
import type { LatLng } from "@/lib/sites/distance";
import {
  drawPinIcon,
  legalGlyphTier,
  pinIconName,
  PIN_HEIGHT,
  PIN_RASTER_SCALE,
  PIN_WIDTH,
  SITE_TYPES,
  type PinIconSpec,
} from "@/lib/sites/pin-icons";
import type { Site, SiteMarker, SiteType } from "@/lib/sites/types";

/**
 * Single-site location map for the site detail page (T21.22).
 *
 * **Deliberately not a second pin system.** The pin is rendered from
 * `src/lib/sites/pin-icons.ts` — the same module `site-map.tsx` uses — through
 * the same three steps: rasterize a `PinIconSpec` onto an offscreen canvas via
 * `drawPinIcon`, register it with `map.addImage` under `pinIconName(spec)`, and
 * reference it from a symbol `Layer` with a data-driven `["get", "icon"]`
 * expression. That is what makes the guarantee this component exists to keep:
 * a site looks *identical* here and on the exploration map, including its
 * provenance stroke pattern, hazard fill, site-type glyph and legal-access
 * corner badge. If the upcoming pin design pass (plan.md Resolved Decision #7)
 * changes the artwork, it changes in both places at once, because there is only
 * one copy of it.
 *
 * The one deliberate difference from `site-map.tsx`: that component registers
 * the full cross product (`allPinIconSpecs()`, 72 images) because any site can
 * appear in its viewport. This one knows exactly which site it is drawing, so
 * it registers exactly one image. Same helpers, smaller loop.
 *
 * ## Interaction: lightly interactive, not static
 *
 * Pan, pinch-zoom, keyboard, and on-screen zoom buttons are ON; **scroll-wheel
 * / two-finger-scroll zoom and rotation are OFF**.
 *
 * A frozen image would be the wrong call for the thing a diver is actually
 * doing here: working out where the entry is relative to the parking, the
 * beach, and the reef, which needs zooming out to see the road and in to see
 * the shoreline. But this map sits *inside a scrolling article*, and a
 * scroll-zoom map in that position hijacks the page scroll — on a phone it
 * traps the diver mid-page. `NavigationControl` (zoom in/out buttons, compass
 * hidden since rotation is disabled) exists precisely so turning scroll-zoom
 * off doesn't remove zoom: it stays reachable by touch, by mouse, and by
 * keyboard. Rotation/pitch are off because a tilted, rotated map of a
 * coastline is disorienting, not informative, and there is nothing here to
 * orbit.
 *
 * ## No token
 *
 * Degrades to a placeholder exactly like `site-map.tsx`, and — because this
 * component is a *location* display rather than an exploration surface — the
 * placeholder still states the coordinates, so the page never loses the one
 * piece of information the map was there to convey.
 *
 * ## Accessibility
 *
 * A symbol layer has no DOM node, so there is nothing for a screen reader to
 * reach — the same gap `site-map.tsx` covers with a visually-hidden list. The
 * equivalent here is the visually-hidden description below the map: site name,
 * exact coordinates, and the same provenance / hazard / legal-access facts the
 * pin encodes visually. No hydration hazard anywhere in this component: no
 * initial `useState` is branched on `typeof window`/`navigator` (see the
 * warning in `src/hooks/use-geolocation.ts` documenting that exact bug), and
 * `initialViewState` comes from server-supplied props, so the server and the
 * client's first paint always compute the same tree.
 */

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const SITE_LOCATION_SOURCE_ID = "site-location";
const SITE_LOCATION_LAYER_ID = "site-location-layer";
const SHORE_ENTRY_LINE_SOURCE_ID = "shore-entry-line";
const SHORE_ENTRY_LINE_LAYER_ID = "shore-entry-line-layer";

/**
 * Close enough to read the shoreline, the road behind it and any obvious entry
 * point, without zooming so far in that the surrounding geography (which is
 * how a diver orients) drops out of frame.
 */
export const DEFAULT_SITE_LOCATION_ZOOM = 14;

/**
 * The line, marker positions, and camera bounds for the "swim from here"
 * visual (founder ask, 2026-08-11: "a hash line from the shore to the site").
 * A pure function of two points — no Mapbox/React dependency — so it's
 * directly testable, unlike the actual line/marker rendering below, which
 * needs a real WebGL context this test environment doesn't have (see this
 * file's test suite's own note on that limit).
 *
 * `bounds` is deliberately the raw two-point envelope, not pre-padded —
 * `map.fitBounds()`'s own `padding` option (in screen pixels) is the right
 * place for visual breathing room, and baking padding into the *geographic*
 * bounds here would double up with it inconsistently depending on zoom.
 *
 * `midpoint` is a flat lat/lng average, not a great-circle midpoint — correct
 * to within inches at the scale this draws (a few hundred yards, at most
 * `SHORE_DIVE_MAX_MILES`), and not worth the extra spherical-trig code this
 * component would otherwise need to import just to place a label.
 */
export interface ShoreEntryLine {
  lineGeoJSON: GeoJSON.Feature<GeoJSON.LineString>;
  entryPoint: LatLng;
  midpoint: LatLng;
  /** `[[west, south], [east, north]]` — the shape `mapboxgl.LngLatBounds` /
   * react-map-gl's `fitBounds` accepts. */
  bounds: [[number, number], [number, number]];
}

export function buildShoreEntryLine(entry: LatLng, site: LatLng): ShoreEntryLine {
  return {
    lineGeoJSON: {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [entry.longitude, entry.latitude],
          [site.longitude, site.latitude],
        ],
      },
    },
    entryPoint: { latitude: entry.latitude, longitude: entry.longitude },
    midpoint: {
      latitude: (entry.latitude + site.latitude) / 2,
      longitude: (entry.longitude + site.longitude) / 2,
    },
    bounds: [
      [Math.min(entry.longitude, site.longitude), Math.min(entry.latitude, site.latitude)],
      [Math.max(entry.longitude, site.longitude), Math.max(entry.latitude, site.latitude)],
    ],
  };
}

/**
 * Sr-only sentence for the line — same "a symbol/line layer has no DOM node"
 * gap `siteLocationDescription` exists to cover for the pin, extended to this
 * new visual. Deliberately hedged the same way `shore-access.ts` requires
 * everywhere else ("plausibly", never "confirmed") — this text describes the
 * same measurement the line draws, not a stronger claim than the line itself
 * is allowed to make.
 */
export function shoreEntryLineDescription(entry: ShoreEntryPoint, distanceMiles: number): string {
  return (
    `Dashed line: a plausible shore-entry swim from ${entry.name}, about ` +
    `${formatShoreDistance(distanceMiles)} away. Distance measurement only — not a confirmed or ` +
    `recommended route; verify conditions locally.`
  );
}

/** Guards the `icon-image` lookup against a `site_type` the icon system
 * doesn't know about — an unregistered image renders as *nothing*, i.e. a dive
 * site that silently isn't on its own map. Unknown values fall back to
 * `unclassified`, which always has an icon. */
function normalizeSiteType(siteType: SiteType): SiteType {
  return SITE_TYPES.includes(siteType) ? siteType : "unclassified";
}

/** The same facts the pin encodes visually, as text. Mirrors
 * `site-map.tsx`'s `siteAccessibleLabel` (that one is module-private there, and
 * that file is not this task's to edit) and adds the coordinates, which matter
 * more on a single-site map than on a crowded one. */
export function siteLocationDescription(site: SiteMarker): string {
  const parts = [
    `${site.name} — map location`,
    `latitude ${site.latitude.toFixed(5)}, longitude ${site.longitude.toFixed(5)}`,
    site.provenance === "VERIFIED" ? "Verified entry" : "Community entry, not independently reviewed",
    site.hasHazardReport ? "hazard report on file" : null,
    legalGlyphTier(site.legal_access_status) ? legalAccessLabel(site.legal_access_status) : null,
  ];
  return `${parts.filter(Boolean).join(". ")}.`;
}

export interface SiteLocationMapProps {
  /** The single site to show. Takes the same `SiteMarker` shape the
   * exploration map renders (so both maps are driven by identical inputs
   * and cannot drift into showing the same site differently), widened with
   * `shore_entry_id`/`shore_distance_yards` — detail-only fields per
   * `Site`'s own scoping, but this component is only ever used for a
   * single site's own detail page (never a multi-pin map), so it needs the
   * full explanation, not just the marker-level confidence. */
  site: SiteMarker & Pick<Site, "shore_entry_id" | "shore_distance_yards">;
  /** Override the initial zoom. Read once at mount by Mapbox, like every
   * `initialViewState` field. */
  zoom?: number;
}

export function SiteLocationMap({ site, zoom = DEFAULT_SITE_LOCATION_ZOOM }: SiteLocationMapProps) {
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [iconReady, setIconReady] = useState(false);
  const mapRef = useRef<MapRef | null>(null);
  // Guards the fitBounds camera move below to firing exactly once per mount
  // — `entryLine` is a fresh object from `useMemo` but its *contents* only
  // change if the site's own coordinates change (which doesn't happen without
  // a full remount), so without this guard there's no real re-fit risk, but
  // it documents the one-shot intent explicitly rather than relying on that
  // being incidentally true. Mirrors `site-map.tsx`'s `hasPositionedRef`.
  const hasFitEntryLineRef = useRef(false);

  // Prefer the site's own stored classification over a live recompute —
  // reversed 2026-08-10 from this component's original reasoning (recompute
  // always, never trust the column). That original reasoning missed a real
  // failure mode: a site classified via the `osm_tag` fallback at import
  // time (using OSM's own entry tag, not available here) would silently
  // regress back to `unlikely` on a live recompute, since this component has
  // no access to the tag that produced the stored result — see
  // `shoreAccessFromStoredFields`'s own header. Also now gated on
  // `usesCoastalDistanceModel`: a walk-in freshwater site (spring/cave) must
  // never run the coastal-distance model at all, live or stored — same fix
  // already applied to `site-dive-profile.tsx`/`dive-difficulty.ts`.
  const shoreAccess = useMemo(() => {
    if (!usesCoastalDistanceModel(site.site_type)) return null;
    return (
      shoreAccessFromStoredFields(site) ??
      classifyShoreAccess({ latitude: site.latitude, longitude: site.longitude })
    );
  }, [site]);

  // Only sites `shore-access.ts` itself calls shore-accessible get a line —
  // never drawn for `unlikely` sites, where `nearestEntry` is populated but
  // may be many miles away and would be actively misleading rendered as a
  // "swim from here" line. See `buildShoreEntryLine`'s own header for what
  // the line, midpoint and bounds actually are.
  const entryLine = useMemo(() => {
    if (!shoreAccess || !shoreAccess.isShoreAccessible || !shoreAccess.nearestEntry) return null;
    return buildShoreEntryLine(shoreAccess.nearestEntry, site);
  }, [shoreAccess, site]);

  // One-shot camera fit so both the site and its shore entry are actually in
  // frame — the plain `initialViewState` below (site-centered, fixed zoom) is
  // read only once at mount by Mapbox and has no way to know an entry point
  // up to `SHORE_DIVE_MAX_MILES` away needs to fit too, so a marginal-tier
  // site could otherwise render a line running straight off the edge of the
  // map. `padding` is screen pixels, not degrees, so it stays sensible across
  // the different `initialViewState` zooms callers can pass.
  useEffect(() => {
    if (!isMapLoaded || !entryLine || hasFitEntryLineRef.current) return;
    const map = mapRef.current;
    if (!map) return;
    hasFitEntryLineRef.current = true;
    try {
      map.fitBounds(entryLine.bounds, { padding: 56, duration: 0, maxZoom: 16 });
    } catch (error) {
      // Never worth taking the map down over a camera-framing nicety — the
      // pin and the line still render at whatever the default view was.
      logger.error("site_location_map.fit_entry_line_bounds_failed", {
        siteId: site.id,
        message: errorMessage(error),
      });
    }
  }, [isMapLoaded, entryLine, site.id]);

  const spec = useMemo<PinIconSpec>(
    () => ({
      siteType: normalizeSiteType(site.site_type),
      isCommunity: site.provenance === "COMMUNITY",
      hasHazardReport: site.hasHazardReport,
      legalTier: legalGlyphTier(site.legal_access_status),
    }),
    [site.site_type, site.provenance, site.hasHazardReport, site.legal_access_status],
  );

  const iconName = pinIconName(spec);

  const featureCollection = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, { icon: string }>>(
    () => ({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [site.longitude, site.latitude] },
          properties: { icon: iconName },
        },
      ],
    }),
    [site.longitude, site.latitude, iconName],
  );

  // Rasterize + register this site's one pin icon once the style has loaded.
  // Same browser-API-boundary handling as `site-map.tsx`'s equivalent loop:
  // canvas can be unavailable in exotic environments, and losing the pin must
  // degrade to "the map renders without a marker" (the coordinates and the
  // visually-hidden description below still carry the location) rather than
  // throwing inside a page a diver is reading hazard information off.
  // `setIconReady` is deferred through `setTimeout` for the same
  // react-hooks/set-state-in-effect reason documented at length in
  // `use-geolocation.ts` and `site-map.tsx`.
  useEffect(() => {
    if (!isMapLoaded) return;
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      if (!map.hasImage(iconName)) {
        const canvas = document.createElement("canvas");
        canvas.width = PIN_WIDTH * PIN_RASTER_SCALE;
        canvas.height = PIN_HEIGHT * PIN_RASTER_SCALE;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("2D canvas context unavailable");
        }
        drawPinIcon(ctx, spec);
        map.addImage(iconName, ctx.getImageData(0, 0, canvas.width, canvas.height), {
          pixelRatio: PIN_RASTER_SCALE,
        });
      }
      readyTimer = setTimeout(() => {
        if (!cancelled) setIconReady(true);
      }, 0);
    } catch (error) {
      logger.error("site_location_map.icon_generation_failed", {
        siteId: site.id,
        icon: iconName,
        message: errorMessage(error),
      });
    }

    return () => {
      cancelled = true;
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, [isMapLoaded, iconName, spec, site.id]);

  const coordinates = `${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}`;

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-56 w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-100 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:bg-depth-2 dark:text-zinc-400">
        <span>Map unavailable — NEXT_PUBLIC_MAPBOX_TOKEN is not set.</span>
        <span className="font-mono text-zinc-600 dark:text-zinc-300">{coordinates}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="h-56 w-full overflow-hidden rounded-xl sm:h-72">
        <Map
          ref={mapRef}
          onLoad={() => setIsMapLoaded(true)}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{ longitude: site.longitude, latitude: site.latitude, zoom }}
          style={{ width: "100%", height: "100%" }}
          mapStyle="mapbox://styles/mapbox/outdoors-v12"
          // See this file's header: scroll-zoom off so the map can't hijack
          // the page scroll it is embedded in; rotation/pitch off because a
          // tilted coastline is disorienting rather than informative. Pan,
          // pinch, keyboard and the NavigationControl below all stay on.
          scrollZoom={false}
          dragRotate={false}
          pitchWithRotate={false}
          touchPitch={false}
        >
          <NavigationControl position="top-right" showCompass={false} />

          {/* Drawn before the pin layer so the dashed line sits under the
              site marker rather than over it at their one point of overlap.
              Founder ask (2026-08-11): "a hash line from the shore to the
              site" — sky-600 to match this app's one already-established
              primary/informational hue (DESIGN_SYSTEM.md), never the amber/
              rose semantic colors reserved for caution/danger, since this is
              a plain distance measurement, not a warning. */}
          {entryLine && (
            <Source id={SHORE_ENTRY_LINE_SOURCE_ID} type="geojson" data={entryLine.lineGeoJSON}>
              <Layer
                id={SHORE_ENTRY_LINE_LAYER_ID}
                type="line"
                layout={{ "line-cap": "round" }}
                paint={{
                  "line-color": "#0284c7",
                  "line-width": 2.5,
                  "line-dasharray": [2, 2],
                  "line-opacity": 0.85,
                }}
              />
            </Source>
          )}

          {iconReady && (
            <Source id={SITE_LOCATION_SOURCE_ID} type="geojson" data={featureCollection}>
              <Layer
                id={SITE_LOCATION_LAYER_ID}
                type="symbol"
                layout={{
                  "icon-image": ["get", "icon"],
                  "icon-size": 1,
                  "icon-anchor": "bottom",
                  "icon-allow-overlap": true,
                  "icon-ignore-placement": true,
                }}
              />
            </Source>
          )}

          {/* The line's other endpoint — a small, deliberately plain circle,
              not a second pin-icon system. `pin-icons.ts`'s icon language is
              reserved for actual dive sites; this marks a shore *entry*, a
              different kind of thing, and should read as visually distinct
              at a glance, not as a second, lesser dive site. */}
          {entryLine && (
            <Marker longitude={entryLine.entryPoint.longitude} latitude={entryLine.entryPoint.latitude}>
              <div
                aria-hidden="true"
                className="h-3 w-3 rounded-full border-2 border-white bg-sky-600 shadow-md dark:border-depth-1"
              />
            </Marker>
          )}

          {/* The distance itself, in the unit a diver actually thinks in —
              same `formatShoreDistance` the shore-access prose section uses,
              so the map and the text can never disagree about the number. */}
          {entryLine && shoreAccess && shoreAccess.distanceMiles !== null && (
            <Marker longitude={entryLine.midpoint.longitude} latitude={entryLine.midpoint.latitude}>
              <div
                aria-hidden="true"
                className="whitespace-nowrap rounded-full border border-sky-700/30 bg-white/95 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 shadow-sm dark:border-sky-400/30 dark:bg-depth-1/95 dark:text-sky-300"
              >
                {formatShoreDistance(shoreAccess.distanceMiles)}
              </div>
            </Marker>
          )}
        </Map>
      </div>

      {/* The symbol layer has no DOM node, so this is the only thing a screen
          reader can reach — name, exact coordinates, and the facts the pin
          encodes visually. Same gap, same remedy as `site-map.tsx`'s
          visually-hidden site list. */}
      <p className="sr-only">{siteLocationDescription(site)}</p>
      {entryLine && shoreAccess && shoreAccess.nearestEntry && shoreAccess.distanceMiles !== null && (
        <p className="sr-only">{shoreEntryLineDescription(shoreAccess.nearestEntry, shoreAccess.distanceMiles)}</p>
      )}
    </div>
  );
}
