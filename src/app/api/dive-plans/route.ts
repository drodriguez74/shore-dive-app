import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/sites/logger";

/**
 * Create a `dive_plans` row (Task 11.5 / plan.md v5 Resolved Decision 5).
 * The single "add this site to a new plan" action the site detail page
 * exposes — not a full dive-plan-editing UI (out of scope per the task
 * brief).
 *
 * `user_id` is always taken from the authenticated session, never the
 * request body — this table's RLS (`supabase/migrations/0007_dive_plans.sql`)
 * requires `auth.uid() = user_id` on insert, so a spoofed `user_id` in the
 * body would just fail the RLS check, but not trusting client input for an
 * identity field is the correct default regardless of what RLS would catch.
 *
 * Follows the same NextRequest/NextResponse + try/catch + structured-logger
 * shape as `src/app/api/camera-sources/[id]/review/route.ts` (the
 * established convention for a mutating API route in this codebase) rather
 * than a Server Action, since that's the pattern already in use here.
 */

interface CreateDivePlanBody {
  site_id?: unknown;
  planned_date?: unknown;
  planned_window?: unknown;
  diving_with?: unknown;
}

function optionalTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

export async function POST(request: NextRequest) {
  let body: CreateDivePlanBody;
  try {
    body = (await request.json()) as CreateDivePlanBody;
  } catch (error) {
    logger.warn("dive_plans.invalid_json_body", {
      error: errorMessage(error),
    });
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const siteId = typeof body.site_id === "string" && body.site_id.length > 0 ? body.site_id : null;
  const plannedDate = typeof body.planned_date === "string" ? body.planned_date : "";
  const plannedWindow = optionalTrimmedString(body.planned_window, 60);
  const divingWith = optionalTrimmedString(body.diving_with, 120);

  if (!plannedDate || Number.isNaN(new Date(plannedDate).getTime())) {
    return NextResponse.json({ error: "A valid planned date is required." }, { status: 400 });
  }

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Sign in required to create a dive plan." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("dive_plans")
      .insert({
        user_id: user.id,
        site_id: siteId,
        planned_date: plannedDate,
        planned_window: plannedWindow,
        diving_with: divingWith,
        status: "planned",
      })
      .select("id")
      .single();

    if (error) throw error;

    logger.info("dive_plans.created", { userId: user.id, siteId, planId: data?.id });
    return NextResponse.json({ id: data?.id }, { status: 201 });
  } catch (error) {
    logger.error("dive_plans.create_failed", {
      siteId,
      error: errorMessage(error),
    });
    return NextResponse.json({ error: "Couldn't create the dive plan — try again." }, { status: 500 });
  }
}
