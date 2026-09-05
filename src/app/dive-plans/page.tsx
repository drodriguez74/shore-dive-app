import Link from "next/link";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import { listDivePlansForUser, type DivePlanWithSite } from "@/lib/dive-plans/queries";
import { formatPlannedDate, isPastPlannedDate } from "@/lib/dive-plans/format";
import { upcomingPretripEntries } from "@/lib/dive-plans/pretrip-entries";
import { PretripChecklist } from "@/components/pretrip-checklist";

/**
 * "My dive plans" (2026-08-13, closing a gap found in that day's UX audit):
 * `AddToDivePlanForm` on the site detail page has always been able to
 * CREATE a `dive_plans` row — there was never a page anywhere in the app
 * that could show one back to the diver who made it. Read-only for now
 * (view, not manage) — matches the audit's own scoping of this as "the
 * missing other half of an already-built feature," not a new
 * plan-editing surface.
 *
 * Same "signed-in required, gated on auth not a real role, NoticeCard-style
 * prompt rather than a hard redirect" shape
 * `src/app/moderation/camera-sources/page.tsx` already established —
 * consistent with that page rather than inventing a second convention.
 */

export const dynamic = "force-dynamic";

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-depth-0">
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Shore Dive
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          My dive plans
        </h1>
        {children}
      </main>
    </div>
  );
}

function NoticeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-depth-border dark:bg-depth-1 dark:text-zinc-400">
      <p className="mb-1 font-medium text-black dark:text-zinc-50">{title}</p>
      {children}
    </div>
  );
}

export default async function DivePlansPage() {
  let userId: string | null = null;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch (error) {
    logger.error("dive_plans_page.auth_check_failed", { error: errorMessage(error) });
    return (
      <PageShell>
        <NoticeCard title="Could not check sign-in status">
          <p>Something went wrong verifying your session. Try reloading, or sign in again.</p>
        </NoticeCard>
      </PageShell>
    );
  }

  if (!userId) {
    return (
      <PageShell>
        <NoticeCard title="Sign-in required">
          <p>Dive plans are private to your account — sign in to see yours.</p>
          <Link
            href="/login"
            className="mt-3 inline-block rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            Sign in
          </Link>
        </NoticeCard>
      </PageShell>
    );
  }

  const { plans, error: loadError } = await listDivePlansForUser(userId);

  return (
    <PageShell>
      {loadError && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Couldn&apos;t load your dive plans ({loadError}). Try reloading.
        </p>
      )}

      {!loadError && plans.length === 0 && (
        <NoticeCard title="No dive plans yet">
          <p>
            Open a site&apos;s page and use &quot;Add to dive plan&quot; — it&apos;ll show up here once you
            have one.
          </p>
        </NoticeCard>
      )}

      <PretripChecklist plan={upcomingPretripEntries(plans)} />

      <ul className="flex flex-col gap-3">
        {plans.map((plan) => (
          <DivePlanCard key={plan.id} plan={plan} />
        ))}
      </ul>
    </PageShell>
  );
}

function DivePlanCard({ plan }: { plan: DivePlanWithSite }) {
  const past = isPastPlannedDate(plan.planned_date);
  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {plan.site ? (
            <Link
              href={`/sites/${plan.site.id}`}
              className="text-sm font-semibold text-black hover:underline dark:text-zinc-50"
            >
              {plan.site.name}
            </Link>
          ) : (
            <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">No site attached</span>
          )}
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            {formatPlannedDate(plan.planned_date)}
            {plan.planned_window ? ` · ${plan.planned_window}` : ""}
          </p>
          {plan.diving_with && (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">Diving with {plan.diving_with}</p>
          )}
        </div>
        {past && (
          <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:border-depth-border dark:bg-depth-2 dark:text-zinc-400">
            Past
          </span>
        )}
      </div>
    </li>
  );
}
