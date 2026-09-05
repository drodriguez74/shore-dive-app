import Link from "next/link";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSiteWithHazards, SITE_DETAIL_HAZARD_LIMIT } from "@/lib/sites/queries";
import { logger } from "@/lib/sites/logger";
import { SITE_TYPE_LABELS } from "@/lib/sites/site-type-labels";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { LegalAccessBadge } from "@/components/legal-access-badge";
import { HazardRecencyBadge } from "@/components/hazard-recency-badge";
import { PrefetchButton } from "@/components/prefetch-button";
import { SiteLocationMap } from "@/components/site-location-map";
import { SiteDiveProfile } from "@/components/site-dive-profile";
import { SiteSources } from "@/components/site-sources";
import { SiteResearchSummary } from "@/components/site-research-summary";
import { SiteTideLink } from "@/components/site-tide-link";
import type { SiteMarker } from "@/lib/sites/types";
import { AddToDivePlanForm } from "./add-to-dive-plan-form";

/**
 * Site detail page (Task 11.5 / plan.md v5 MVP item #1) — the first real,
 * reachable destination for a `sites` row anywhere in the app. Public read
 * (no auth needed for the site/hazard data itself, matching `sites`' RLS),
 * with an inline auth check ONLY for the "add to dive plan" action — same
 * split `src/app/moderation/camera-sources/page.tsx` already uses (public
 * data load first, auth check only for the part of the page that actually
 * needs it), not a full route guard on the whole page.
 *
 * Also the real home for `PrefetchButton` (T12.6) — built and correct,
 * previously mounted by zero routes per TASKS.md's own downgrade note.
 * `PretripChecklist` (T12.7) is NOT mounted here (moved 2026-08-13, see
 * scope note below) — it lives on `/dive-plans` now, the real cross-site
 * "your whole plan" view this page's own prior comment named as its
 * eventual home.
 *
 * T21.22 enriched this page for the founder's actual reader: "I want to know
 * of all dive sites as I may end up on a boat charter going there. Or
 * specifically target one that does." So it is deliberately informative about
 * a site the reader *cannot currently dive* — a location map, depth against
 * recreational training limits (a technical-depth wreck is labelled plainly,
 * not hidden), shore access framed as plausible-never-confirmed, and an
 * explicit account of where the data came from. The copy rules those sections
 * follow are documented on `site-dive-profile.tsx` and `site-sources.tsx`;
 * they are the source modules' own constraints made visible, not stylistic
 * choices, and changing them means re-reading
 * `src/lib/sites/{shore-access,dive-suitability}.ts` first.
 *
 * Scope notes (read before extending):
 * - Tide-station link (plan.md's "optional/bonus" item) IS built here —
 *   `SiteTideLink`, mounted below. It renders nothing for the (currently
 *   large) majority of sites with no NOAA station nearby; see that
 *   component's and `src/lib/tides/noaa-stations.ts`'s own headers for the
 *   full reasoning (static station snapshot, link-out only, no in-app tide
 *   data).
 * - `PretripChecklist` used to be mounted here with an explicit empty plan
 *   (`plan={[]}`) — meaning it rendered nothing, ever, on this page (its own
 *   `if (plan.length === 0) return null`). An earlier version of this page
 *   omitted the prop entirely and got a hardcoded `MOCK_PLAN` default for
 *   free, which meant every single site's detail page showed "La Jolla Cove
 *   diving today" / "Shaw's Cove diving today" regardless of which real site
 *   you were looking at (caught 2026-08-09, same root cause as the mock
 *   block that was also on the homepage); `MOCK_PLAN` was removed
 *   2026-08-10, leaving the always-empty, always-invisible mount behind as
 *   dead code — found in the 2026-08-13 UX audit (`TASKS.md` T25). **Fixed
 *   the same day**: `/dive-plans` (new) is the real cross-site "your whole
 *   plan" view this note used to describe as a future follow-up, and it's
 *   the one place `PretripChecklist` mounts now, fed real
 *   `dive_plans` rows via `listDivePlansForUser()`. Nothing to mount here
 *   anymore — a single site's own page has no "whole plan" to show.
 * - The pin-tap flow's designed "compact preview bottom sheet" (before
 *   landing here) IS built — `src/components/site-pin-preview-sheet.tsx`,
 *   wired into `site-map.tsx`. This note previously said otherwise; that was
 *   stale by the time of the 2026-08-13 restyle pass and is corrected here.
 */

export const dynamic = "force-dynamic";

interface SiteDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function SiteDetailPage({ params }: SiteDetailPageProps) {
  const { id } = await params;

