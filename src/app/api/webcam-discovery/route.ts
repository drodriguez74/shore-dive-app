import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { runDiscovery } from "@/lib/webcam-discovery/run-discovery";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/webcam-discovery/logger";
import type { CandidateSourceInput } from "@/lib/webcam-discovery/types";

/**
 * T19.1 manual-trigger route for the webcam candidate-discovery workflow.
 *
 * There is no live/autonomous discovery to schedule against (see
 * `src/lib/webcam-discovery/discover-candidates.ts`'s header -- the legal
 * review THREAT_MODEL.md §9 requires hasn't happened yet), so unlike Task
 * 18's cron route (`src/app/api/cron/webcam-extraction/route.ts`), this is
 * POST-only and always requires the caller to supply the candidate URLs
 * directly. It never falls back to autonomously finding its own -- the
 * `candidates` field on the request body is required, not optional.
 *
 * This runs the real extract -> submit pipeline (a real Anthropic API call
 * per candidate, then an authenticated-session insert into
 * `camera_sources`), so it costs real API spend once `ANTHROPIC_API_KEY`
 * is configured. There's no separate `..._ENABLED` feature flag gating
 * that the way `WEBCAM_EXTRACTION_ENABLED` gates Task 18's *scheduled*
 * worker (see `run-extraction.ts`) -- that flag exists specifically
 * because a misfiring cron schedule could otherwise call the API
 * unboundedly. This route only ever runs from an explicit, one-off request
 * a signed-in person made, capped at `MAX_CANDIDATES_PER_REQUEST` per
 * call, so the blast radius is already bounded without a separate switch.
 *
 * Auth: same honest gap as
 * `src/app/api/camera-sources/[id]/review/route.ts` -- the check below is
 * "caller has a valid authenticated Supabase session," not "caller is a
 * trusted discovery operator," because no such role exists in this schema
 * yet. Checked here (fast, before spending any Anthropic API calls) *and*
 * again inside `submitCandidate` (defense in depth, and the actual RLS
 * enforcement point) -- every inserted row is attributed to that same
 * session's user id and forced to `status: 'pending_review'` by
 * `camera_sources_insert_own` (`supabase/migrations/0003_camera_sources.sql`).
 */

const MAX_CANDIDATES_PER_REQUEST = 20;

interface DiscoveryRequestBody {
  candidates?: unknown;
}

function isValidCandidate(value: unknown): value is CandidateSourceInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.url !== "string" || candidate.url.trim().length === 0) return false;
  if (candidate.contextText !== undefined && typeof candidate.contextText !== "string") return false;
  if (candidate.suggestedSiteId !== undefined && typeof candidate.suggestedSiteId !== "string") return false;
  return true;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // --- Auth check: signed-in user required. See the honest-gap comment ---
  // --- above -- this is NOT a "trusted discovery operator" check.       ---
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Sign-in required to run webcam candidate discovery." }, { status: 401 });
    }
  } catch (error) {
    // Includes Supabase not being configured yet (no real project exists
    // -- src/lib/supabase/server.ts throws on missing env vars). Fail
    // closed with a clear message rather than crashing the request.
    logger.error("route.auth_check_failed", { error: errorMessage(error) });
    return NextResponse.json(
      { error: "Could not verify sign-in status. Supabase may not be configured yet." },
      { status: 503 },
    );
  }

  let body: DiscoveryRequestBody;
  try {
    body = (await request.json()) as DiscoveryRequestBody;
  } catch (error) {
    logger.warn("route.invalid_json_body", { error: errorMessage(error) });
    return NextResponse.json({ error: "Request body must be JSON with a `candidates` array." }, { status: 400 });
  }

  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return NextResponse.json({ error: "`candidates` must be a non-empty array." }, { status: 400 });
  }

  if (body.candidates.length > MAX_CANDIDATES_PER_REQUEST) {
    return NextResponse.json(
      { error: `At most ${MAX_CANDIDATES_PER_REQUEST} candidates per request.` },
      { status: 400 },
    );
  }

  const candidates: CandidateSourceInput[] = [];
  for (const raw of body.candidates) {
    if (!isValidCandidate(raw)) {
      return NextResponse.json(
        {
          error:
            "Each candidate needs at least a non-empty `url` string; `contextText` and `suggestedSiteId`, if present, must be strings.",
        },
        { status: 400 },
      );
    }
    candidates.push(raw);
  }

  try {
    const summary = await runDiscovery({ candidates });
    logger.info("route.run_complete", {
      considered: summary.considered,
      inserted: summary.inserted,
      duplicate: summary.duplicate,
      failed: summary.failed,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    // Per-candidate failures are already caught inside runDiscovery() and
    // reported in its summary, not thrown -- only a genuinely unexpected
    // setup failure reaches here.
    logger.error("route.run_threw", { error: errorMessage(error) });
    return NextResponse.json({ ok: false, error: "Discovery run failed unexpectedly." }, { status: 500 });
  }
}
