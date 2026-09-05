/**
 * Pure formatting helpers for `dive_plans.planned_date`, extracted from
 * `src/app/dive-plans/page.tsx` so the timezone-correctness logic below is
 * unit-testable without rendering the page.
 *
 * `planned_date` is a Postgres `date` column — PostgREST returns it as a
 * bare "YYYY-MM-DD" string with no time/zone component. `new Date(str)`
 * parses that as UTC midnight, which `toLocaleDateString` then renders in
 * the *local* zone — for anyone west of UTC that silently displays the day
 * BEFORE the one actually planned. Both helpers below parse the string as
 * explicit local year/month/day components instead (the `Date` constructor
 * treats numeric arguments as local time), avoiding that shift entirely.
 */

function parseLocalDate(isoDate: string): Date | null {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatPlannedDate(isoDate: string): string {
  const date = parseLocalDate(isoDate);
  if (!date) return isoDate;
  return date.toLocaleDateString(undefined, { dateStyle: "long" });
}

/** Whether `isoDate` is strictly before today, in the caller's local
 * timezone — used to badge a plan as "Past" rather than delete/hide it
 * (a dive plan is a record of intent, not a task that disappears once its
 * date has passed). */
export function isPastPlannedDate(isoDate: string, now: Date = new Date()): boolean {
  const date = parseLocalDate(isoDate);
  if (!date) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return date < today;
}
