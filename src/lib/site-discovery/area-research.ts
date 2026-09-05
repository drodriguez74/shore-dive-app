import { errorMessage } from "@/lib/error-message";
import { placeNameNear, type LatLng } from "./reverse-geocode";
import { braveSearch } from "./brave-search";
import {
  extractCandidateSites,
  extractCoordinates,
  type CoordinateFollowUp,
  type ExtractedCandidateSite,
} from "./gemini-client";
import { fetchReadableText } from "./page-fetch";
import { distanceMiles } from "@/lib/sites/distance";
import { logger } from "./logger";

/**
 * Orchestrates the map-pan AI-assisted discovery fallback (`plan.md`
 * Resolved Spec Decision #10, 2026-08-11) — only ever called after Phase
 * 1's free OSM/Overpass search already came up empty at `manualCenter`
 * (see `DiveSiteExplorer`). Reverse-geocodes the point to a place name
 * (Mapbox, already provisioned), runs TWO Brave searches (general + a
 * dedicated shore-diving query — added 2026-08-11 after this app's whole
 * shore-diving premise turned out to get crowded out by generic
 * boat/wreck-heavy "top dive sites" round-ups), and has Gemini extract
 * structured candidates from the combined, deduped results. Nothing here
 * writes to `sites` — this is a pure research call; the caller (`POST
 * /api/sites/research-area`) is responsible for logging it against the
 * daily cap, and a separate explicit action (`POST
 * /api/sites/candidates/add`) is what actually persists a chosen candidate.
 */

export type CandidateSite = ExtractedCandidateSite;

/** Caps how many candidates get a follow-up per-site Brave search — the
 * general search can return more candidates than are worth spending extra
 * Brave/Gemini calls chasing coordinates for in one invocation. Small and
 * conservative on purpose, same "cheap default, tune later against real
 * usage" reasoning `rate-cap.ts`'s own cap uses. */
const COORDINATE_ENRICHMENT_LIMIT = 6;

/** How many of the initial general-search results get their full page
 * fetched (in parallel) for the discovery pass itself — kept small since
 * each fetch costs real latency (up to `page-fetch.ts`'s 8s timeout) even
 * run in parallel, and the top few results are the most likely to be the
 * substantive "top dive sites" round-up articles rather than a dive
 * shop's homepage or an unrelated result. */
const INITIAL_PAGE_FETCH_COUNT = 4;

/** How many of EACH candidate's coordinate-follow-up search results get
 * their page fetched, in parallel — widened from 1 to 3 (2026-08-11) after
 * live testing showed the #1 result alone was blocked/timed out often
 * enough (real bot-detection on the specialized directories most likely
 * to have a coordinate) to leave every candidate coordinate-less on some
 * runs. Kept smaller than `INITIAL_PAGE_FETCH_COUNT` since this multiplies
 * by up to `COORDINATE_ENRICHMENT_LIMIT` candidates — real latency cost. */
const COORDINATE_PAGE_FETCH_COUNT = 3;

/** Brave Search's free tier throttles to roughly 1 request/second —
 * confirmed live 2026-08-11: firing the per-candidate follow-up searches
 * back-to-back with no delay drew a 429 on most of them. A fixed pause
 * between each keeps this comfortably under that, at the cost of the
 * enrichment pass taking a few seconds longer for a diver who's already
 * waiting on the slower of the two tiers. */
const BRAVE_THROTTLE_MS = 1100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic sanity ceiling on any coordinate this pipeline produces —
 * found live 2026-08-11: a coordinate-follow-up search for "Venice Beach"
 * (a real Florida shark-tooth diving spot the initial pass correctly
 * named and described) pulled in results dominated by the far more
 * globally-indexed **Venice Beach, California**, and the coordinate-lookup
 * Gemini call returned its coordinates — 2,500+ miles away — without
 * noticing the mismatch. Prompt wording alone can't be trusted to catch
 * this reliably (it's exactly the kind of confident-sounding error an LLM
 * can make), so this is a cheap, independent, deterministic backstop: any
 * candidate coordinate further than this from the actual searched point
 * gets nulled out (not the candidate dropped — the name/summary/citations
 * may still be entirely real and worth showing, same "under-classify
 * rather than guess" rule `shore-access.ts` already applies to distance
 * data). 120 miles — generous enough to keep a legitimate "worth the
 * drive" suggestion (matches this app's own largest *named* nearby-search
 * radius option before "All"), tight enough to catch an obviously wrong
 * namesake.
 */
const MAX_PLAUSIBLE_DISTANCE_MILES = 120;

