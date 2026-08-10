"use client";

import Link from "next/link";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { LegalAccessBadge } from "@/components/legal-access-badge";
import type { GeolocationCoords, GeolocationStatus } from "@/hooks/use-geolocation";
import { SITE_TYPE_LABELS, SITE_TYPE_OPTIONS } from "@/lib/sites/site-type-labels";
import { DIFFICULTY_LABEL, type DifficultyLevel } from "@/lib/sites/dive-difficulty";
import type { SiteMarker } from "@/lib/sites/types";
import {
  siteDifficultyLevel,
  radiusLabel,
  describeActiveFilters,
  type SiteTypeFilter,
  type DifficultyFilter,
} from "@/components/dive-site-explorer";

export interface SiteWithDistance {
  site: SiteMarker;
  miles: number;
}

export interface NearbyDiveSitesListProps {
  /** Full, unfiltered `sites` list — used only as fallback content before
   * geolocation resolves (see the `!coords` branch below), same role it
   * always had pre-T21.6. Already type-filtered by `DiveSiteExplorer`. */
  sites: SiteMarker[];
  status: GeolocationStatus;
  coords: GeolocationCoords | null;
  radiusMiles: number;
  onRadiusChange: (miles: number) => void;
  radiusOptions: readonly number[];
  isSearching: boolean;
  /** The radius-filtered result set to render — server search result or
   * client-side-filtered fallback, already resolved by the caller
   * (`DiveSiteExplorer`, T21.6) so this component doesn't duplicate that
   * decision. Already type-filtered by `DiveSiteExplorer` too. */
  inRadius: SiteWithDistance[];
  searchedExternally: boolean;
  /** Currently selected site-type filter (2026-08-09) — owned by
   * `DiveSiteExplorer` so the map and this list stay in sync, same reason
   * radius state lives there. This component only renders the control. */
  siteTypeFilter: SiteTypeFilter;
  onSiteTypeFilterChange: (filter: SiteTypeFilter) => void;
  /** Currently selected difficulty filter (T21.26) — same shared-state-lives-
   * in-the-parent pattern as `siteTypeFilter` immediately above, for the
   * identical reason (`DiveSiteExplorer`'s own comments). */
  difficultyFilter: DifficultyFilter;
  onDifficultyFilterChange: (filter: DifficultyFilter) => void;
  /** Resolved server-side and threaded down from `DiveSiteExplorer`. Only
   * affects the zero-result empty state — see `SignInToSearchHint` below. */
  isSignedIn?: boolean;
}

/**
 * Homepage "Dive sites" panel (follow-up to `T11.5`, requested 2026-08-08).
 * Default radius 25mi, expandable via the select below, per the founder's
 * explicit ask.
 *
 * As of T21.6 (plan.md Resolved Decision #8): this component is now purely
 * presentational. It used to own geolocation resolution, radius state, and
 * the `search-nearby` fetch itself (T21.4) — all of that moved up into
 * `src/components/dive-site-explorer.tsx` so `SiteMap` and this list share
 * one radius-driven data source, instead of the radius `<select>` only ever
 * affecting this list (the bug T21.6 exists to fix — see that file's own
 * header comment for the full rationale). Rendering behavior is otherwise
 * unchanged from the pre-T21.6 version: same fallback-to-full-`sites`-prop
 * rule before coordinates resolve, same loading/empty-state copy, same
 * "never show a worse state than what existed before T21.4" principle.
 *
 * As of 2026-08-09: also renders the site-type filter row (chips for each
 * `SiteType` + "All"). The actual filtering happens in `DiveSiteExplorer`,
 * same shared-state-lives-in-the-parent pattern as radius — this component
 * only renders the control and reports selection changes upward.
 *
 * As of T21.26: also renders the difficulty filter row (chips for each
 * `DifficultyLevel` + "All", next to the site-type row) and a per-site
 * difficulty badge in `SiteRows`. Same split as the type filter: filtering
 * happens in `DiveSiteExplorer`, this component only renders the controls
 * and (for the badge) calls the shared, already-tested `siteDifficultyLevel`
 * classification directly — it's a pure, cheap function of fields already on
 * `SiteMarker`, so recomputing it here for display needs no prop threading.
 */
