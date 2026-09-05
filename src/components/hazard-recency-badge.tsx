/**
 * Hazard-report recency badge (plan.md's Task 13 v5 addition) — the
 * site-detail-page consumer of `src/lib/sites/hazard-recency.ts`'s
 * three-tier classification.
 *
 * **Why this is a new small component rather than reusing `FreshnessBadge`/
 * `LastVerifiedBadge` directly**, even though it deliberately borrows their
 * visual language wholesale (a pill, an icon + text, a color that shifts
 * with trust, a `title` carrying the absolute timestamp): both of those are
 * built around a single fresh/stale boolean threshold (`staleAfterHours`),
 * and `hazard-recency.ts`'s own header explains why a hazard report needs a
 * third, "aging" tier in between — a binary badge has no state to render
 * that doesn't either overstate an aging report as fresh or discard it as
 * fully stale. Neither existing badge exposes a way to plug in a third
 * tier's copy/color without changing its own props, so this is a sibling
 * that reuses their *pattern*, not a fork of their *code* — following
 * `LastVerifiedBadge`'s own precedent of being a small, separate wrapper
 * rather than bending a two-state component into a three-state shape.
 *
 * Deliberately NOT `"use client"`: the site detail page that mounts this is
 * a Server Component rendered fresh per request (`export const dynamic =
 * "force-dynamic"` on `src/app/sites/[id]/page.tsx`), so "now" is already
 * re-evaluated on every page load — unlike `FreshnessBadge`, which lives
 * inside client components that can stay mounted for a whole dive session
 * and therefore re-ticks itself via `setInterval` so it doesn't visibly
 * freeze. A hazard report's age only needs to be right at render time, not
 * live-updating while the page sits open, so no ticking is added here.
 *
 * `now` stays injectable (defaults to the real clock) for the same testing
 * reasons `hazardReportRecency` itself requires it.
 */

import { hazardReportRecency, type HazardReportRecency } from "@/lib/sites/hazard-recency";

export interface HazardRecencyBadgeProps {
  /** `hazard_reports.created_at` — when this report was filed. */
  reportedAt: string | Date;
  now?: Date;
  className?: string;
}

const MINUTE_MS = 60 * 1000;

// A small, local relative-time formatter rather than importing
// `freshness-badge.tsx`'s own (private, unexported) copy. That file isn't
// this task's to edit — `last-verified-badge.tsx`'s header notes the same
// tradeoff for its own wrapper — so this duplicates roughly a dozen lines
// rather than risk a change to a component three other surfaces depend on.
// Flag for a future pass: if a fourth recency UI shows up, this is worth
// factoring into one shared, exported helper.
function formatRelative(date: Date, now: Date): string {
  const diffMinutes = Math.round((now.getTime() - date.getTime()) / MINUTE_MS);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 1) return "just now";
  if (Math.abs(diffMinutes) < 60) return rtf.format(-diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(-diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(-diffDays, "day");
}

/** Icon + copy + color per tier — three distinct treatments so the
 * distinction is never color-only (plan.md's engineering-standards addenda:
 * map-pin/status information needs "a non-color-only path"). Each tier gets
 * its own icon glyph AND its own trailing qualifier text, not just a
 * palette swap. */
const TIER_COPY: Record<HazardReportRecency, { icon: string; qualifier: string | null; classes: string }> = {
  fresh: {
    icon: "●",
    qualifier: null,
    classes:
      "border-amber-600/40 bg-amber-500/10 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  },
  aging: {
    icon: "◐",
    qualifier: "aging",
    classes:
      "border-amber-600/25 bg-amber-500/5 text-amber-700/90 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-400/80",
  },
  stale: {
    icon: "○",
    qualifier: "dated — may not reflect current conditions",
    classes:
      "border-zinc-300 bg-zinc-100 text-zinc-500 dark:border-depth-border dark:bg-depth-2 dark:text-zinc-500",
  },
};

export function HazardRecencyBadge({ reportedAt, now = new Date(), className = "" }: HazardRecencyBadgeProps) {
  const reportedDate = reportedAt instanceof Date ? reportedAt : new Date(reportedAt);
  const isValid = !Number.isNaN(reportedDate.getTime());
  // `hazardReportRecency` already resolves an invalid timestamp to "stale"
  // (the fail-closed tier) — reused here for styling, but the *copy* for
  // that case is written separately below rather than falling through
  // "stale"'s normal "dated — may not reflect current conditions" qualifier,
  // which would misleadingly pair with "unknown time" and imply a real, old
  // date exists when the actual problem is that no valid date does.
  const tier = hazardReportRecency(reportedAt, now);
  const { icon, qualifier, classes } = TIER_COPY[tier];

  const absolute = isValid
    ? reportedDate.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "unknown";

  const label = isValid
    ? `${formatRelative(reportedDate, now)}${qualifier ? ` — ${qualifier}` : ""}`
    : "Timestamp missing or invalid";

  return (
    <span
      title={isValid ? `Reported ${absolute}` : "Report timestamp missing or invalid"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${classes} ${className}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </span>
  );
}