export function discardImplausibleCoordinates(point: LatLng, candidates: CandidateSite[]): CandidateSite[] {
  return candidates.map((candidate) => {
    if (candidate.latitude === null || candidate.longitude === null) return candidate;

    const miles = distanceMiles(point, { latitude: candidate.latitude, longitude: candidate.longitude });
    if (miles <= MAX_PLAUSIBLE_DISTANCE_MILES) return candidate;

    logger.warn("area_research.implausible_coordinate_discarded", {
      name: candidate.name,
      miles: Math.round(miles),
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    });
    return { ...candidate, latitude: null, longitude: null };
  });
}

/**
 * Second pass, only for candidates `extractCandidateSites` returned with no
 * coordinates — found live 2026-08-11: a general "dive sites near X" search
 * almost never turns up GPS coordinates in its snippets, so this was
 * routinely every candidate. One targeted Brave search per candidate
 * (`"{name}" {placeName} coordinates GPS`), then — since a live test showed
 * even a coordinate-specific query's *snippets* still never carry the
 * actual number (confirmed against 20 real results: zero contained a
 * coordinate-looking value) — fetches several of that search's top
 * results' full page text (`page-fetch.ts`, `COORDINATE_PAGE_FETCH_COUNT`)
 * and hands it along too, since that's where the number actually lives
 * when a page has one at all. Widened from just the #1 result to several
 * the same day after a real run left every candidate coordinate-less: the
 * #1 result was blocked (403) or timed out for half the candidates that
 * round, with no fallback to a lower-ranked result that might have
 * worked. A SINGLE follow-up Gemini call across all candidates together
 * (not one per candidate) to extract a real coordinate only where
 * something explicitly states one — mirrors the manual "general search,
 * then a specific follow-up per site, then read the actual page" pattern
 * that found real coordinates for the Jacksonville wrecks earlier this
 * session.
 *
 * Best-effort and fully degrade-safe: any failure here (a Brave error, a
 * page-fetch error, a Gemini error) falls back to the original candidates
 * unchanged rather than losing real, already-found sites over an
 * enrichment step failing. A page-fetch failure specifically degrades to
 * snippets-only for that one candidate, not to dropping it.
 */
async function enrichMissingCoordinates(placeName: string, candidates: CandidateSite[]): Promise<CandidateSite[]> {
  const needsCoordinates = candidates
    .filter((candidate) => candidate.latitude === null || candidate.longitude === null)
    .slice(0, COORDINATE_ENRICHMENT_LIMIT);

  if (needsCoordinates.length === 0) return candidates;

  const followUps: CoordinateFollowUp[] = [];
  for (const candidate of needsCoordinates) {
    // Unconditional, including before the first call: the initial
    // `braveSearch()` in `researchDiveSitesNear()` usually leaves enough
    // of a gap on its own (a Gemini extraction call runs in between), but
    // that's not guaranteed on a fast response — always pausing is the
    // safe default, not a maybe.
    await sleep(BRAVE_THROTTLE_MS);

    const { results, error } = await braveSearch(`"${candidate.name}" ${placeName} coordinates GPS`);
    if (error) {
      logger.warn("area_research.coordinate_search_failed", { message: error, name: candidate.name });
      continue;
    }
    if (results.length === 0) continue;

    // Try more than just the #1 result — found live 2026-08-11: the top
    // result is often exactly the kind of specialized dive-site directory
    // most likely to have a real coordinate, and also exactly the kind of
    // site that blocks bare server-side fetches (403) or times out. Trying
    // several in parallel (each already individually bounded by
    // `fetchReadableText`'s own timeout) means one blocked/slow page
    // doesn't leave the whole candidate with nothing.
    const fetched = await Promise.all(
      results.slice(0, COORDINATE_PAGE_FETCH_COUNT).map(async (result) => {
        const { text, error: fetchError } = await fetchReadableText(result.url);
        if (fetchError) {
          logger.info("area_research.page_fetch_skipped", { name: candidate.name, url: result.url, message: fetchError });
        }
        return text ? { url: result.url, text } : null;
      }),
    );
    const pages = fetched.filter((page): page is { url: string; text: string } => page !== null);

    followUps.push({ name: candidate.name, results, pages });
  }

  if (followUps.length === 0) return candidates;

  try {
    const lookups = await extractCoordinates(followUps);
    const enriched = candidates.map((candidate) => {
      const lookup = lookups.find((entry) => entry.name === candidate.name);
      if (!lookup) return candidate;
      return {
        ...candidate,
        latitude: candidate.latitude ?? lookup.latitude,
        longitude: candidate.longitude ?? lookup.longitude,
      };
    });
    const found = enriched.filter((c) => c.latitude !== null).length - candidates.filter((c) => c.latitude !== null).length;
    logger.info("area_research.coordinates_enriched", { placeName, attempted: followUps.length, found });
    return enriched;
  } catch (error) {
    logger.warn("area_research.coordinate_enrichment_failed", { message: errorMessage(error), placeName });
    return candidates;
  }
}

