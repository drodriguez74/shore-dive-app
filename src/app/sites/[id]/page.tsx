import Link from "next/link";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSiteWithHazards, SITE_DETAIL_HAZARD_LIMIT } from "@/lib/sites/queries";
import { logger } from "@/lib/sites/logger";
import { SITE_TYPE_LABELS } from "@/lib/sites/site-type-labels";
import { ProvenanceBadge } from "@/components/provenance-badge";
import { LegalAccessBadge } from "@/components/legal-access-badge";
import { PrefetchButton } from "@/components/prefetch-button";
import { PretripChecklist } from "@/components/pretrip-checklist";
import { SiteLocationMap } from "@/components/site-location-map";
import { SiteDiveProfile } from "@/components/site-dive-profile";
import { SiteSources } from "@/components/site-sources";
import { SiteResearchSummary } from "@/components/site-research-summary";
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
 * Also the real home for `PrefetchButton`/`PretripChecklist` (T12.6/T12.7) —
 * built and correct, previously mounted by zero routes per TASKS.md's own
 * downgrade note.
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
 * - Tide-station link (plan.md's "optional/bonus" item) is NOT built here —
 *   explicitly scoped out of this pass by the task brief.
 * - `PretripChecklist` is mounted with an explicit empty plan (`plan={[]}`).
 *   An earlier version of this page omitted the prop and got a hardcoded
 *   `MOCK_PLAN` default for free, which meant every single site's detail
 *   page showed "La Jolla Cove diving today" / "Shaw's Cove diving today"
 *   regardless of which real site you were looking at (caught 2026-08-09
 *   investigating a founder-reported UX bug — same root cause as the mock
 *   block that was also on the homepage). `MOCK_PLAN` itself was removed
 *   2026-08-10 (`plan` now defaults to `[]`), so this explicit prop is no
 *   longer strictly load-bearing — kept anyway, since this page always has
 *   real context (no real cross-site plan to show) and shouldn't rely on a
 *   component default to express that. The component's own
 *   `if (plan.length === 0) return null` already exists for exactly this
 *   case, so passing `[]` is enough to make it correctly disappear rather
 *   than needing a new prop or a rewrite. A real query of this user's
 *   `dive_plans` joined to `sites` is still a meaningfully bigger change (a
 *   cross-site "your whole plan" view) than this page's own single-site
 *   scope, and remains a natural follow-up now that the table exists
 *   (`supabase/migrations/0007_dive_plans.sql`) — just no longer standing in
 *   for real data with something that looks real but isn't.
 * - The pin-tap flow's designed "compact preview bottom sheet" (before
 *   landing here) is not built — `creative/flows/map-exploration.md` names
 *   it nice-to-have, not required; a direct link from the map pin is this
 *   pass's scope.
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
            This page needs <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> set
            in <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local</code> — copy{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">.env.local.example</code> and fill in a real
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
          <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
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
                <div className="flex items-center justify-between gap-2">
                  <ProvenanceBadge provenance={hazard.provenance} />
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {new Date(hazard.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
                  </span>
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

      <PretripChecklist plan={[]} />

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
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      <h2 className="font-semibold text-black dark:text-zinc-50">{title}</h2>
      <div className="mt-1 flex flex-col gap-2">{children}</div>
    </div>
  );
}
