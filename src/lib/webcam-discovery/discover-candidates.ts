import { logger } from "./logger";
import type { CandidateSourceInput } from "./types";

/**
 * T19.1 -- the "go find raw candidate URLs" step of the webcam
 * candidate-discovery workflow.
 *
 * ============================================================================
 * HARD BOUNDARY -- READ THIS BEFORE CHANGING ANYTHING IN THIS FILE
 * ============================================================================
 * THREAT_MODEL.md §9 ("Tasks 17-19 -- Webcam ingestion, vision extraction,
 * automated discovery agent") flags this cluster as carrying "the most
 * legal exposure in the entire backlog," and its own "Before Tasks 17-19
 * start" checklist explicitly gates all three tasks on two items:
 *
 *   - "Legal review of the scraping/redistribution approach for webcam
 *     feeds" -- a founder/legal action that has NOT happened yet.
 *   - "Allowlist/partnership sourcing model in place of indiscriminate
 *     scraping."
 *
 * §9's spec-hardening note is explicit about what that means for exactly
 * this file's job: "Replace 'scheduled scraping worker' with an
 * allowlist/partnership model: only ingest camera feeds from sources with
 * explicit permission ... rather than indiscriminate discovery. If Task
 * 19's discovery agent stays in scope, its output should populate a review
 * queue for human approval, never auto-publish a newly found camera as a
 * trusted source." Indiscriminate, agent-driven discovery at scale
 * "multiplies this exposure across every camera it finds."
 *
 * The founder's explicit, session-scoped decision (this session): T19.1
 * ships as scaffolding only, with no live/autonomous web discovery wired
 * up. Concretely, this module MUST NOT:
 *   - fetch arbitrary URLs to search for camera candidates,
 *   - call a search API (web search, a scraping service, etc.), or
 *   - otherwise autonomously discover URLs from the open web.
 * There is no default implementation here that does any of that, and one
 * must not be added later without the legal-review gate above actually
 * clearing first -- don't quietly wire up a search call here, even behind
 * a feature flag, even "just for local testing."
 *
 * What IS safe and real today: an injectable `CandidateDiscoverer`
 * interface -- the same dependency-injection shape as
 * `src/lib/offline/bundle-verification.ts`'s `SignatureVerifier` and
 * `src/lib/webcam-extraction/rate-cap.ts`'s `TodayCallCounter` -- with a
 * default implementation (`discoverSeedCandidates` below) that does
 * nothing riskier than return a founder-provided, manually-curated list of
 * seed URLs (`SEED_CANDIDATES`, empty by default). The manual-trigger
 * route/page (`src/app/api/webcam-discovery/route.ts`,
 * `src/app/webcam-discovery/`) bypasses even that: an authenticated caller
 * supplies the candidate URLs directly, so this file's stubbed default is
 * never on the critical path for actually exercising the pipeline.
 *
 * What "real" discovery would need before it's safe to build, per §9's
 * spec-hardening note: explicit allowlist-adjacent sourcing only --
 * e.g. polling a municipal open-data feed a city/park service has
 * published for this purpose, or reading from an opted-in dive shop's own
 * submission form -- never a generic web-search or crawling call. Even
 * once the legal-review gate clears, each such source is its own
 * deliberate, reviewed integration (its own file, its own PR), not
 * something that should silently grow inside this module's default.
 * ============================================================================
 */

/**
 * Injectable "go find candidate URLs" step. Same DI shape as
 * `bundle-verification.ts`'s `SignatureVerifier` -- a real, allowlist-
 * adjacent source can be swapped in later without touching call sites
 * (`run-discovery.ts`), but see the header above before ever doing so.
 */
export type CandidateDiscoverer = () => Promise<CandidateSourceInput[]>;

/**
 * Founder-provided seed list. Empty by default. Populating this with real
 * URLs is a deliberate, reviewed content decision for whoever owns the
 * camera allowlist (municipal open-data feeds, opted-in dive shop
 * submissions) -- this scaffolding does not pre-fill it, and nothing in
 * this codebase should populate it automatically.
 */
const SEED_CANDIDATES: CandidateSourceInput[] = [];

/**
 * Default `CandidateDiscoverer`. Does not access the network, does not
 * search, does not crawl -- it returns the founder-curated seed list
 * above, verbatim, or an empty array if nothing has been curated yet. This
 * is the ONLY discovery source this codebase is allowed to run
 * autonomously until the THREAT_MODEL.md §9 legal-review gate clears.
 */
export async function discoverSeedCandidates(): Promise<CandidateSourceInput[]> {
  logger.info("discover.seed-list", { count: SEED_CANDIDATES.length });
  return SEED_CANDIDATES;
}
