import { isPastPlannedDate } from "./format";
import type { DivePlanWithSite } from "./queries";
import type { PretripPlanEntry } from "@/components/pretrip-checklist";

/**
 * Converts real, upcoming, site-attached plans into `PretripChecklist`'s
 * input shape — the real wiring `pretrip-checklist.tsx`'s own header
 * comment named as a genuinely separate follow-up ("a cross-site 'your
 * whole plan' view... a real, separate follow-up"), closed 2026-08-13 once
 * `/dive-plans` existed to be that view. Only that page mounts
 * `PretripChecklist` now — it no longer renders (always empty) on the
 * single-site detail page.
 *
 * Extracted out of `src/app/dive-plans/page.tsx` rather than defined there:
 * Next.js App Router's generated route types only allow a page module to
 * export specific recognized symbols (`default`, `dynamic`,
 * `generateStaticParams`, etc.) — an arbitrary named export like this one
 * fails `tsc` against `.next/types/app/dive-plans/page.ts` with "Property
 * ... is incompatible with index signature." Same reason every other
 * testable pure function in this codebase already lives in `src/lib/`
 * rather than a page/route file.
 *
 * Past-dated plans are excluded (nothing left to prefetch *before* a dive
 * that's already happened) and plans with no attached site are excluded
 * (`PrefetchButton` needs a real `siteId`). Deduplicated by site — two
 * plans for the same site would otherwise show two identical prefetch
 * rows — keeping whichever occurrence is soonest, since `plans` is already
 * ordered by `planned_date` ascending.
 *
 * `now` is injectable (defaults to the real current time) so tests can pin
 * a fixed date rather than depending on the real system clock via
 * `isPastPlannedDate`'s own default — the same dependency-injection shape
 * `webcam-extraction/rate-cap.ts`'s `TodayCallCounter` already established
 * for "what counts as now" logic elsewhere in this codebase.
 */
export function upcomingPretripEntries(plans: DivePlanWithSite[], now: Date = new Date()): PretripPlanEntry[] {
  const seenSiteIds = new Set<string>();
  const entries: PretripPlanEntry[] = [];

  for (const plan of plans) {
    if (!plan.site || isPastPlannedDate(plan.planned_date, now)) continue;
    if (seenSiteIds.has(plan.site.id)) continue;
    seenSiteIds.add(plan.site.id);
    entries.push({ id: plan.site.id, name: plan.site.name, diveDate: plan.planned_date });
  }

  return entries;
}
