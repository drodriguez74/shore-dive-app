/**
 * Tide-table link-out — plan.md's Optional/Bonus item: "Tide-table link on
 * site detail (near-zero cost, free NOAA data)." Points a diver to NOAA's
 * own authoritative tide-prediction page for the nearest real station, does
 * not render any tide data itself. See `src/lib/tides/noaa-stations.ts`'s
 * header for the full reasoning on why this is a link-out rather than an
 * in-app tide chart, and why the underlying station list is a static
 * snapshot rather than a live NOAA fetch on this render path.
 *
 * Owns its own "is there anything to show" decision — `findNearestNoaaStation`
 * runs inside this component, not the page — same shape as
 * `SiteResearchSummary` (`if (!summary) return null`) rather than pushing a
 * conditional into `src/app/sites/[id]/page.tsx`. Renders nothing when no
 * station is within `NOAA_STATION_MAX_DISTANCE_MILES`: the expected, honest
 * outcome for the large majority of this catalogue's sites, since
 * NOAA/CO-OPS only covers the US coast and Great Lakes and this app is
 * deliberately global (see `shore-access.ts`'s `CURATED_ENTRY_POINTS`
 * header). Same "a missing section is the honest state, not an
 * empty/apologetic one" discipline already established on this page — no
 * "no tide station found nearby" placeholder, just silence.
 */

import { findNearestNoaaStation, noaaTidePredictionsUrl } from "@/lib/tides/noaa-stations";
import type { LatLng } from "@/lib/sites/distance";

export interface SiteTideLinkProps {
  site: LatLng;
}

export function SiteTideLink({ site }: SiteTideLinkProps) {
  const nearest = findNearestNoaaStation(site);
  if (!nearest) return null;

  const { station, distanceMiles } = nearest;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Tides</h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        This app doesn&apos;t track live tide data — this links out to NOAA&apos;s own predictions for the
        nearest station, about {distanceMiles < 1 ? "under 1" : Math.round(distanceMiles)} mi away.
      </p>
      <a
        href={noaaTidePredictionsUrl(station.id)}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-sm font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300"
      >
        Check NOAA tide predictions for {station.name}
        {station.state ? `, ${station.state}` : ""} →
      </a>
    </section>
  );
}
