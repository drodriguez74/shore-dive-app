import { logger } from "./logger";

/**
 * T18.5 — hard daily call-volume cap on the vision-model worker. This is
 * the enforcement half of the founder-cost-flag documented in `model.ts`:
 * the Anthropic API has no free tier, so this cap is the only thing
 * standing between "a bug/misconfiguration in the cron schedule" and
 * unbounded real spend. It's implemented as a real, checked-before-every-
 * call gate — not just a documented intention — and it fails closed
 * (refuses) on any uncertainty, same philosophy as
 * `src/lib/offline/bundle-verification.ts`'s "a check that can't be
 * performed is not the same as a check that passed."
 *
 * Deliberately small and conservative. `plan.md` Resolved Decision 2:
 * "accept lower quality/coverage over cost risk." A handful of extractions
 * a day is enough to prove the pipeline end-to-end without meaningfully
 * risking real spend even under a misfiring schedule.
 */
export const DAILY_CALL_CAP = 20;

export interface RateCapCheckResult {
  allowed: boolean;
  /** How many calls have already been made today, per the counter. `Infinity` when the count itself couldn't be determined (fail-closed). */
  callsToday: number;
  cap: number;
  reason?: "cap-reached" | "count-unavailable";
}

/** Injectable "how many calls happened today" counter — same dependency-injection shape as `bundle-verification.ts`'s `SignatureVerifier`, so this is testable without a live Supabase project and so the real counter (querying `webcam_readings`) can be swapped in without touching this function. */
export type TodayCallCounter = () => Promise<number>;

/**
 * Resolves the effective daily cap: `WEBCAM_EXTRACTION_DAILY_CALL_CAP` if
 * set to a valid positive integer, otherwise the hardcoded conservative
 * default above. An env override exists so the founder can tune this
 * without a code change once real usage patterns are known — but the
 * fallback is intentionally small, not "unlimited," so a missing/blank env
 * var never accidentally removes the cap.
 */
export function resolveDailyCap(): number {
  const raw = process.env.WEBCAM_EXTRACTION_DAILY_CALL_CAP;
  if (!raw) return DAILY_CALL_CAP;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn("invalid-daily-cap-override", { raw });
    return DAILY_CALL_CAP;
  }
  return parsed;
}

/**
 * The enforced check. Callers (see `run-extraction.ts`) MUST call this
 * before making any vision-API call and must treat `allowed: false` as a
 * hard stop, not a suggestion — no code path in this pipeline should call
 * the vision API without first passing this check.
 *
 * Fails closed: if `countToday()` throws (e.g. the count query itself
 * fails), this returns `allowed: false` rather than proceeding as if zero
 * calls had been made — an unknown count must never be treated as "safely
 * under the cap."
 */
export async function checkRateCap(
  countToday: TodayCallCounter,
  cap: number = resolveDailyCap(),
): Promise<RateCapCheckResult> {
  let callsToday: number;
  try {
    callsToday = await countToday();
  } catch (error) {
    logger.error("rate-cap-count-failed", {
      error: error instanceof Error ? error.message : error,
    });
    return { allowed: false, callsToday: Number.POSITIVE_INFINITY, cap, reason: "count-unavailable" };
  }

  if (callsToday >= cap) {
    logger.warn("rate-cap-reached", { callsToday, cap });
    return { allowed: false, callsToday, cap, reason: "cap-reached" };
  }

  return { allowed: true, callsToday, cap };
}
