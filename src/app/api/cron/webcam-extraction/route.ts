import { NextResponse, type NextRequest } from "next/server";
import { runWebcamExtraction } from "@/lib/webcam-extraction/run-extraction";
import { logger } from "@/lib/webcam-extraction/logger";

/**
 * T18.2 — scheduled worker entry point for the Visual Telemetry Extraction
 * Pipeline (Task 18). Two supported invocation paths, both running the
 * exact same `runWebcamExtraction()` orchestration:
 *
 *   - `GET` — intended for Vercel Cron. Vercel automatically sends
 *     `Authorization: Bearer $CRON_SECRET` on cron-triggered requests when
 *     `CRON_SECRET` is set as a project env var; that's what
 *     `isAuthorized()` below checks. A `vercel.json` `crons` entry pointing
 *     at this path is deliberately NOT added in this same change — see the
 *     note below.
 *   - `POST` — manual/dev trigger, mirroring the "Prefetch Now" manual-
 *     trigger philosophy already established for offline prefetch (Task 12,
 *     `src/components/prefetch-button.tsx`) for anything best-effort/
 *     non-guaranteed on this platform: a scheduled job on the web has no
 *     guarantee it actually fires, so there should always be a manual path
 *     that exercises the same real logic. Gated by the same `CRON_SECRET`
 *     as `GET` — a manual trigger must not be a way to bypass the
 *     protection that keeps this endpoint from being called by anyone who
 *     finds the URL (every invocation is potential real API spend once
 *     `WEBCAM_EXTRACTION_ENABLED=true`, see `run-extraction.ts`).
 *
 * IDEMPOTENT / SAFE AT LOW FREQUENCY BY DESIGN: Vercel's free Hobby tier
 * historically limits cron job frequency (as few as one invocation per day
 * per job) and the total number of cron jobs per project — don't assume
 * finer-than-daily scheduling is available without checking the current
 * plan limits first. This worker is written so that's fine: T18.5's rate
 * cap (`rate-cap.ts`) is a *daily* budget tracked by counting today's
 * `webcam_readings` rows, not a per-invocation budget, so calling this
 * once a day is the expected steady state, not a degraded fallback. Calling
 * it more than once in the same day is also safe — the cap simply means
 * later calls that day extract fewer (or zero) cameras once the budget is
 * spent, never more than the daily cap total.
 *
 * WHY `vercel.json`'s `crons` array isn't added yet: wiring up a real
 * schedule presumes both (a) `model.ts`'s founder-cost decision has been
 * confirmed (turning `WEBCAM_EXTRACTION_ENABLED` on is a deliberate choice,
 * not something a merged cron config should do on its own), and (b) live
 * Supabase + Anthropic credentials actually exist. Neither is true yet.
 * This route exists and is safe to call manually today (it no-ops whenever
 * `WEBCAM_EXTRACTION_ENABLED` isn't `"true"` — see `run-extraction.ts`),
 * but nothing schedules it. Add the `vercel.json` entry once both
 * conditions are met.
 */

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — fail closed. An unset CRON_SECRET must mean
    // "this endpoint is not callable," never "auth is optional," since a
    // successful call can trigger real Anthropic API spend.
    return false;
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    logger.warn("unauthorized-trigger-attempt", {
      method: request.method,
      hasAuthHeader: request.headers.has("authorization"),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runWebcamExtraction();
    logger.info("run-complete", { ...summary });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    // Setup-level failures only reach here (e.g. missing Supabase env
    // vars) — per-camera extraction failures are already caught inside
    // runWebcamExtraction() and reported in its summary, not thrown.
    logger.error("run-threw", { error: error instanceof Error ? error.message : error });
    return NextResponse.json({ ok: false, error: "Extraction run failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
