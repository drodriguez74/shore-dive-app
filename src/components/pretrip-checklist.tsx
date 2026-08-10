"use client";

import { PrefetchButton } from "@/components/prefetch-button";

/**
 * Pre-trip checklist prompt (T12.7) — Resolved Decision 3 in plan.md names
 * this, alongside the manual "Prefetch Now" trigger, as the *reliable* path
 * for getting a dive plan's sites cached (background sync is opportunistic
 * at best). This nudges the user to prefetch everything in their plan
 * before they lose signal at the water's edge.
 *
 * A real `dive_plans` table exists (`supabase/migrations/0007_dive_plans.sql`,
 * plan.md Resolved Decision 5), but no caller anywhere queries a user's real
 * plans and feeds them in here yet — that cross-site "your whole plan" view
 * is a genuinely bigger change than this component's own scope (see
 * `src/app/sites/[id]/page.tsx`'s note on the same gap) and remains a real,
 * separate follow-up. Until then, `plan` defaults to `[]` — the honest
 * "nothing to prefetch" state — never to fabricated entries. Found and fixed
 * 2026-08-10: this used to default to two hardcoded fake sites (`MOCK_PLAN`),
 * which the one real call site (the site detail page) already had to
 * explicitly override with `plan={[]}` to avoid showing them — the mock was
 * a live landmine for the next caller, not just unused.
 */

export interface PretripPlanEntry {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD). */
  diveDate: string;
}

export interface PretripChecklistProps {
  plan?: PretripPlanEntry[];
  className?: string;
}

function daysUntil(dateISO: string, now: Date): number | null {
  const target = new Date(`${dateISO}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = target.getTime() - now.getTime();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

export function PretripChecklist({ plan = [], className = "" }: PretripChecklistProps) {
  if (plan.length === 0) return null;

  const now = new Date();

  return (
    <div
      className={`rounded-lg border border-sky-600/30 bg-sky-500/5 p-4 dark:border-sky-400/20 dark:bg-sky-400/5 ${className}`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className="text-lg leading-none">
          🎒
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-black dark:text-zinc-50">Before you lose signal</h3>
          <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
            Prefetch is best-effort — the service worker only updates its cache when you actually have the
            app open. Tap &quot;Prefetch Now&quot; for each site in your dive plan while you still have a
            connection.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {plan.map((entry) => {
              const days = daysUntil(entry.diveDate, now);
              const dueLabel =
                days === null
                  ? "date unknown"
                  : days <= 0
                    ? "diving today"
                    : `in ${days} day${days === 1 ? "" : "s"}`;

              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/60 px-3 py-2 text-sm dark:bg-black/20"
                >
                  <div>
                    <span className="font-medium text-black dark:text-zinc-50">{entry.name}</span>
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{dueLabel}</span>
                  </div>
                  <PrefetchButton siteId={entry.id} siteName={entry.name} />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
