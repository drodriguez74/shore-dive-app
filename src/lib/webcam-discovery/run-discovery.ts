import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";
import { discoverSeedCandidates, type CandidateDiscoverer } from "./discover-candidates";
import { extractCandidate } from "./extract-candidate";
import { submitCandidate, type SubmitCandidateDeps } from "./submit-candidate";
import type { CandidateSourceInput, CandidateSubmissionResult } from "./types";

/**
 * T19.1 orchestration: discover -> extract -> submit, per-candidate
 * try/catch so one bad candidate never aborts the whole batch. Mirrors
 * `webcam-extraction/run-extraction.ts`'s per-camera failure-isolation
 * shape from Task 18.
 *
 * `discover` defaults to `discoverSeedCandidates` -- see
 * `discover-candidates.ts`'s header for exactly why that's the only
 * discovery source allowed to run autonomously right now (empty by
 * default, no live web access). In practice the manual-trigger route
 * (`src/app/api/webcam-discovery/route.ts`) always passes `candidates`
 * explicitly instead, since a signed-in caller supplying their own URLs is
 * how this pipeline gets exercised today -- the stubbed discovery step is
 * there for completeness and future real (allowlist-adjacent) sources, not
 * because anything currently depends on it doing real work.
 */

export interface DiscoveryRunSummary {
  considered: number;
  inserted: number;
  duplicate: number;
  failed: number;
  results: CandidateSubmissionResult[];
}

export interface RunDiscoveryOptions {
  /** Overrides the discovery step. Defaults to `discoverSeedCandidates`. Ignored when `candidates` is supplied. */
  discover?: CandidateDiscoverer;
  /** A pre-supplied candidate list. When given, the `discover` step is skipped entirely -- this is what the manual-trigger route uses so an authenticated caller's submitted URLs never depend on the stubbed default. */
  candidates?: CandidateSourceInput[];
  /** Passed through to `submitCandidate` for each candidate (e.g. to inject a test Supabase client). */
  submitDeps?: SubmitCandidateDeps;
}

/**
 * Runs one discovery pass. Never throws for a single candidate's failure
 * (extraction error, submission error) -- each is caught, logged, and
 * reflected in the returned summary/`results` so a caller (a route
 * handler) can always respond successfully with a status body, exactly
 * like `runWebcamExtraction`'s contract for Task 18. It CAN throw if the
 * discovery step itself throws (e.g. a future real discoverer failing) --
 * that's caught here too and reported as a zero-candidate run rather than
 * propagated, since a discovery-source failure isn't really an "any
 * candidate failed" situation.
 */
export async function runDiscovery(options: RunDiscoveryOptions = {}): Promise<DiscoveryRunSummary> {
  const discover = options.discover ?? discoverSeedCandidates;

  let candidates: CandidateSourceInput[];
  try {
    candidates = options.candidates ?? (await discover());
  } catch (error) {
    logger.error("run.discover_failed", { error: errorMessage(error) });
    return { considered: 0, inserted: 0, duplicate: 0, failed: 0, results: [] };
  }

  const results: CandidateSubmissionResult[] = [];
  let inserted = 0;
  let duplicate = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const extracted = await extractCandidate(candidate);
      const result = await submitCandidate(candidate, extracted, options.submitDeps);
      results.push(result);
      if (result.status === "inserted") inserted += 1;
      else if (result.status === "duplicate") duplicate += 1;
      else failed += 1;
      logger.info("run.candidate_processed", { url: candidate.url, status: result.status });
    } catch (error) {
      failed += 1;
      const message = errorMessage(error);
      logger.error("run.candidate_failed", { url: candidate.url, error: message });
      results.push({ status: "failed", input: candidate, error: message });
    }
  }

  return { considered: candidates.length, inserted, duplicate, failed, results };
}
