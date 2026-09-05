import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { errorMessage } from "@/lib/error-message";
import { researchDiveSitesNear } from "@/lib/site-discovery/area-research";
import { checkRateCap } from "@/lib/site-discovery/rate-cap";
import { logger } from "@/lib/site-discovery/logger";

/**
 * Triggers the map-pan AI-assisted discovery fallback (`plan.md` Resolved
 * Spec Decision #10, 2026-08-11) — only ever called from the UI after
 * Phase 1's free OSM/Overpass search already came up empty at a
 * diver-picked map location. **Signed-in only, 401 otherwise** — unlike
 * `search-nearby`'s soft-skip-to-anonymous, there is no useful anonymous
 * fallback here (an anonymous call could only ever fail the daily cap
 * check anyway, and this is real per-call cost against a free tier, not a
 * public read).
 *
 * `POST /api/sites/research-area`, body `{ latitude, longitude }` — no
 * place-name typing needed from the diver; `area-research.ts` handles
 * reverse geocoding internally.
 *
 * Nothing here writes to `sites`. This route only returns candidates for
 * the diver to review; `POST /api/sites/candidates/add` is the separate,
 * explicit action that persists one.
 */

interface ResearchAreaBody {
  latitude?: unknown;
  longitude?: unknown;
}

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

/** Global count of today's calls, for the daily cap — must see every
 * user's rows, not just the caller's own, so this runs through the
 * service-role client (bypasses `area_research_log`'s "read your own
 * rows" RLS policy), same as `webcam-extraction/run-extraction.ts`'s
 * `countReadingsToday()`. */
async function countAreaResearchCallsToday(): Promise<number> {
  const admin = createAdminClient();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const { count, error } = await admin
    .from("area_research_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startOfToday.toISOString());

  if (error) {
    throw new Error(`Failed to count today's area_research_log rows: ${error.message}`);
  }
  return count ?? 0;
}

export async function POST(request: NextRequest) {
  let body: ResearchAreaBody;
  try {
    body = (await request.json()) as ResearchAreaBody;
  } catch (error) {
    logger.warn("research_area.invalid_json_body", { message: errorMessage(error) });
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const latitude = parseCoordinate(body.latitude, -90, 90);
  const longitude = parseCoordinate(body.longitude, -180, 180);

  if (latitude === null || longitude === null) {
    return NextResponse.json(
      { error: "A valid `latitude` (-90 to 90) and `longitude` (-180 to 180) are required." },
      { status: 400 },
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sign in required to search the web for dive sites." }, { status: 401 });
  }

  const rateCheck = await checkRateCap(countAreaResearchCallsToday);
  if (!rateCheck.allowed) {
    logger.warn("research_area.rate_capped", { userId: user.id, reason: rateCheck.reason, cap: rateCheck.cap });
    return NextResponse.json(
      { error: "The web-search fallback has hit its daily limit — try again tomorrow." },
      { status: 429 },
    );
  }

  const { candidates, error } = await researchDiveSitesNear({ latitude, longitude });

  try {
    await supabase.from("area_research_log").insert({
      requested_by: user.id,
      latitude,
      longitude,
      candidate_count: candidates.length,
    });
  } catch (logError) {
    // Accounting failure shouldn't fail a request that otherwise
    // succeeded — logged for visibility, never surfaced to the diver.
    logger.warn("research_area.log_insert_failed", { message: errorMessage(logError) });
  }

  logger.info("research_area.complete", { userId: user.id, latitude, longitude, candidates: candidates.length, error });
  return NextResponse.json({ candidates, error }, { status: 200 });
}
