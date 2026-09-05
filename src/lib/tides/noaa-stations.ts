/**
 * Nearest-NOAA-tide-station lookup for the site detail page's tide-table
 * link (plan.md's Optional/Bonus bucket: "Tide-table link on site detail
 * (near-zero cost, free NOAA data — arguably worth doing opportunistically
 * given the cost, but not required)").
 *
 * ## Static snapshot, not a live API call — the (a) vs (b) judgment call
 *
 * NOAA's CO-OPS station-metadata API (`mdapi/prod/webapi/stations.json`,
 * no key required) is the source of truth, but this module does NOT call it
 * at render time. `noaa-reference-stations.json` is a one-time, dated
 * snapshot of it instead, in the same spirit as `CURATED_ENTRY_POINTS`
 * (`src/lib/sites/shore-access.ts`): a periodically-refreshed static list
 * beats a live third-party dependency on a hot page-render path. Two
 * reasons this one leans even harder toward static than a typical judgment
 * call:
 *
 * 1. **`src/app/sites/[id]/page.tsx` is `export const dynamic =
 *    "force-dynamic"`** — it already renders fresh on every request. Adding
 *    a live NOAA fetch there would mean every single site-detail page view,
 *    for every diver, makes an outbound call to a third party this app
 *    doesn't control, with a new failure mode (NOAA downtime/latency now
 *    blocks or degrades an otherwise-working page) for data that is close
 *    to static in the first place.
 * 2. **NOAA tide *stations* don't move.** A station's id/name/coordinates
 *    are physical-infrastructure facts, not live conditions — unlike actual
 *    tide predictions (which this module deliberately does NOT fetch or
 *    render; see the header note below), station metadata is exactly the
 *    kind of thing that's safe to snapshot and stale-tolerant for months.
 *
 * The tradeoff this accepts: a station decommissioned/added after the
 * snapshot date won't be reflected until the data file is refreshed by
 * hand. That's an acceptable staleness window for "which station is
 * nearby," the same way `CURATED_ENTRY_POINTS` accepts it for shore-entry
 * points. Re-fetch periodically with:
 *
 *   curl 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions'
 *
 * and regenerate by filtering to `type === "R"` (see below).
 *
 * ## Why only reference ("R") stations, not subordinate ("S") ones
 *
 * NOAA's full tide-prediction station list is ~3,499 entries: 1,256 are
 * `"R"` (reference stations — a full harmonic tidal record, the primary
 * long-term gauges) and 2,243 are `"S"` (subordinate stations — predictions
 * derived by applying a fixed time/height offset to a nearby reference
 * station, denser but secondary). This module bundles only the 1,256 `"R"`
 * stations (`noaa-reference-stations.json`, ~140KB checked in) — verified
 * against this app's own real Florida shore-entry coordinates
 * (`SOUTH_FLORIDA_ENTRY_POINTS` in `shore-access.ts`) that reference-only
 * coverage is already dense enough to land within 1-3 miles of a real
 * shore-dive entry point on the open Atlantic coast, without doubling the
 * bundled dataset for subordinate stations this task's "keep scope tight"
 * instruction doesn't need. If a future audit finds real gaps (e.g. a
 * region with sparse reference-station coverage), subordinate stations are
 * the documented way to fill them in — not a reason to rebuild this from
 * scratch.
 *
 * ## What this module does NOT do
 *
 * It does not fetch, cache, or render actual tide predictions (height/time
 * of high and low tide). It only answers "which real NOAA station, if any,
 * is close enough to this site to be a meaningful pointer" and hands back
 * NOAA's own public prediction page URL for that station
 * (`SiteTideLink` in `src/components/site-tide-link.tsx` builds that link).
 * Rendering live tide data inside this app would mean taking on ongoing
 * fetching/caching/correctness for a chart NOAA already publishes and
 * maintains — a bigger commitment than a "near-zero cost, opportunistic"
 * bonus item should take on, and a second, less-authoritative copy of data
 * NOAA already presents better than this app could.
 */