  const isConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!isConfigured) {
    return (
      <PageShell>
        <NoticeCard title="Supabase is not configured yet">
          <p>
            This page needs <code className="rounded bg-zinc-100 px-1 dark:bg-depth-2">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and <code className="rounded bg-zinc-100 px-1 dark:bg-depth-2">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> set
            in <code className="rounded bg-zinc-100 px-1 dark:bg-depth-2">.env.local</code> — copy{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-depth-2">.env.local.example</code> and fill in a real
            Supabase project&apos;s values.
          </p>
        </NoticeCard>
      </PageShell>
    );
  }

  const { site, hazards, truncated, error } = await getSiteWithHazards(id);

  if (error) {
    return (
      <PageShell>
        <NoticeCard title="Couldn't load this site">
          <p>{error}</p>
        </NoticeCard>
      </PageShell>
    );
  }

  if (!site) {
    return (
      <PageShell>
        <NoticeCard title="Site not found">
          <p>No dive site with this ID exists — it may have been removed, or the link is wrong.</p>
        </NoticeCard>
      </PageShell>
    );
  }

  let userId: string | null = null;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch (authError) {
    // A failed auth check must never block reading public site data — it
    // only means the "add to dive plan" action degrades to a sign-in
    // prompt, same fail-safe direction `moderation/camera-sources/page.tsx`
    // takes.
    logger.error("site_detail.auth_check_failed", {
      siteId: id,
      error: authError instanceof Error ? authError.message : String(authError),
    });
  }

  // The exploration map's own pin input shape — passed straight through so
  // `SiteLocationMap` renders this site with the identical icon it carries on
  // the homepage map (same `pin-icons.ts` spec), rather than a second,
  // drifting representation of the same site.
  const marker: SiteMarker & Pick<typeof site, "shore_entry_id" | "shore_distance_yards"> = {
    id: site.id,
    name: site.name,
    latitude: site.latitude,
    longitude: site.longitude,
    provenance: site.provenance,
    legal_access_status: site.legal_access_status,
    site_type: site.site_type,
    shore_access: site.shore_access,
    shore_access_method: site.shore_access_method,
    shore_entry_id: site.shore_entry_id,
    shore_distance_yards: site.shore_distance_yards,
    hasHazardReport: hazards.length > 0,
    // `hazards` is already ordered newest-first (`getSiteWithHazards`'s own
    // `.order("created_at", { ascending: false })`), so the first element is
    // this site's most recent report — feeds the pin's own stale/fresh fill
    // via `SiteLocationMap`, same recency signal the hazard-report list
    // below renders as text via `HazardRecencyBadge`.
    latestHazardReportAt: hazards[0]?.created_at ?? null,
  };

  return (
    <PageShell>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            {site.name}
          </h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ProvenanceBadge provenance={site.provenance} />
          <LegalAccessBadge status={site.legal_access_status} />
          <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-depth-border dark:bg-depth-2 dark:text-zinc-300">
            {SITE_TYPE_LABELS[site.site_type] ?? SITE_TYPE_LABELS.unclassified}
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
          {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
        </p>
      </div>

      <SiteLocationMap site={marker} />

      {/* The description is the richest real content most imported rows carry
          (OSM's own free-text entry) AND the carrier of the required ODbL
          attribution — `osm-import.ts` writes it as blank-line-separated
          paragraphs. Rendering it in a single <p> collapsed all of that into
          one wall of text; splitting on blank lines is what makes the
          attribution and the reported-depth line actually readable rather
          than buried. */}
      {site.description && (
        <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">About this site</h2>
          {site.description
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index} className="text-sm text-zinc-600 dark:text-zinc-400">
                {paragraph}
              </p>
            ))}
        </section>
      )}

      <SiteResearchSummary
        summary={site.research_summary ?? null}
        sources={site.research_sources ?? null}
        updatedAt={site.research_summary_updated_at ?? null}
      />

      <SiteDiveProfile site={site} />

      <SiteTideLink site={{ latitude: site.latitude, longitude: site.longitude }} />

      <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          Hazard reports {hazards.length > 0 ? `(${hazards.length})` : ""}
        </h2>
        {hazards.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            None on file. This is informational, not a safety guarantee — absence of a report doesn&apos;t mean
            the site is confirmed clear.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {hazards.map((hazard) => (
              <li
                key={hazard.id}
                className="rounded-lg bg-amber-500/5 border border-amber-600/20 p-3 dark:border-amber-400/20"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ProvenanceBadge provenance={hazard.provenance} />
                  {/* Staleness treatment (plan.md's Task 13 v5 addition) — a
                      raw `toLocaleDateString()` used to sit here with no
                      recency weighting at all, so a 3-week-old report and a
                      2-hour-old one read identically. Same freshness/
                      staleness language `LastVerifiedBadge` already
                      established elsewhere in this app, extended to a third
                      "aging" tier per `hazard-recency.ts`'s own reasoning. */}
                  <HazardRecencyBadge reportedAt={hazard.created_at} />
                </div>
                <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">{hazard.description}</p>
              </li>
            ))}
          </ul>
        )}
        {/* `getSiteWithHazards` already tells callers when its hazard read came
            back at the cap; saying nothing would present a partial history as
            the complete one. */}
        {truncated && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Showing the {SITE_DETAIL_HAZARD_LIMIT} most recent reports — this site has more on file than are
            listed here.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Offline access</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Best-effort — the service worker only updates its cache when you have the app open. Prefetch before
          you lose signal at the water&apos;s edge.
        </p>
        <PrefetchButton siteId={site.id} siteName={site.name} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Dive plan</h2>
        {userId ? (
          <AddToDivePlanForm siteId={site.id} siteName={site.name} />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Sign in to add {site.name} to a dive plan.
            </p>
            <Link
              href="/login"
              className="inline-block self-start rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
            >
              Sign in
            </Link>
          </div>
        )}
      </section>

      <SiteSources
        provenance={site.provenance}
        description={site.description}
        latitude={site.latitude}
        longitude={site.longitude}
      />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
        <Link
          href="/"
          className="text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Shore Dive
        </Link>
        {children}
      </main>
    </div>
  );
}

function NoticeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-depth-border dark:bg-depth-1 dark:text-zinc-300">
      <h2 className="font-semibold text-black dark:text-zinc-50">{title}</h2>
      <div className="mt-1 flex flex-col gap-2">{children}</div>
    </div>
  );
}
