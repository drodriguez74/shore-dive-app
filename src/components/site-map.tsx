"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Map, { Marker, Popup, Source, Layer, type MapRef } from "react-map-gl/mapbox";
import type { MapLayerMouseEvent } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { LastVerifiedBadge } from "@/components/lds/last-verified-badge";
import { LdsSubmissionForm } from "@/components/lds/lds-submission-form";
import { LDS_STATUS_LABEL, type LdsStatusRow, type LdsStatusValue } from "@/components/lds/lds-status";
import { legalAccessLabel } from "@/components/legal-access-badge";
import { useGeolocation } from "@/hooks/use-geolocation";
import { useExplorerPreferences } from "@/lib/sites/explorer-preferences";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import { hazardReportRecency } from "@/lib/sites/hazard-recency";
import {
  allPinIconSpecs,
  drawPinIcon,
  legalGlyphTier,
  pinIconName,
  PIN_HEIGHT,
  PIN_RASTER_SCALE,
  PIN_WIDTH,
} from "@/lib/sites/pin-icons";
import { SitePinPreviewSheet } from "@/components/site-pin-preview-sheet";
import type { SiteMarker, SiteType } from "@/lib/sites/types";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// La Jolla Cove, San Diego — a real shore dive site, used as the FALLBACK
// center only (no geolocation permission yet / denied / unsupported). The
// primary behavior, below, centers on the diver's own location.
const DEFAULT_VIEW = { longitude: -117.2713, latitude: 32.8328, zoom: 10 };

// Fill-station status pin color (T16.1) — a quick visual read, but never the
// *only* signal: every marker's popup always also shows ProvenanceBadge +
// LastVerifiedBadge (THREAT_MODEL.md §8 — never a bare open/closed badge
// with no source or freshness attached). The dot color is a hint, not a
// substitute for that. NOT part of T21.6/T21.7's scope — left exactly as-is,
// still rendered via <Marker> (a handful of fill stations, not hundreds/
// thousands of features, so the GeoJSON/symbol-layer migration rationale
// below doesn't apply to these).
const STATUS_DOT_CLASSES: Record<LdsStatusValue, string> = {
  open: "bg-emerald-500 border-emerald-700",
  closed: "bg-rose-500 border-rose-700",
  limited: "bg-amber-500 border-amber-700",
  unknown: "bg-zinc-400 border-zinc-600",
};

// Site pins (Task 11.5, migrated to a GeoJSON Source + symbol Layer by
// T21.7, plan.md Resolved Decision #9) — the pin *icon system* itself (the
// teardrop path, the provenance/hazard/legal-access visual dimensions, the
// site-type glyphs, the icon naming scheme, and the canvas rasterizer),
// along with the design reasoning behind all of it, lives in
// `src/lib/sites/pin-icons.ts` as of T21.17. What stays here is only how
// those icons reach the map: rasterizing each spec into `map.addImage`,
// the GeoJSON feature collection carrying each site's icon name, the
// symbol layer's `["get", "icon"]` expression, and event wiring.
/** Whether a site's most recent hazard report has aged into
 * `hazard-recency.ts`'s "stale" tier — `false` whenever there's no report at
 * all (nothing to be stale). Shared by `siteAccessibleLabel` and
 * `buildSiteFeatureCollection` so the screen-reader text and the pin's
 * visual treatment can never disagree about which sites read as stale.
 *
 * `now` defaults to a fresh `new Date()` per call rather than being
 * threaded through as a prop: unlike `FreshnessBadge`, this map doesn't
 * re-tick a displayed age on a timer (see `HazardRecencyBadge`'s own header
 * for why day-scale thresholds don't need that) — `buildSiteFeatureCollection`
 * already only re-runs when `siteMarkers` itself changes (this file's
 * `useMemo` below), i.e. whenever real data is fetched, which is the point
 * at which "now" should be re-evaluated anyway. */
