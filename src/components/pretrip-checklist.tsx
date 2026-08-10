"use client";

import { PrefetchButton } from "@/components/prefetch-button";

/**
 * Pre-trip checklist prompt (T12.7) — Resolved Decision 3 in plan.md names
 * this, alongside the manual "Prefetch Now" trigger, as the *reliable* path
 * for getting a dive plan's sites cached (background sync is opportunistic
 * at best). This nudges the user to prefetch everything in their plan
 * before they lose signal at the water's edge.
 *
 * There's no real dive-plan data model yet (that's Task 14/16 territory), so
 * this operates on mock/placeholder entries, same as prefetch-button.tsx.
 */

export interface PretripPlanEntry {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) — mock stand-in for a real dive-plan record. */
  diveDate: string;
}

const MOCK_PLAN: PretripPlanEntry[] = [
  { id: "mock-site-1", name: "La Jolla Cove", diveDate: "2026-08-07" },
  { id: "mock-site-2", name: "Shaw's Cove", diveDate: "2026-08-09" },
];

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

export function PretripChecklist({ plan = MOCK_PLAN, className = "" }: PretripChecklistProps) {
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
