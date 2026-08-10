"use client";

import { FreshnessBadge } from "@/components/freshness-badge";

/**
 * "Last verified" timestamp UI (T16.2). THREAT_MODEL.md §8: "never show a
 * binary open/closed status without a last-verified time" — this pairs with
 * `ProvenanceBadge` on every LDS marker to satisfy that.
 *
 * Deliberately a thin wrapper around `FreshnessBadge`, not a fork: its prop
 * shape (a timestamp + a staleness threshold + optional className) is
 * already generic enough for this use case — `FreshnessBadge` doesn't know
 * or care whether the timestamp came from a cache write or a human
 * verification, its live-updating relative-time + staleness-color logic is
 * identical either way. The one thing it isn't generic on is the *label*
 * text, which is hardcoded to cache language ("Cached ... ago" / "Stale —
 * cached ... ago") — accurate for Task 13's offline-cache use case, but
 * confusing here (an LDS status isn't "cached", a human verified it). Since
 * `freshness-badge.tsx` is off-limits this round and doesn't expose a label
 * override prop, this wrapper adds an explicit "Last verified" caption
 * alongside the reused badge rather than duplicating its internal
 * relative-time/staleness computation to get different wording.
 *
 * Flag for founder review: if more provenance-timestamp UIs show up beyond
 * this one (hazard report "as of", etc.), it's worth adding an optional
 * `label`/`verb` prop to `FreshnessBadge` itself so this wrapper (and any
 * future one) can drop the extra caption — not done here to keep this
 * batch's diff scoped to the LDS layer only.
 */

export interface LastVerifiedBadgeProps {
  /** `lds_status.last_verified_at` — when a human last confirmed this status. */
  lastVerifiedAt: Date | string;
  /**
   * Hours after which the badge flips into its stale state. Defaults to 24h
   * (not `FreshnessBadge`'s own 12h default): fill-station open/closed/air
   * status is typically confirmed at day-level granularity (a shop's hours
   * don't usually change within a day), so a tighter cache-staleness
   * threshold would over-warn. Still per-call-site configurable.
   */
  staleAfterHours?: number;
  className?: string;
}

export function LastVerifiedBadge({ lastVerifiedAt, staleAfterHours = 24, className = "" }: LastVerifiedBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Last verified
      </span>
      <FreshnessBadge cachedAt={lastVerifiedAt} staleAfterHours={staleAfterHours} />
    </span>
  );
}
