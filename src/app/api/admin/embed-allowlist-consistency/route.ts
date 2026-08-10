import { NextResponse, type NextRequest } from "next/server";
import { checkApprovedCameraSourcesEmbedAllowlist } from "@/lib/camera-sources/embed-allowlist-consistency";
import { errorMessage } from "@/lib/error-message";
import { logger } from "@/lib/camera-sources/logger";

/**
 * T20.2 follow-up — manual/CI trigger for the `camera_sources` /
 * `EMBED_DOMAIN_ALLOWLIST` consistency check
 * (`src/lib/camera-sources/embed-allowlist-consistency.ts` has the full
 * write-up of the decision this supports: the embed allowlist stays
 * static/hand-curated rather than DB-derived, and this endpoint is the
 * concrete gap-closer instead).
 *
 * Mirrors `src/app/api/cron/webcam-extraction/route.ts`'s shape (GET for a
 * scheduler, POST for a manual/dev trigger, both running the same check,
 * both gated by `CRON_SECRET`) for the same reason that route documents:
 * nothing on the web guarantees background execution, so any
 * automation-shaped check needs a manual path that exercises the exact
 * same logic, not a separate "trust me it works" script.
 *
 * Reuses `CRON_SECRET` rather than introducing a second secret — this is a
 * read-only check with no cost and no write path (unlike the webcam
 * extraction worker, which gates real Anthropic API spend), so the bar for
 * its own dedicated secret is low; gating it at all is about keeping this
 * from being a public "here's the state of our moderation pipeline"
 * probe, not about protecting sensitive data (the `camera_sources` rows it
 * reads are already public via RLS's `camera_sources_select_approved`
 * policy).
 *
 * A drift result (non-empty array) means at least one *approved*
 * `camera_sources` row looks like it would render in the media-embed
 * component's iframe-embed tier but its hostname isn't on
 * `EMBED_DOMAIN_ALLOWLIST` yet. That is flagged here, not auto-fixed —
 * resolving it (add the hostname to the static allowlist, or re-review the
 * camera_sources row) is a deliberate, reviewed, code-level decision, per
 * the risk this check exists to guard against.
 */

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — fail closed, same reasoning as the webcam
    // extraction cron route: an unset secret means "not callable," never
    // "auth is optional."
    return false;
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    logger.warn("embed-allowlist-consistency.unauthorized_trigger_attempt", {
      method: request.method,
      hasAuthHeader: request.headers.has("authorization"),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const drift = await checkApprovedCameraSourcesEmbedAllowlist();
    return NextResponse.json({ ok: true, consistent: drift.length === 0, drift });
  } catch (error) {
    // Covers createAdminClient() throwing (no real Supabase project
    // configured yet) as well as any unexpected Supabase query failure.
    // Every I/O boundary must fail explicitly per CLAUDE.md's Engineering
    // standards, never throw uncaught out of a route handler.
    logger.error("embed-allowlist-consistency.run_threw", {
      error: errorMessage(error),
    });
    return NextResponse.json(
      { ok: false, error: "Consistency check failed. Supabase may not be configured yet." },
      { status: 503 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