export async function researchDiveSitesNear(
  point: LatLng,
): Promise<{ candidates: CandidateSite[]; error: string | null }> {
  const placeName = await placeNameNear(point);
  if (!placeName) {
    logger.info("area_research.no_place_name", { point });
    return { candidates: [], error: null };
  }

  // Two queries, not one — founder-reported (2026-08-11): a plain "dive
  // sites near X" search skews toward generic "top dive sites" round-ups,
  // which for a destination like Bermuda are almost entirely boat/wreck
  // content. This app's whole premise is SHORE diving specifically
  // (CLAUDE.md's Map-Driven Exploration pillar), so a dedicated
  // shore-diving query runs alongside the general one — matching the
  // founder's own manual comparison query ("Are there any shore dives
  // and/or dive sites in Bermuda") rather than leaving shore access as an
  // afterthought the general query happens to also turn up.
  const { results: generalResults, error: generalError } = await braveSearch(`scuba diving dive sites near ${placeName}`);
  if (generalError) {
    logger.warn("area_research.brave_search_failed", { message: generalError, placeName });
    return { candidates: [], error: generalError };
  }

  await sleep(BRAVE_THROTTLE_MS);
  const { results: shoreResults, error: shoreError } = await braveSearch(
    `shore diving shore dives near ${placeName} enter from the beach`,
  );
  if (shoreError) {
    logger.warn("area_research.shore_search_failed", { message: shoreError, placeName });
    // Best-effort — the general query alone is still a real result, don't
    // fail the whole request over the second query specifically failing.
  }

  const seenUrls = new Set<string>();
  const results = [...generalResults, ...(shoreResults ?? [])].filter((result) => {
    if (seenUrls.has(result.url)) return false;
    seenUrls.add(result.url);
    return true;
  });

  if (results.length === 0) {
    logger.info("area_research.no_search_results", { placeName });
    return { candidates: [], error: null };
  }

  // Founder-reported live gap (2026-08-11): Bermuda genuinely has a dozen+
  // named dive sites, but reading only 20 short snippets found just one —
  // a "Top dive sites in X" round-up article's SNIPPET is a sentence or
  // two; its full text usually names every site it covers. Fetch a few of
  // the top general-search results' full pages, in parallel (each already
  // individually timed out/size-capped by `fetchReadableText`), and hand
  // that along too — same fix that already worked for coordinates, applied
  // to discovery itself.
  const topPages = await Promise.all(
    results.slice(0, INITIAL_PAGE_FETCH_COUNT).map(async (result) => {
      const { text } = await fetchReadableText(result.url);
      return text ? { url: result.url, text } : null;
    }),
  );
  const pages = topPages.filter((page): page is { url: string; text: string } => page !== null);

  try {
    const initialCandidates = await extractCandidateSites(placeName, results, pages);
    const enriched = await enrichMissingCoordinates(placeName, initialCandidates);
    const candidates = discardImplausibleCoordinates(point, enriched);
    logger.info("area_research.complete", { placeName, resultsFound: results.length, candidates: candidates.length });
    return { candidates, error: null };
  } catch (error) {
    const rawMessage = errorMessage(error);
    logger.error("area_research.extraction_failed", { message: rawMessage, placeName });
    return { candidates: [], error: friendlyErrorMessage(rawMessage) };
  }
}

/**
 * The `@google/genai` SDK's own `Error.message` for an API failure is the
 * raw JSON error body (confirmed live 2026-08-11: a quota error's message
 * was a multi-hundred-character nested JSON blob) — never fit to show a
 * diver directly. This is the single choke point every Gemini-call
 * failure in this pipeline passes through, so it's the right place to
 * translate the one failure mode worth naming specifically (a free-tier
 * quota/rate limit — the kind of thing this app's own no-budget
 * constraint makes a real, expected occurrence, not a bug to hide) into
 * something honest and readable, and fall back to a generic message for
 * everything else rather than ever surfacing raw API JSON.
 */
export function friendlyErrorMessage(rawMessage: string): string {
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(rawMessage)) {
    return "The web-search fallback has hit its free daily limit for now — try again later.";
  }
  return "Something went wrong searching the web — try again.";
}
