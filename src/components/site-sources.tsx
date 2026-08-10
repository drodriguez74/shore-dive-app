/**
 * "Where did this come from?" — the provenance/attribution section of the site
 * detail page (T21.22).
 *
 * A diver evaluating an unfamiliar site is being asked to act on this data, so
 * they are owed a plain answer about its lineage. Three things this section is
 * responsible for, none of which the page said out loud before:
 *
 * 1. **`COMMUNITY` means unreviewed**, not "slightly less official". The badge
 *    carries a tooltip; a tooltip is not a disclosure on a page that feeds a
 *    go/no-go decision, so it is spelled out in prose here.
 * 2. **ODbL attribution is legally required for OSM-imported rows** (plan.md
 *    Resolved Decision #6). `osm-import.ts` writes it into `sites.description`,
 *    where it survives — but only as one paragraph of body text a reader
 *    skims past. It is restated here as an explicit, standalone attribution
 *    with a link to the licence, rather than left buried.
 * 3. **Derived fields must not be mistaken for sourced ones.** Shore access and
 *    depth/certification guidance on this page are computed by *this app* from
 *    coordinates and whatever depth is recorded. Presenting them beside
 *    imported data without saying so would let our own inference borrow the
 *    source's credibility.
 *
 * OSM origin is detected from the description text rather than from
 * `sites.external_source`, which is a real column but deliberately excluded
 * from `SITE_DETAIL_COLUMNS` (see `src/lib/sites/queries.ts`) and therefore not
 * available on this page's data — and that file is not this task's to change.
 * The marker matched is the fixed attribution sentence `buildOsmDescription()`
 * writes, so this detects our own import output, not a guess about prose.
 */

import { ProvenanceBadge } from "@/components/provenance-badge";
import type { SiteProvenance } from "@/lib/sites/types";

const OSM_ATTRIBUTION_MARKER = "OpenStreetMap contributors";

export function isOpenStreetMapSourced(description: string | null | undefined): boolean {
  return typeof description === "string" && description.includes(OSM_ATTRIBUTION_MARKER);
}

export interface SiteSourcesProps {
  provenance: SiteProvenance;
  description: string | null;
  latitude: number;
  longitude: number;
}

export function SiteSources({ provenance, description, latitude, longitude }: SiteSourcesProps) {
  const fromOsm = isOpenStreetMapSourced(description);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Where this data came from</h2>

      <div className="flex flex-wrap items-start gap-2">
        <ProvenanceBadge provenance={provenance} />
        <p className="flex-1 text-xs text-zinc-600 dark:text-zinc-400">
          {provenance === "VERIFIED"
            ? "Checked against an authoritative or explicitly verified source. That covers the record — not today's conditions in the water."
            : "Community-sourced and not independently reviewed. Nobody has checked this entry against the water, so treat every detail on this page as a lead to verify rather than a fact."}
        </p>
      </div>

      {fromOsm && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          Imported from OpenStreetMap. Map data ©{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-200"
          >
            OpenStreetMap contributors
          </a>
          , licensed under the{" "}
          <a
            href="https://opendatacommons.org/licenses/odbl/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-200"
          >
            Open Database License (ODbL)
          </a>
          . Imports are automated and unreviewed — details may be incomplete or wrong.
        </p>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Shore access and the depth/certification guidance above are calculated by this app from the site&apos;s
        coordinates and whatever depth is on file. They are our derivation, not a claim made by the original
        source.
      </p>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Coordinates are shown exactly as recorded, not blurred: {latitude.toFixed(5)}, {longitude.toFixed(5)}.
      </p>
    </section>
  );
}