function siteHazardStale(site: SiteMarker, now: Date = new Date()): boolean {
  // A missing `latestHazardReportAt` on a `hasHazardReport: true` marker is
  // NOT the same failure mode `hazardReportRecency`'s own "fail toward
  // stale" rule guards against. That rule exists for a malformed/unparseable
  // *string* (a real data problem, "fail toward looking less fresh, not
  // more"). An absent field here more likely means a caller built this
  // `SiteMarker` without threading the optional new field (legacy/partial
  // construction) than that the report is actually old — and receding a
  // hazard pin by default in that ambiguous case is the wrong safety
  // direction: it would make a possibly-current hazard warning *less*
  // visible over a data-completeness gap unrelated to the report's real
  // age. So this defaults to full-strength (not stale) rather than
  // reusing `hazardReportRecency`'s bad-string handling.
  if (!site.hasHazardReport || !site.latestHazardReportAt) return false;
  return hazardReportRecency(site.latestHazardReportAt, now) === "stale";
}

function siteAccessibleLabel(site: SiteMarker): string {
  const glyphTier = legalGlyphTier(site.legal_access_status);
  return [
    site.name,
    site.provenance === "VERIFIED" ? "Verified" : "Community",
    // T13 v5 addition: a stale report gets its own accessible text too, not
    // just a faded pin — plan.md's engineering-standards addenda calls for
    // a non-color-only path for pin information, and a de-emphasized pin
    // fill is exactly a color/opacity-only signal without this.
    site.hasHazardReport ? (siteHazardStale(site) ? "hazard reported (dated)" : "hazard reported") : null,
    glyphTier ? legalAccessLabel(site.legal_access_status) : null,
  ]
    .filter(Boolean)
    .join(" — ");
}

interface SitePinProperties {
  id: string;
  name: string;
  provenance: SiteMarker["provenance"];
  legal_access_status: SiteMarker["legal_access_status"];
  hasHazardReport: boolean;
  site_type: SiteType;
  icon: string;
}

function buildSiteFeatureCollection(
  siteMarkers: SiteMarker[],
  now: Date = new Date(),
): GeoJSON.FeatureCollection<GeoJSON.Point, SitePinProperties> {
  return {
    type: "FeatureCollection",
    features: siteMarkers.map((site) => {
      const siteType = site.site_type;
      const legalTier = legalGlyphTier(site.legal_access_status);
      const isCommunity = site.provenance === "COMMUNITY";
      const hazardStale = siteHazardStale(site, now);
      const icon = pinIconName({
        siteType,
        isCommunity,
        hasHazardReport: site.hasHazardReport,
        hazardStale,
        legalTier,
      });

      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [site.longitude, site.latitude] },
        properties: {
          id: site.id,
          name: site.name,
          provenance: site.provenance,
          legal_access_status: site.legal_access_status,
          hasHazardReport: site.hasHazardReport,
          site_type: siteType,
          icon,
        },
      };
    }),
  };
}

const SITE_PINS_SOURCE_ID = "site-pins";
const SITE_PINS_LAYER_ID = "site-pins-layer";