export function NearbyDiveSitesList({
  sites,
  status,
  coords,
  radiusMiles,
  onRadiusChange,
  radiusOptions,
  isSearching,
  inRadius,
  searchedExternally,
  siteTypeFilter,
  onSiteTypeFilterChange,
  difficultyFilter,
  onDifficultyFilterChange,
  isSignedIn = false,
}: NearbyDiveSitesListProps) {
  const noFilterActive = siteTypeFilter === "all" && difficultyFilter === "all";
  if (sites.length === 0 && noFilterActive) return null;

  const maxRadius = radiusOptions[radiusOptions.length - 1];
  const hasCoords = coords !== null;
  const visibleSites = hasCoords ? inRadius.map((entry) => entry.site) : sites;
  const isEmpty = hasCoords ? inRadius.length === 0 : sites.length === 0;

  // Founder-reported bug (2026-08-10): filter clicks would intermittently
  // "stop working," including ones that had just worked. Root cause —
  // `SiteTypeFilterRow`/`DifficultyFilterRow` used to be rendered from TWO
  // separate `return` statements (one for `!coords`, one for `coords`
  // resolved), each producing a structurally different JSX tree. React can
  // only reconcile a re-render in place when successive renders return the
  // *same shaped* tree at the same position; two different `return`
  // statements are two different trees, so the instant `coords` resolved —
  // asynchronously, so this could land in the middle of a click — React
  // unmounted the whole `!coords` tree (filter buttons included) and mounted
  // the `coords`-resolved tree fresh. A click landing in that transition
  // window could hit a button that had already been removed from the DOM
  // (silently doing nothing), or fire during the handoff with results that
  // didn't match either tree's expected state — exactly the "click seems to
  // land on the wrong filter" and "then nothing responds" symptoms reported.
  // Confirmed live: an automated rapid-click pass briefly found zero
  // matching filter buttons in the DOM immediately after a geolocation
  // resolution mid-sequence.
  //
  // Fix: one `return`, one stable tree. `SiteTypeFilterRow`/
  // `DifficultyFilterRow` (and the outer container) now render from a single
  // position that never structurally changes; only the *content* inside it
  // (header text, the optional radius `<select>`, the results list vs.
  // empty-state message) varies with `coords`. React updates that content in
  // place across a `coords` transition instead of tearing down and rebuilding
  // the whole subtree, so the filter controls — and whatever DOM node last
  // had focus — stay mounted and responsive throughout.
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          {hasCoords ? "Dive sites near you" : "Dive sites"}
        </h2>
        {hasCoords && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            Within
            <select
              value={radiusMiles}
              onChange={(event) => onRadiusChange(Number(event.target.value))}
              className="min-h-[32px] rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            >
              {radiusOptions.map((miles) => (
                <option key={radiusLabel(miles)} value={miles}>
                  {radiusLabel(miles)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!hasCoords && status === "unavailable" && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Enable location access to see sites sorted by distance from you.
        </p>
      )}

      <SiteTypeFilterRow value={siteTypeFilter} onChange={onSiteTypeFilterChange} />
      <DifficultyFilterRow value={difficultyFilter} onChange={onDifficultyFilterChange} />

      {hasCoords && isSearching && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Looking for dive sites near you…</p>
      )}

      {isEmpty ? (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {hasCoords ? (
              <>
                {!noFilterActive
                  ? `No ${describeActiveFilters(siteTypeFilter, difficultyFilter)}sites within ${radiusLabel(radiusMiles)} of your location yet.`
                  : searchedExternally
                    ? `Checked OpenStreetMap too — no dive sites within ${radiusLabel(radiusMiles)} yet`
                    : `No dive sites within ${radiusLabel(radiusMiles)} of your location yet`}
                {noFilterActive && radiusMiles < maxRadius ? " — try expanding the radius." : ""}
              </>
            ) : (
              // Reachable only when a filter is active — the top-level early
              // return above already handles sites.length === 0 with no
              // filter active, so this branch always has at least one real
              // filter description to name.
              <>No {describeActiveFilters(siteTypeFilter, difficultyFilter)}sites on file yet.</>
            )}
          </p>
          {hasCoords && !isSignedIn && noFilterActive && !searchedExternally && <SignInToSearchHint />}
        </>
      ) : (
        <SiteRows
          sites={visibleSites}
          distances={hasCoords ? new Map(inRadius.map((entry) => [entry.site.id, entry.miles])) : null}
        />
      )}
    </div>
  );
}

/**
 * Shown only to signed-out visitors who got an empty result that was NOT
 * externally searched — i.e. exactly the case `T21.13`'s auth gate created.
 * That gate exists for a real reason (the import path writes via a
 * service-role client, so leaving it anonymous made an unauthenticated GET
 * an unbounded write trigger), but it left a silent dead end: "no dive sites
 * near you" with no indication that more are findable.
 *
 * Copy is deliberately careful: signing in enables the *search*, it does not
 * promise the search will find anything — same honest-disclosure standard
 * `CLAUDE.md` applies to the Safe-Return timer ("never let a UI imply a
 * guarantee the system can't back"). "may find more" and "not guaranteed",
 * not "unlock all nearby dive sites".
 */
function SignInToSearchHint() {
  return (
    <p className="text-xs text-zinc-500 dark:text-zinc-400">
      <Link
        href="/login"
        className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
      >
        Sign in
      </Link>{" "}
      to also search OpenStreetMap for dive sites here — it may find more, though there may genuinely be
      none mapped nearby.
    </p>
  );
}

/** Chip row: "All" plus one chip per `SiteType`. Deliberately simple
 * (native buttons, no new dependency) matching this panel's existing
 * control style (the radius `<select>` above). Doesn't hide/omit types
 * with zero current results — a diver filtering by "Cave" should be able
 * to tell "none nearby" apart from "caves aren't a supported filter". */
function SiteTypeFilterRow({
  value,
  onChange,
}: {
  value: SiteTypeFilter;
  onChange: (filter: SiteTypeFilter) => void;
}) {
  const options: SiteTypeFilter[] = ["all", ...SITE_TYPE_OPTIONS];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const label = option === "all" ? "All types" : SITE_TYPE_LABELS[option];
        const isActive = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            className={`min-h-[28px] rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              isActive
                ? "border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500"
                : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Chip row: "All" plus one chip per `DifficultyLevel` (T21.26). Same
 * deliberately-simple native-button style as `SiteTypeFilterRow` immediately
 * below (this panel's established filter-chip pattern), and same "don't hide
 * a chip just because it currently has zero matches" rule. `DifficultyLevel`
 * never includes `null` — see `DifficultyFilter`'s own doc comment in
 * `dive-site-explorer.tsx` for why a `level: null` site has no filter chip of
 * its own and instead only ever shows under "All". */
function DifficultyFilterRow({
  value,
  onChange,
}: {
  value: DifficultyFilter;
  onChange: (filter: DifficultyFilter) => void;
}) {
  const options: DifficultyFilter[] = ["all", "beginner", "intermediate", "advanced", "technical"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const label = option === "all" ? "All difficulties" : DIFFICULTY_LABEL[option];
        const isActive = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={isActive}
            title={
              option === "all"
                ? "Includes sites with no difficulty rating (not enough depth/access data yet)"
                : undefined
            }
            className={`min-h-[28px] rounded-full border px-2.5 py-1 text-xs font-medium transition ${
              isActive
                ? "border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500"
                : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Badge colors (T21.26) — a distinct hue per level, escalating in visual
 * "loudness" from beginner to technical, and deliberately NOT reusing any
 * hue already load-bearing on this exact row: `ProvenanceBadge` (sky/
 * violet/dashed-zinc, imported above) and `LegalAccessBadge` (emerald/amber/
 * rose/dashed-zinc) both render immediately adjacent to this badge in
 * `SiteRows` below, so "green means open access" and "amber means caution"
 * must stay unambiguous — a difficulty badge in emerald or amber would read
 * as a legal-status claim it isn't. Teal/blue/orange/red are each a
 * different named Tailwind scale from every color already in that set
 * (teal ≠ emerald, blue ≠ sky, orange ≠ amber, red ≠ rose) while still
 * reading as an intuitive low-to-high intensity ramp on their own. Same pill
 * shape/sizing as the other two badge families so all three read as one
 * badge language, per this component's existing visual pattern. */
const DIFFICULTY_BADGE_CLASSES: Record<DifficultyLevel, string> = {
  beginner:
    "border-teal-600/40 bg-teal-500/10 text-teal-800 dark:border-teal-400/40 dark:bg-teal-400/10 dark:text-teal-300",
  intermediate:
    "border-blue-600/40 bg-blue-500/10 text-blue-800 dark:border-blue-400/40 dark:bg-blue-400/10 dark:text-blue-300",
  advanced:
    "border-orange-600/40 bg-orange-500/10 text-orange-800 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-300",
  technical:
    "border-red-600/40 bg-red-500/10 text-red-800 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-300",
};

/**
 * Small, scannable per-site difficulty badge for the list row. Renders
 * nothing when `level` is `null` ("not enough measured data") rather than a
 * placeholder — this codebase's standing "never imply data you don't have"
 * rule (CLAUDE.md), same discipline `LegalAccessBadge`'s `unassessed` state
 * observes by rendering a distinct dashed badge instead of guessing, except
 * here there is no badge at all to render: unlike legal-access "not yet
 * assessed", which is itself worth surfacing, an unrated difficulty has no
 * safety-relevant claim to make, so a bare, unexplained badge would be
 * worse than nothing. `title` repeats `dive-difficulty.ts`'s own disclaimer
 * verbatim (not a softened rewrite) so hovering the badge never reads as a
 * stronger claim than the classifier itself makes — this is a composite of
 * depth/overhead/swim-distance, never a safety rating or a "cleared to
 * dive" verdict. */
function DifficultyBadge({ level }: { level: DifficultyLevel | null }) {
  if (level === null) return null;
  return (
    <span
      title="Based only on depth, overhead environment and swim distance — not a safety rating."
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${DIFFICULTY_BADGE_CLASSES[level]}`}
    >
      {DIFFICULTY_LABEL[level]}
    </span>
  );
}

function SiteRows({ sites, distances }: { sites: SiteMarker[]; distances: Map<string, number> | null }) {
  return (
    <ul className="mt-1 flex flex-col gap-2">
      {sites.map((site) => (
        <li key={site.id}>
          <Link
            href={`/sites/${site.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 transition hover:bg-zinc-100 dark:bg-depth-2 dark:hover:bg-depth-3"
          >
            <span className="text-sm font-medium text-black dark:text-zinc-50">
              {site.name}
              {distances?.has(site.id) && (
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  {distances.get(site.id)!.toFixed(1)} mi
                </span>
              )}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <DifficultyBadge level={siteDifficultyLevel(site)} />
              <ProvenanceBadge provenance={site.provenance} />
              <LegalAccessBadge status={site.legal_access_status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
