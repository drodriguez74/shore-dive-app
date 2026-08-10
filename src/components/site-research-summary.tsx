/**
 * "What we found researching this site" — Task 22's researched-summary
 * section of the site detail page.
 *
 * Distinct from both `About this site` (the upstream catalogue's own
 * `description`, rendered separately in `src/app/sites/[id]/page.tsx`) and
 * `SiteSources`' provenance section. This one is specifically our own
 * synthesis of independent web research, and it earns its own section — and
 * its own disclosure — for the same reason `shore_access` gets a confidence
 * tier instead of a plain badge: it must never read as more certain than it
 * is. Renders nothing when a site hasn't been researched yet (`null`
 * `summary`), which is the overwhelming majority of the catalogue in v1
 * scope — see `TASKS.md` T22. A missing section is the honest state, not an
 * empty/apologetic one.
 *
 * Server-renderable on purpose (no `"use client"`, no ticking clock) —
 * unlike `FreshnessBadge` (built for prefetch-cache data that can go stale
 * within hours), research prose is stable on a months/years cadence, so a
 * plain "as of [date]" string is the honest level of precision, not an
 * under-engineered shortcut.
 */

import type { ResearchSource } from "@/lib/sites/types";

export interface SiteResearchSummaryProps {
  summary: string | null;
  sources: ResearchSource[] | null;
  updatedAt: string | null;
}

export function siteResearchFreshnessLabel(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Per research as of ${date.toLocaleDateString(undefined, { dateStyle: "long" })}`;
}

export function SiteResearchSummary({ summary, sources, updatedAt }: SiteResearchSummaryProps) {
  if (!summary) return null;

  const freshnessLabel = siteResearchFreshnessLabel(updatedAt);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-sky-600/30 bg-sky-500/5 p-4 dark:border-sky-400/20 dark:bg-sky-400/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">What we found researching this site</h2>
        <span className="inline-flex items-center rounded-full border border-sky-600/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300">
          AI-assisted web research — not independently verified
        </span>
      </div>

      <p className="text-sm text-zinc-700 dark:text-zinc-300">{summary}</p>

      {sources && sources.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">Sources</h3>
          <ul className="flex flex-col gap-0.5">
            {sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {freshnessLabel && <p className="text-xs text-zinc-500 dark:text-zinc-500">{freshnessLabel}</p>}
    </section>
  );
}