export interface SiteMapProps {
  /** LDS/fill-station markers to render (T16.1), already collapsed to
   * "current status per shop" (`latestStatusPerShop`, see `lds-status.ts`).
   * Real `lds_status` data as of T22.6 — `src/lib/sites/queries.ts`'s
   * `listLdsStatusMarkers()`, fed by `src/app/page.tsx`. Found and fixed
   * 2026-08-10: this used to default to `MOCK_LDS_LOG`'s hand-written fake
   * shops and render on the live homepage unconditionally, not as a
   * fallback — nothing ever queried the real table. Defaults to `[]`, the
   * honest "no verified shops yet" state, same convention `siteMarkers`
   * below already followed. */
  ldsMarkers?: LdsStatusRow[];
  /** Real `sites` pins (Task 11.5), rendered via a GeoJSON Source + symbol
   * Layer as of T21.7 — fed by whichever caller owns the current
   * radius-filtered/search result set (T21.6's `DiveSiteExplorer` on the
   * homepage; a plain full `sites` fetch anywhere else this is reused).
   * Defaults to an empty array, never mock data: an empty default means "no
   * sites fetched yet / fetch failed", never a stand-in for real data. */
  siteMarkers?: SiteMarker[];
  /**
   * Explains an empty `siteMarkers` — e.g. "No sites within 25 mi of your
   * location." Founder-reported bug (2026-08-10): the map would render pins
   * on first paint (before geolocation resolves) and then silently go blank
   * once it did, if the resolved location had zero sites in range. With no
   * on-map explanation, a correct "you have no nearby sites" result and an
   * actual failure looked identical. `null`/omitted renders nothing — the
   * caller (`DiveSiteExplorer`) only supplies a message for the specific
   * case it actually understands (post-geolocation, radius-filtered,
   * genuinely empty); this component never invents its own reason.
   */
  emptyStateMessage?: string | null;
  /**
   * Manual "search here" trigger (Phase 1 of the map-pan discovery feature,
   * 2026-08-11) — called with the map's current center (read imperatively
   * via `mapRef.current?.getCenter()` at click time, not tracked in state,
   * so it can never go stale between pans and the click) when the diver
   * wants to search wherever they've panned to instead of their own
   * geolocation. Optional and omitted-by-default: `site-location-map.tsx`
   * (the single-site detail map) has no use for this, only
   * `DiveSiteExplorer` does. Rendering the button is gated on this prop
   * being provided, not on `emptyStateMessage`/pin count — deliberately
   * persistent rather than auto-detected, since Mapbox already shows a
   * visibly empty map when panned somewhere with no data; no separate
   * "is this area empty" heuristic is needed.
   */
  onFetchHere?: (center: { latitude: number; longitude: number }) => void;
  /** Disables the fetch-here button and swaps its label while a search
   * triggered by it is in flight — same "never let the user fire a second
   * overlapping request" discipline as every other async action in this
   * app. */
  isFetchingHere?: boolean;
  /**
   * `TASKS.md T27`, from the 2026-08-13 UX audit: a tour guide or shop owner
   * standing at a real site already knows exactly where they are, but a
   * *returning* visitor's map opens wherever `savedViewport` last left it
   * (Bermuda, say — this component's own `useExplorerPreferences` restore
   * above), not their real current position, with previously no way back to
   * it except manually panning/zooming the whole way there by hand — the
   * map's own one-time geolocation fly-to (above) only ever fires once, on
   * a mount with no saved viewport at all.
   *
   * Called after this component has already flown the camera back to the
   * diver's real `useGeolocation()` position (this component owns the fly,
   * since it already has `userLocation` and `mapRef` — the caller doesn't
   * need to pass coordinates back in) — purely a "the camera moved, reset
   * whatever data-side manual override you were tracking" signal, mirroring
   * `onFetchHere`'s own map-owns-the-camera / caller-owns-the-data split.
   * Omitted entirely on `site-location-map.tsx` (the single-site detail
   * map), same as `onFetchHere` — only `DiveSiteExplorer` has a manual
   * override to reset.
   */
  onUseMyLocation?: () => void;
  /** Whether the viewer has a real session, resolved server-side by the
   * page (Task 16, 2026-08-20). Passed straight through to the LDS popup's
   * report form, which shows a sign-in prompt rather than a form that
   * `lds_status`' `to authenticated` insert policy would reject. Never a
   * security boundary — `/api/lds/submit` re-checks the session itself. */
  isSignedIn?: boolean;
  /** Called with the `lds_status` row the server actually inserted after a
   * successful status report from the popup, so the owner of `ldsMarkers`
   * (`DiveSiteExplorer`) can merge it and repaint the pin/popup without a
   * reload. This component deliberately doesn't hold its own copy of
   * `ldsMarkers`: the caller already owns that state, and a second local
   * copy is how a pin and a list end up disagreeing. */
  onLdsSubmitted?: (marker: LdsStatusRow) => void;
}

