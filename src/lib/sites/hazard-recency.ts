/**
 * Hazard-report age classification (plan.md's Task 13 v5 addition / the
 * Map-Driven Exploration pillar's own gap note: "a 3-week-old minor report
 * and a 2-hour-old dangerous one render identically"). This is the third
 * place this codebase applies a freshness/staleness treatment to a
 * timestamp — `src/components/freshness-badge.tsx` (offline-cache
 * freshness) and `src/components/lds/last-verified-badge.tsx` (LDS
 * open/closed status) already established the pattern this follows: a real
 * timestamp, never a bare binary badge, that recedes in trust the older it
 * gets.
 *
 * **Why three tiers, not the existing two.** Both precedents are a single
 * fresh/stale boolean (`staleAfterHours`), which fits their use case: cache
 * freshness and fill-station status are both "is this still probably true"
 * questions with one meaningful cutoff. A hazard report is different — the
 * question a diver actually has isn't binary. A report from this morning is
 * clearly still live. A report from three weeks ago is clearly no longer a
 * live warning, but it isn't nothing either: it's still useful history
 * ("something has happened here before"). A single threshold would force
 * either the 3-week-old report to keep the same visual weight as a 2-hour-
 * old one (the exact failure plan.md names), or a too-aggressive cutoff that
 * discards real, still-relevant history early. Three tiers is the minimum
 * that lets "still an active warning" and "worth knowing, not still acute"
 * be told apart, matching plan.md's own suggested default:
 *
 * - **fresh** (<7 days): recent enough to weight as a live, current
 *   condition — a diver planning this week should read it as "this could
 *   still be true right now."
 * - **aging** (7–30 days): no longer assumed current, but still recent
 *   enough to be worth a diver's attention as likely-relevant history.
 * - **stale** (>30 days): old enough that conditions have very likely
 *   changed (surge, visibility, marine-life sightings — none of this
 *   codebase's hazard categories are the kind of thing that reliably holds
 *   for a month). Still shown (removing it would erase real history a diver
 *   might still want), but should recede rather than carry a fresh report's
 *   full visual weight — CLAUDE.md's "never let a UI imply a guarantee the
 *   system can't back" applies here in the other direction: an old report
 *   rendered exactly like a new one implies more certainty about *current*
 *   conditions than the data supports.
 *
 * `now` is injectable (defaults to the real clock) — the same
 * dependency-injection shape `src/lib/dive-plans/pretrip-entries.ts`'s
 * `upcomingPretripEntries` and `webcam-extraction/rate-cap.ts`'s
 * `TodayCallCounter` already establish for any time-dependent pure function
 * in this codebase, so this is testable against a fixed date rather than the
 * real system clock.
 */

export type HazardReportRecency = "fresh" | "aging" | "stale";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Below this age (days), a report reads as a live, current condition. */
export const HAZARD_RECENCY_FRESH_DAYS = 7;
/** Below this age (days), a report is "aging" rather than "stale" — see the
 * module header for the reasoning behind the two cutoffs. */
export const HAZARD_RECENCY_STALE_DAYS = 30;

/**
 * Classifies how old a hazard report is, in the three tiers above.
 *
 * A missing/invalid `reportedAt` is treated as `"stale"` — the most
 * cautious, least-trusted tier — rather than defaulting to `"fresh"`. This
 * mirrors `FreshnessBadge`'s own explicit rule ("an invalid/missing
 * cachedAt is treated as stale, not fresh — never let a data problem
 * silently read as up to date") and THREAT_MODEL.md §2's "fail toward
 * looking less fresh, not more" direction: a malformed timestamp must never
 * cause a hazard report to render with a fresh report's full visual weight.
 *
 * A `reportedAt` in the future (clock skew, or a bad write) is not
 * specially rejected — it simply produces a negative age, which lands in
 * `"fresh"` the same way `FreshnessBadge`'s own age computation does for the
 * analogous case. That's a deliberate non-decision, not an oversight: this
 * codebase's precedent doesn't guard against it either, and a few minutes of
 * clock skew reading as "fresh" is a far smaller honesty problem than a
 * report silently reading as fresher than it is because of a parsing bug.
 */
export function hazardReportRecency(reportedAt: string | Date, now: Date = new Date()): HazardReportRecency {
  const reportedDate = reportedAt instanceof Date ? reportedAt : new Date(reportedAt);
  const ageMs = now.getTime() - reportedDate.getTime();

  if (!Number.isFinite(ageMs)) return "stale";

  const ageDays = ageMs / DAY_MS;
  if (ageDays < HAZARD_RECENCY_FRESH_DAYS) return "fresh";
  if (ageDays < HAZARD_RECENCY_STALE_DAYS) return "aging";
  return "stale";
}
