"use client";

import { useEffect, useState } from "react";

/**
 * Freshness indicator (T13.1/T13.2) — "cached as of [time]" plus a staleness
 * warning past a threshold. THREAT_MODEL.md §2's core finding: a hazard map
 * cached 10 minutes ago and one cached 23 hours ago must never render with
 * the same badge — a stale-looking-fresh cache is a real safety failure
 * mode here, not just a UX nitpick. So staleness is signaled by more than
 * text (color + icon swap), and the default threshold (12h) matches
 * TASKS.md's T13.2 note, but is configurable per call site since not every
 * cached datum should share one threshold (e.g. hazard data may eventually
 * want a tighter window than static site info).
 */

export interface FreshnessBadgeProps {
  /** When the underlying data was cached. */
  cachedAt: Date | string;
  /** Hours after which the badge flips into its stale state. */
  staleAfterHours?: number;
  className?: string;
}

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

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

export function FreshnessBadge({ cachedAt, staleAfterHours = 12, className = "" }: FreshnessBadgeProps) {
  const cachedDate = toDate(cachedAt);
  const isValid = !Number.isNaN(cachedDate.getTime());

  // Re-render on a timer so a badge that stays mounted (e.g. a site left
  // open across a dive) actually walks from "fresh" into "stale" rather
  // than freezing whatever state it had at first render.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), MINUTE_MS);
    return () => clearInterval(interval);
  }, []);

  const ageHours = isValid ? (now.getTime() - cachedDate.getTime()) / HOUR_MS : Number.POSITIVE_INFINITY;
  // An invalid/missing cachedAt is treated as stale, not fresh — never let a
  // data problem silently read as "up to date" (THREAT_MODEL.md §2: fail
  // toward looking less fresh, not more).
  const isStale = !isValid || ageHours > staleAfterHours;

  const relative = isValid ? formatRelative(cachedDate, now) : "unknown time";
  const absolute = isValid
    ? cachedDate.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "unknown";

  return (
    <span
      title={isValid ? `Cached at ${absolute}` : "Cache timestamp missing or invalid"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        isStale
          ? "border-amber-600/50 bg-amber-500/15 text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300"
          : "border-emerald-600/30 bg-emerald-500/10 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
      } ${className}`}
    >
      <span aria-hidden="true">{isStale ? "⚠" : "✓"}</span>
      <span>
        {isStale ? "Stale — cached " : "Cached "}
        {relative}
      </span>
    </span>
  );
}
