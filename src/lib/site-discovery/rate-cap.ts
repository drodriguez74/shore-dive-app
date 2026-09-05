import { logger } from "./logger";

/**
 * Hard daily call-volume cap on the map-pan AI-assisted discovery fallback
 * (`plan.md` Resolved Spec Decision #10). Both Brave Search and Gemini have
 * genuine free tiers, but each has its own real ceiling. Same "real,
 * checked-before-every-call gate, fails closed on any uncertainty" shape
 * as `webcam-extraction/rate-cap.ts` — deliberately not a second,
 * differently-structured pattern.
 *
 * **Recalibrated 2026-08-11 after switching Gemini models mid-session —
 * read this before changing the number again.** One `researchDiveSitesNear()`
 * call is: up to 8 Brave searches (2 initial general+shore-diving queries,
 * plus up to `COORDINATE_ENRICHMENT_LIMIT` = 6 per-candidate coordinate
 * follow-ups — well inside Brave's 2,000/month free tier even at this
 * cap's ceiling) and up to 2 Gemini calls (`extractCandidateSites` always,
 * one batched `extractCoordinates` call if any candidate needs one — never
 * one Gemini call per candidate). The model originally used
 * (`gemini-flash-latest`, resolving to `gemini-3.6-flash`) turned out to
 * have a hard **20 requests/day** free-tier ceiling — measured live,
 * exhausted by this feature's own same-day testing — which briefly forced
 * this cap down to 8 for zero-margin safety. **Since switched to a pinned
 * `gemini-3.1-flash-lite`** (this app's own `gemini-client.ts`), confirmed
 * live/reachable with its own separate quota bucket and, per third-party
 * aggregated reporting (Google's exact current numbers are account-tier-
 * gated, not published), a free-tier ceiling in the 1,000-1,500/day range
 * — Gemini is no longer the binding constraint. Raised back up to 15,
 * calibrated against Brave's real monthly cap instead (up to 8 Brave
 * calls × 15 invocations = 120/day peak, comfortably below a sustainable
 * ~66/day average against the 2,000/month figure, for a fallback feature
 * that isn't used every single day). Tune via the env var below once real
 * usage patterns are known — this is still a judgment call, not a
 * measured ceiling the way the Gemini number above was.
 */
export const DAILY_CALL_CAP = 15;

export interface RateCapCheckResult {
  allowed: boolean;
  /** How many calls have already been made today, per the counter.
   * `Infinity` when the count itself couldn't be determined (fail-closed). */
  callsToday: number;
  cap: number;
  reason?: "cap-reached" | "count-unavailable";
}

/** Injectable "how many calls happened today" counter — same
 * dependency-injection shape as `webcam-extraction/rate-cap.ts`'s
 * `TodayCallCounter`, so this is testable without a live Supabase project
 * and so the real counter (querying `area_research_log`) can be swapped in
 * without touching this function. */
export type TodayCallCounter = () => Promise<number>;

/**
 * Resolves the effective daily cap: `AREA_RESEARCH_DAILY_CALL_CAP` if set
 * to a valid positive integer, otherwise the hardcoded conservative
 * default above. An env override exists so the founder can tune this once
 * real usage patterns are known — but the fallback is intentionally small,
 * not "unlimited," so a missing/blank env var never accidentally removes
 * the cap.
 */
export function resolveDailyCap(): number {
  const raw = process.env.AREA_RESEARCH_DAILY_CALL_CAP;
  if (!raw) return DAILY_CALL_CAP;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn("invalid-daily-cap-override", { raw });
    return DAILY_CALL_CAP;
  }
  return parsed;
}

/**
 * The enforced check. Callers (`POST /api/sites/research-area`) MUST call
 * this before invoking `researchDiveSitesNear()` and must treat
 * `allowed: false` as a hard stop, not a suggestion.
 *
 * Fails closed: if `countToday()` throws (e.g. the count query itself
 * fails), this returns `allowed: false` rather than proceeding as if zero
 * calls had been made.
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
