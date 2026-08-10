/**
 * Pin-tap preview sheet — closes a real gap between what was designed and
 * what shipped.
 *
 * `creative/mockups/map-exploration/03-pin-preview-sheet.html` designed this
 * interaction from the start: tap a pin, see a compact preview, decide
 * whether to go further. The implementation instead sent every pin tap
 * straight to a full page navigation (`router.push` in `site-map.tsx`) with
 * no intermediate step. That matters more than it sounds: a diver scanning
 * ten pins to plan a trip, or a dive master previewing sites for a group
 * outing, had to leave the map and come back for every single one — losing
 * the map's spatial context on every tap, on a page that otherwise goes out
 * of its way to preserve viewport/filter state across navigation
 * (`explorer-preferences.ts`). This restores the originally-designed
 * intermediate step using real data instead of the mockup's placeholders.
 *
 * Deliberately reuses this app's existing badge components
 * (`ProvenanceBadge`, `LegalAccessBadge`) rather than inventing new pill
 * markup, so the sheet and the full detail page never disagree about what a
 * badge means — same rule `site-dive-profile.tsx` follows for its own
 * classifier output.
 */

import Link from "next/link";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { LegalAccessBadge } from "@/components/legal-access-badge";
import { SITE_TYPE_LABELS } from "@/lib/sites/site-type-labels";
import type { SiteMarker } from "@/lib/sites/types";

export interface SitePinPreviewSheetProps {
  site: SiteMarker;
  onClose: () => void;
}

// Deliberately no `unlikely` entry — found 2026-08-10 while converging this
// app's shore-access renderers onto a shared standard: this map used to say
// "Boat access likely" for `unlikely`, directly contradicting
// shore-access.ts's own rule that `unlikely` also means "no known entry has
// been catalogued yet," not "confirmed boat-only." A compact preview sheet
// has no room for that nuance the way the detail page's full prose does, so
// the honest fix here is to show nothing at all rather than a misleading
// claim — same "hide rather than mislead" precedent `ShoreAccessBadge`
// already sets for an unclassified site.
const SHORE_ACCESS_PREVIEW_LABEL: Record<string, string> = {
  likely: "Plausibly shore-accessible",
  marginal: "Shore-accessible — long swim",
};

function formatDepth(minFt: number | null | undefined, maxFt: number | null | undefined): string | null {
  if (minFt == null && maxFt == null) return null;
  if (minFt != null && maxFt != null && minFt !== maxFt) return `${minFt}–${maxFt} ft`;
  const single = minFt ?? maxFt;
  return single != null ? `${single} ft` : null;
}

export function SitePinPreviewSheet({ site, onClose }: SitePinPreviewSheetProps) {
  const depthLabel = formatDepth(site.depth_min_ft, site.depth_max_ft);
  const shoreLabel = site.shore_access ? SHORE_ACCESS_PREVIEW_LABEL[site.shore_access] : null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Preview of ${site.name}`}
      className="absolute inset-x-0 bottom-0 z-10 rounded-t-2xl border border-b-0 border-zinc-200 bg-white p-4 pb-5 shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.25)] dark:border-depth-border dark:bg-depth-2"
    >
      <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-zinc-300 dark:bg-depth-border" aria-hidden="true" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-black dark:text-zinc-50">{site.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{SITE_TYPE_LABELS[site.site_type]}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:border-depth-border dark:bg-depth-1 dark:text-zinc-400 dark:hover:bg-depth-3"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <ProvenanceBadge provenance={site.provenance} />
        <LegalAccessBadge status={site.legal_access_status} />
      </div>

      {(depthLabel || shoreLabel || site.hasHazardReport) && (
        <div className="mt-3 flex gap-2">
          {depthLabel && (
            <div className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-depth-border dark:bg-depth-1">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Depth</p>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-black dark:text-zinc-50">
                {depthLabel}
              </p>
            </div>
          )}
          {shoreLabel && (
            <div className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-depth-border dark:bg-depth-1">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Access</p>
              <p className="mt-0.5 text-sm font-semibold text-black dark:text-zinc-50">{shoreLabel}</p>
            </div>
          )}
          {site.hasHazardReport && (
            <div className="flex-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 dark:border-amber-400/30">
              <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400">Hazards</p>
              <p className="mt-0.5 text-sm font-semibold text-amber-800 dark:text-amber-300">Reported</p>
            </div>
          )}
        </div>
      )}

      <Link
        href={`/sites/${site.id}`}
        className="mt-4 flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400"
      >
        View full site
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