import { distanceMiles, type LatLng } from "@/lib/sites/distance";
import { logger } from "@/lib/sites/logger";
import stationRows from "./noaa-reference-stations.json";

export interface NoaaStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Two-letter US state/territory code, or `null` for a handful of
   * federally-operated stations NOAA doesn't tag with one (e.g. some Great
   * Lakes/boundary-water gauges). Display-only — never used in matching. */
  state: string | null;
}

/**
 * Cast, not runtime-validated: `stationRows` is this module's own checked-in
 * snapshot (see header), not user input or a live fetch response, so the
 * usual "validate external data" discipline doesn't apply the way it would
 * to a network response. The shape is guaranteed by the generation script
 * this file's header documents.
 */
const NOAA_REFERENCE_STATIONS = stationRows as NoaaStation[];

/**
 * How far a NOAA reference station may be from a site before this app stops
 * treating it as "the nearby tide station." NOAA's own API returns a
 * *nearest match by definition* with no distance cap — for a US coastal
 * site that's meaningful, but for a site anywhere else on Earth (this
 * catalogue is deliberately global — see `shore-access.ts`'s
 * `CURATED_ENTRY_POINTS` header, "I have no idea what scuba diver will use
 * my app and where they are located") the "nearest" station could be a
 * thousand-plus miles away and would be actively misleading if linked.
 *
 * 50 miles, the conservative end of the 50-100mi range this task named as
 * reasonable. Chosen over a looser cutoff because tide *timing* (not just
 * range) is shaped by local coastline geometry — inlets, bays, and barrier
 * islands can shift high/low tide by an hour or more between two points
 * NOAA itself would call "nearby" — so a tighter radius keeps this link
 * closer to "roughly this site's actual tide" and further from "some
 * station on the same coastline, more or less."
 */
export const NOAA_STATION_MAX_DISTANCE_MILES = 50;

export interface NearestNoaaStationResult {
  station: NoaaStation;
  distanceMiles: number;
}

/**
 * Finds the closest NOAA reference station to `site`, or `null` when either
 * nothing is within `NOAA_STATION_MAX_DISTANCE_MILES` (the honest, expected
 * outcome for most of the world — NOAA/CO-OPS only covers the US coast and
 * Great Lakes) or the lookup itself fails unexpectedly. Callers (
 * `SiteTideLink`) must render nothing on `null` rather than a broken or
 * wildly-irrelevant link — see this module's header and CLAUDE.md's
 * "never imply more certainty than the data supports" standard.
 *
 * Pure/synchronous over a bundled static array — no network I/O at call
 * time (see header) — but still wrapped defensively per CLAUDE.md's
 * boundary-handling standard: this runs on every site-detail page render,
 * and a corrupt/malformed data file must fail closed (no link) rather than
 * take the page down with it.
 */
export function findNearestNoaaStation(site: LatLng): NearestNoaaStationResult | null {
  try {
    let nearest: NoaaStation | null = null;
    let nearestDistance = Infinity;

    for (const station of NOAA_REFERENCE_STATIONS) {
      const distance = distanceMiles(site, { latitude: station.lat, longitude: station.lng });
      if (distance < nearestDistance) {
        nearest = station;
        nearestDistance = distance;
      }
    }

    if (!nearest || nearestDistance > NOAA_STATION_MAX_DISTANCE_MILES) {
      return null;
    }

    return { station: nearest, distanceMiles: nearestDistance };
  } catch (error) {
    logger.error("tides.nearest_station_lookup_failed", {
      latitude: site.latitude,
      longitude: site.longitude,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * NOAA's own public tide-prediction page for a station — the honest
 * link-out this feature exists to provide, rather than this app rendering
 * (and having to keep correct) live tide data of its own. See this
 * module's header, "What this module does NOT do."
 */
export function noaaTidePredictionsUrl(stationId: string): string {
  return `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${encodeURIComponent(stationId)}`;
}
