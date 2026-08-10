import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCameraSourceDecision, type CameraSource } from "@/lib/camera-sources/types";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/camera-sources/logger";

/**
 * Approve/reject a `camera_sources` candidate (T19.3), promoting it into (or
 * declining it from) the webcam allowlist described in `plan.md`'s Phase 3
 * sourcing model and enforced by `supabase/migrations/0003_camera_sources.sql`.
 *
 * ## Honest security gap — read before trusting this route
 *
 * `0003_camera_sources.sql` deliberately ships with NO RLS UPDATE policy for
 * authenticated users: flipping `status` + stamping `reviewed_at`/
 * `reviewed_by` requires the Supabase **service-role key**, because **no
 * moderator/admin role exists anywhere in this schema yet** (same documented
 * gap `0002_rls.sql` flags for promoting `sites`/`hazard_reports`/`lds_status`
 * from `COMMUNITY` to `VERIFIED` — see `supabase/README.md` items 6 and the
 * "self-service writes are capped at COMMUNITY" section).
 *
 * This route uses `src/lib/supabase/admin.ts` (the service-role client) to
 * perform that update, and gates access on the caller having a **valid
 * authenticated Supabase session** — i.e. anyone who is signed in with
 * Google, not specifically a moderator. That is the ONLY check this route
 * can honestly perform right now, because there is no role/permission
 * column anywhere (`profiles` has no `role` field, no `moderators` table
 * exists) to check against. **This is not "secured to moderators only" —
 * it's "secured to signed-in users only."** Any authenticated user who
 * discovers this endpoint can approve or reject a camera source today.
 *
 * Do not treat this as fixed. The real fix (flagged in `supabase/README.md`
 * item 6 and `TASKS.md`'s T19.2 note) is to add a moderator role once one is
 * modeled, and check it here — that's out of scope for T19.2/T19.3 per the
 * task brief, which explicitly says not to invent a fake role system. This
 * comment exists so nobody mistakes "requires sign-in" for "requires
 * moderator privilege" later.
 */

interface ReviewRequestBody {
  decision?: unknown;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  let id: string;
  try {
    ({ id } = await context.params);
  } catch (error) {
    logger.error("review.params_read_failed", {
      error: errorMessage(error),
    });
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!id) {
    return NextResponse.json({ error: "Missing camera source id." }, { status: 400 });
  }

  let body: ReviewRequestBody;
  try {
    body = (await request.json()) as ReviewRequestBody;
  } catch (error) {
    logger.warn("review.invalid_json_body", {
      id,
      error: errorMessage(error),
    });
    return NextResponse.json({ error: "Request body must be JSON with a `decision` field." }, { status: 400 });
  }

  if (!isCameraSourceDecision(body.decision)) {
    return NextResponse.json(
      { error: "`decision` must be either \"approved\" or \"rejected\"." },
      { status: 400 },
    );
  }
  const decision = body.decision;

  // --- Auth check: signed-in user required. See the honest-gap comment ---
  // --- above — this is NOT a moderator check, no such role exists yet. ---
  let reviewerId: string;
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Sign-in required to review camera sources." }, { status: 401 });
    }
    reviewerId = user.id;
  } catch (error) {
    // Includes the case where Supabase isn't configured yet (no real
    // project exists — src/lib/supabase/server.ts throws on missing env
    // vars). Fail closed with a clear message rather than crashing the
    // request or, worse, silently proceeding without an authenticated
    // reviewer.
    logger.error("review.auth_check_failed", {
      id,
      error: errorMessage(error),
    });
    return NextResponse.json(
      { error: "Could not verify sign-in status. Supabase may not be configured yet." },
      { status: 503 },
    );
  }

  // --- Perform the update with the service-role client (bypasses RLS by ---
  // --- design — see the module-level comment on src/lib/supabase/admin.ts). ---
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("camera_sources")
      .update({
        status: decision,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewerId,
      })
      // Only ever act on a still-pending row — guards against double-review
      // races (two reviewers acting on the same candidate) and against
      // silently "re-reviewing" an already-decided row. If nothing matches,
      // `data` comes back empty and we report that below rather than
      // pretending the update happened.
      .eq("id", id)
      .eq("status", "pending_review")
      .select()
      .maybeSingle<CameraSource>();

    if (error) {
      logger.error("review.update_failed", {
        id,
        decision,
        reviewerId,
        message: error.message,
        code: error.code,
      });
      return NextResponse.json({ error: "Failed to update camera source." }, { status: 500 });
    }

    if (!data) {
      logger.warn("review.no_pending_row_matched", { id, decision, reviewerId });
      return NextResponse.json(
        { error: "Camera source not found, or it was already reviewed by someone else." },
        { status: 409 },
      );
    }

    logger.info("review.decided", { id, decision, reviewerId });
    return NextResponse.json({ cameraSource: data }, { status: 200 });
  } catch (error) {
    // Covers createAdminClient() throwing (service-role key/env vars not
    // configured — no real Supabase project exists yet) as well as any
    // unexpected network failure talking to Supabase. Every I/O boundary
    // must fail explicitly per CLAUDE.md, never throw uncaught out of a
    // route handler.
    logger.error("review.unexpected_error", {
      id,
      decision,
      error: errorMessage(error),
    });
    return NextResponse.json(
      { error: "Unexpected error reviewing camera source. Supabase may not be configured yet." },
      { status: 503 },
    );
  }
}
