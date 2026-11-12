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
 * Site detail page. Public read (matching `sites`' RLS); the auth check
 * only gates the "add to dive plan" form and never blocks the public data.
 *
 * Deliberately informative about sites the reader can't currently dive —
 * a technical-depth wreck is labelled plainly, not hidden, and shore access
 * is framed as plausible, never confirmed. The copy rules for those sections
 * live in `site-dive-profile.tsx` and `site-sources.tsx`.
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
          <p>The site database is unreachable right now. Try reloading shortly.</p>
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
    // A failed auth check only degrades the dive-plan form to a sign-in prompt.
    logger.error("site_detail.auth_check_failed", {
      siteId: id,
      error: authError instanceof Error ? authError.message : String(authError),
    });
  }

  // Same shape the homepage map uses, so this site renders with the identical pin.
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
    // `hazards` is newest-first, so the first element is the latest report.
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

      {/* Blank-line-separated paragraphs: the last one carries the required source attribution. */}
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
                  <HazardRecencyBadge reportedAt={hazard.created_at} />
                </div>
                <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">{hazard.description}</p>
              </li>
            ))}
          </ul>
        )}
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
          Save this site&apos;s details and hazard reports to this device before you lose signal at the
          water&apos;s edge. A saved copy only refreshes while the app is open with a connection, so refresh it
          before you head out.
        </p>
        <PrefetchButton siteId={site.id} />
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
