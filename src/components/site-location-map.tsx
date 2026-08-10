"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, NavigationControl, Source, type MapRef } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import { legalAccessLabel } from "@/components/legal-access-badge";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
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
import type { SiteMarker, SiteType } from "@/lib/sites/types";

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

/**
 * Close enough to read the shoreline, the road behind it and any obvious entry
 * point, without zooming so far in that the surrounding geography (which is
 * how a diver orients) drops out of frame.
 */
export const DEFAULT_SITE_LOCATION_ZOOM = 14;

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
   * exploration map renders, so both maps are driven by identical inputs and
   * cannot drift into showing the same site differently. */
  site: SiteMarker;
  /** Override the initial zoom. Read once at mount by Mapbox, like every
   * `initialViewState` field. */
  zoom?: number;
}

export function SiteLocationMap({ site, zoom = DEFAULT_SITE_LOCATION_ZOOM }: SiteLocationMapProps) {
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [iconReady, setIconReady] = useState(false);
  const mapRef = useRef<MapRef | null>(null);

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
        </Map>
      </div>

      {/* The symbol layer has no DOM node, so this is the only thing a screen
          reader can reach — name, exact coordinates, and the facts the pin
          encodes visually. Same gap, same remedy as `site-map.tsx`'s
          visually-hidden site list. */}
      <p className="sr-only">{siteLocationDescription(site)}</p>
    </div>
  );
}