export function SiteMap({
  ldsMarkers = [],
  siteMarkers = [],
  emptyStateMessage = null,
  onFetchHere,
  isFetchingHere = false,
  onUseMyLocation,
  isSignedIn = false,
  onLdsSubmitted,
}: SiteMapProps) {
  const [openMarkerId, setOpenMarkerId] = useState<string | null>(null);
  const [reportingMarkerId, setReportingMarkerId] = useState<string | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [iconsReady, setIconsReady] = useState(false);
  // The pin-preview sheet's open site (T21.27) — a tap opens this instead of
  // navigating straight to the detail page. See site-pin-preview-sheet.tsx's
  // header for why: the direct-navigation behavior this replaces lost the
  // map's position/context on every single pin tap.
  const [previewSiteId, setPreviewSiteId] = useState<string | null>(null);
  const mapRef = useRef<MapRef | null>(null);
  const { coords: userLocation } = useGeolocation();
  const { viewport: savedViewport, isHydrated, setViewport } = useExplorerPreferences();

  // Whether this mount has already positioned the map. Set when the saved
  // viewport is restored OR when the geolocation fly-to runs, so a later
  // geolocation resolution can't yank the map away from a position the diver
  // deliberately panned to.
  const hasPositionedRef = useRef(false);

  // Auto-fly to the diver's real location — but ONLY when there's no saved
  // viewport to honor. Before this guard the map re-flew on every mount, so
  // returning from a site detail page threw away wherever the diver had
  // panned to (reported 2026-08-09). A saved viewport is an explicit choice;
  // geolocation is a first-run convenience, and the explicit choice wins.
  //
  // Waits on `isHydrated` so a first-paint `savedViewport === null` (the
  // server snapshot, before localStorage is readable) isn't mistaken for
  // "the diver has never moved the map" — that would re-introduce the exact
  // bug this guard exists to fix.
  useEffect(() => {
    if (!isHydrated || !isMapLoaded) return;
    if (savedViewport || hasPositionedRef.current) return;
    if (!userLocation) return;
    hasPositionedRef.current = true;
    mapRef.current?.flyTo({ center: [userLocation.longitude, userLocation.latitude], zoom: 11, duration: 1200 });
  }, [userLocation, isMapLoaded, isHydrated, savedViewport]);

  // T21.7: rasterize every (site_type × provenance × hazard × legal-tier)
  // icon combination once the map's style has loaded, then register each
  // with `map.addImage` so the symbol layer's data-driven `icon-image`
  // expression can reference them by name. Mapbox GL JS doesn't accept raw
  // SVG strings for `addImage` — each glyph is drawn straight to an
  // offscreen `<canvas>` (Canvas 2D primitives, not a `loadImage` network
  // round-trip, since these are generated locally, not fetched) and handed
  // over as `ImageData`. Wrapped in try/catch: this is a browser-API
  // boundary (canvas context can be unavailable in exotic environments) and
  // must never crash the whole map over icon generation failing — the
  // symbol layer simply doesn't render (siteMarkers list below still keeps
  // sites reachable) rather than the page breaking. `setIconsReady` is
  // deferred via `setTimeout`, same react-hooks/set-state-in-effect reason
  // documented at length in use-geolocation.ts/media-embed.tsx —
  // functionally still immediate, just outside the effect's own synchronous
  // body (a synchronous `addImage` loop's own setState is exactly the
  // cascading-render pattern that lint rule flags).
  useEffect(() => {
    if (!isMapLoaded) return;
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      for (const spec of allPinIconSpecs()) {
        const name = pinIconName(spec);
        if (map.hasImage(name)) continue;

        const canvas = document.createElement("canvas");
        canvas.width = PIN_WIDTH * PIN_RASTER_SCALE;
        canvas.height = PIN_HEIGHT * PIN_RASTER_SCALE;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("2D canvas context unavailable");
        }
        drawPinIcon(ctx, spec);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        map.addImage(name, imageData, { pixelRatio: PIN_RASTER_SCALE });
      }
      readyTimer = setTimeout(() => {
        if (!cancelled) setIconsReady(true);
      }, 0);
    } catch (error) {
      logger.error("site_map.icon_generation_failed", { message: errorMessage(error) });
    }

    return () => {
      cancelled = true;
      if (readyTimer) clearTimeout(readyTimer);
    };
  }, [isMapLoaded]);

  // T21.7: click/hover interaction for the symbol layer. A symbol layer has
  // no DOM node to attach a <Link>'s onClick to, so this uses mapbox-gl's
  // own layer-scoped event API directly on the underlying map instance
  // (imperative, inside a useEffect — the same pattern this file already
  // uses for `flyTo` above, not a new one invented for this task).
  useEffect(() => {
    if (!isMapLoaded || !iconsReady) return;
    const map = mapRef.current;
    if (!map) return;

    function handleClick(event: MapLayerMouseEvent) {
      const feature = event.features?.[0];
      const id = feature?.properties?.id;
      if (typeof id === "string" && id.length > 0) {
        setPreviewSiteId(id);
      }
    }
    function handleMouseEnter() {
      const canvas = map?.getCanvas();
      if (canvas) canvas.style.cursor = "pointer";
    }
    function handleMouseLeave() {
      const canvas = map?.getCanvas();
      if (canvas) canvas.style.cursor = "";
    }

    try {
      map.on("click", SITE_PINS_LAYER_ID, handleClick);
      map.on("mouseenter", SITE_PINS_LAYER_ID, handleMouseEnter);
      map.on("mouseleave", SITE_PINS_LAYER_ID, handleMouseLeave);
    } catch (error) {
      logger.error("site_map.layer_interaction_setup_failed", { message: errorMessage(error) });
    }

    return () => {
      try {
        map.off("click", SITE_PINS_LAYER_ID, handleClick);
        map.off("mouseenter", SITE_PINS_LAYER_ID, handleMouseEnter);
        map.off("mouseleave", SITE_PINS_LAYER_ID, handleMouseLeave);
      } catch {
        // Map instance may already be torn down (component unmounting) —
        // nothing to clean up in that case, never worth crashing on.
      }
    };
  }, [isMapLoaded, iconsReady]);

  const siteFeatureCollection = useMemo(() => buildSiteFeatureCollection(siteMarkers), [siteMarkers]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full min-h-[400px] w-full items-center justify-center rounded-lg border border-dashed border-neutral-700 bg-neutral-900/40 p-8 text-center text-sm text-neutral-400">
        Set NEXT_PUBLIC_MAPBOX_TOKEN in .env.local to render the map.
      </div>
    );
  }

  // Hold the map back one paint until localStorage is readable. Mapbox reads
  // `initialViewState` exactly once at mount and ignores later changes, so
  // rendering before hydration would bake in the DEFAULT_VIEW fallback and
  // then visibly jump — the "always opens on California, then refreshes"
  // symptom reported 2026-08-09. Same dimensions as the real map so this
  // costs no layout shift.
  if (!isHydrated) {
    return (
      <div
        className="h-full min-h-[400px] w-full animate-pulse rounded-xl bg-zinc-200/60 dark:bg-depth-2"
        aria-hidden="true"
      />
    );
  }

  const openMarker = ldsMarkers.find((marker) => marker.id === openMarkerId) ?? null;
  const previewSite = siteMarkers.find((site) => site.id === previewSiteId) ?? null;

  function selectMarker(id: string) {
    setOpenMarkerId(id);
    // Always start a freshly-opened popup on the read-only view, never mid-
    // report-form for whichever marker was previously open.
    setReportingMarkerId(null);
  }

  return (
    <>
      {/* `relative` so the preview sheet below anchors to the map's own
          bounds (bottom-of-map), not the whole page — a full-viewport sheet
          would be wrong on pages that render this map inline rather than
          full-screen. */}
      <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        onLoad={() => setIsMapLoaded(true)}
        // Persist wherever the diver leaves the map so returning from a site
        // detail page restores it. `onMoveEnd` (not `onMove`) fires once per
        // gesture rather than per animation frame, so this is a handful of
        // localStorage writes per session, not hundreds.
        onMoveEnd={(event) => {
          const { longitude, latitude, zoom } = event.viewState;
          hasPositionedRef.current = true;
          setViewport({ longitude, latitude, zoom });
        }}
        mapboxAccessToken={MAPBOX_TOKEN}
        // Restore the saved viewport when there is one; DEFAULT_VIEW is only
        // the true first-run fallback now. Safe to read directly here because
        // the `isHydrated` gate above guarantees localStorage has been read.
        initialViewState={savedViewport ?? DEFAULT_VIEW}
        style={{ width: "100%", height: "100%", minHeight: 400, borderRadius: 12 }}
        mapStyle="mapbox://styles/mapbox/outdoors-v12"
      >
        {iconsReady && (
          <Source id={SITE_PINS_SOURCE_ID} type="geojson" data={siteFeatureCollection}>
            <Layer
              id={SITE_PINS_LAYER_ID}
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

        {ldsMarkers.map((marker) => (
          <Marker key={marker.id} longitude={marker.longitude} latitude={marker.latitude} anchor="bottom">
            <button
              type="button"
              aria-label={`${marker.name} — ${LDS_STATUS_LABEL[marker.status]}`}
              onClick={(event) => {
                event.stopPropagation();
                selectMarker(marker.id);
              }}
              className={`h-4 w-4 cursor-pointer rounded-full border-2 shadow-md transition hover:scale-110 ${STATUS_DOT_CLASSES[marker.status]}`}
            />
          </Marker>
        ))}

        {openMarker && (
          <Popup
            longitude={openMarker.longitude}
            latitude={openMarker.latitude}
            anchor="bottom"
            maxWidth="260px"
            onClose={() => {
              setOpenMarkerId(null);
              setReportingMarkerId(null);
            }}
          >
            <div className="flex min-w-[220px] flex-col gap-2 p-0.5 text-sm">
              <div>
                <div className="font-semibold text-black">{openMarker.name}</div>
                <div className="text-zinc-600">{LDS_STATUS_LABEL[openMarker.status]}</div>
              </div>

              {/* P0-B.5: never render LDS status as a bare badge — provenance
                  and last-verified time are always shown together here. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <ProvenanceBadge provenance={openMarker.provenance} />
                <LastVerifiedBadge lastVerifiedAt={openMarker.last_verified_at} />
              </div>

              {/* plan.md Task 16 v5 addendum, "Liability disclosure": a shop
                  can't control or correct its own listing here yet, but bears
                  the real reputational risk if a stale/wrong status strands a
                  diver. Say plainly that this app doesn't verify status
                  itself and it may be wrong — the same "never imply a
                  guarantee the system can't back" standard CLAUDE.md holds
                  Safe-Return to, applied to LDS status. */}
              <p className="text-xs leading-snug text-zinc-500">
                Community/shop-reported, not a live feed. This app doesn&apos;t verify status itself — it may be
                wrong or outdated.
              </p>

              {reportingMarkerId === openMarker.id ? (
                <LdsSubmissionForm
                  siteId={openMarker.site_id}
                  shopName={openMarker.name}
                  latitude={openMarker.latitude}
                  longitude={openMarker.longitude}
                  isSignedIn={isSignedIn}
                  onSubmitted={onLdsSubmitted}
                  onClose={() => setReportingMarkerId(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setReportingMarkerId(openMarker.id)}
                  className="self-start text-xs font-medium text-violet-700 hover:underline"
                >
                  Report a status update
                </button>
              )}
            </div>
          </Popup>
        )}
      </Map>

      {previewSite && <SitePinPreviewSheet site={previewSite} onClose={() => setPreviewSiteId(null)} />}

      {emptyStateMessage && siteMarkers.length === 0 && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-4 top-4 z-10 rounded-lg border border-zinc-200 bg-white/95 p-3 text-xs text-zinc-600 shadow-md dark:border-depth-border dark:bg-depth-1/95 dark:text-zinc-400"
        >
          {emptyStateMessage}
        </div>
      )}

      {onUseMyLocation && (
        <div className="pointer-events-none absolute bottom-4 right-4 z-10">
          <button
            type="button"
            disabled={!userLocation}
            title={userLocation ? "Fly the map back to my current location" : "Waiting on location access"}
            aria-label="Use my current location"
            onClick={() => {
              if (!userLocation) return;
              hasPositionedRef.current = true;
              mapRef.current?.flyTo({ center: [userLocation.longitude, userLocation.latitude], zoom: 11, duration: 1200 });
              onUseMyLocation();
            }}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-zinc-700 shadow-md transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-depth-border dark:bg-depth-1/95 dark:text-zinc-200"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        </div>
      )}

      {onFetchHere && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
          <button
            type="button"
            disabled={isFetchingHere}
            onClick={() => {
              const center = mapRef.current?.getCenter();
              if (!center) return;
              onFetchHere({ latitude: center.lat, longitude: center.lng });
            }}
            className="pointer-events-auto rounded-full border border-zinc-200 bg-white/95 px-4 py-2 text-xs font-medium text-zinc-700 shadow-md transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-depth-border dark:bg-depth-1/95 dark:text-zinc-200"
          >
            {isFetchingHere ? "Fetching…" : "Fetch dive sites here"}
          </button>
        </div>
      )}
      </div>

      {/* T21.7 accessibility replacement: a symbol layer has no DOM node, so
          the per-pin aria-label/title <Link> the old <Marker>-based
          rendering carried is gone. Rather than rely on whichever page
          happens to also render NearbyDiveSitesList alongside this
          component (true on the homepage today, not guaranteed for every
          future consumer of SiteMap), this visually-hidden list is
          co-located with the map itself so the component is never a
          screen-reader dead zone on its own. Same accessible name text the
          old per-marker aria-label/title used (siteAccessibleLabel). */}
      <ul className="sr-only" aria-label="Dive sites shown on the map">
        {siteMarkers.map((site) => (
          <li key={site.id}>
            <Link href={`/sites/${site.id}`}>{siteAccessibleLabel(site)}</Link>
          </li>
        ))}
      </ul>
    </>
  );
}
