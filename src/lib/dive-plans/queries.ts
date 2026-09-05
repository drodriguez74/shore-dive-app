import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";
import type { SiteType } from "@/lib/sites/types";

/**
 * Read side of `dive_plans` (`0007_dive_plans.sql`) — found missing
 * 2026-08-13's UX audit: the site detail page's `AddToDivePlanForm`
 * (`src/app/api/dive-plans/route.ts`) has always been able to CREATE a
 * plan, but until this file, there was no page anywhere in the app that
 * could ever show one back to the diver who made it. Same
 * `@/lib/sites/logger` the existing route already uses, for consistency
 * within this one small feature rather than introducing a second logger
 * for it.
 */

export type DivePlanStatus = "planned" | "active" | "completed";

export interface DivePlanSite {
  id: string;
  name: string;
  site_type: SiteType;
}

export interface DivePlanWithSite {
  id: string;
  /** `null` for the rare plan not tied to a documented site — see
   * `0007_dive_plans.sql`'s header comment on why `site_id` is nullable. */
  site: DivePlanSite | null;
  planned_date: string;
  planned_window: string | null;
  diving_with: string | null;
  status: DivePlanStatus;
  created_at: string;
}

export interface ListDivePlansResult {
  plans: DivePlanWithSite[];
  error: string | null;
}

interface RawDivePlanRow {
  id: string;
  planned_date: string;
  planned_window: string | null;
  diving_with: string | null;
  status: DivePlanStatus;
  created_at: string;
  sites: DivePlanSite | null;
}

/**
 * Lists a signed-in user's own dive plans, soonest-planned-date first, each
 * with its site's name/type embedded (one query, via the `site_id` foreign
 * key — not a second round-trip per plan). RLS (`dive_plans_select_own`)
 * already restricts this to the caller's own rows regardless of what
 * `userId` is passed, but the explicit `.eq()` keeps the query's own intent
 * legible without relying on RLS alone to explain it.
 *
 * Never throws — degrades to `{ plans: [], error: <message> }` on any
 * failure, same "fail closed to an empty, honestly-erroring list, not a
 * crash" shape every other query in this codebase already follows.
 */
export async function listDivePlansForUser(userId: string): Promise<ListDivePlansResult> {
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("dive_plans")
      .select("id, planned_date, planned_window, diving_with, status, created_at, sites(id, name, site_type)")
      .eq("user_id", userId)
      .order("planned_date", { ascending: true })
      .returns<RawDivePlanRow[]>();

    if (error) throw error;

    const plans: DivePlanWithSite[] = (data ?? []).map((row) => ({
      id: row.id,
      site: row.sites,
      planned_date: row.planned_date,
      planned_window: row.planned_window,
      diving_with: row.diving_with,
      status: row.status,
      created_at: row.created_at,
    }));

    return { plans, error: null };
  } catch (error) {
    const message = errorMessage(error);
    logger.error("dive_plans.list_failed", { userId, message });
    return { plans: [], error: message };
  }
}
