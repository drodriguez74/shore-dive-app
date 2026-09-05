import { GoogleGenAI, Type } from "@google/genai";
import { errorMessage } from "@/lib/error-message";
import type { SiteType } from "@/lib/sites/types";
import type { ResearchSource } from "@/lib/sites/types";
import type { BraveSearchResult } from "./brave-search";
import { logger } from "./logger";

/**
 * Extraction half of the map-pan AI-assisted discovery fallback (`plan.md`
 * Resolved Spec Decision #10, 2026-08-11). Google's Gemini API free tier —
 * chosen because this is a bounded structured-output task (turning search
 * snippets into named candidate sites), not something that needs a
 * frontier/metered model.
 *
 * Originally snippets-only ("this simple agent," per the founder's initial
 * framing) — widened same day, live, once real testing showed the gap that
 * left: a real destination with a dozen+ named sites in one search-result
 * article only surfaced one or two, because a snippet is a sentence or two
 * and a "Top dive sites in X" round-up article names far more than that.
 * `extractCandidateSites` and `extractCoordinates` both now optionally take
 * fetched full page text (`FetchedPage[]`, via `page-fetch.ts`) alongside
 * the snippets — `area-research.ts` fetches a few of the top results for
 * both the initial discovery pass and the coordinate follow-up.
 */

// **A pinned version, "gemini-3.1-flash-lite" — not the "-latest" alias**
// (founder's explicit choice, 2026-08-11, switching from an earlier
// same-day "-latest" attempt). Confirmed live/reachable for this key
// before switching (200 OK, real response) — this is the real, accepted
// tradeoff of pinning: predictable behavior now (no repeat of the
// "-latest" alias silently resolving to a different model mid-session,
// which is what caused the original quota confusion this same day),
// versus the pinned name itself eventually going stale for new keys the
// way a hardcoded "gemini-2.5-flash" already did once — if this model ID
// ever 404s with "no longer available to new users," that's the same
// known failure mode, not a new bug; check `/v1beta/models` for a current
// replacement.
//
// **"-flash-lite", not plain "-flash".** The full flash tier's free-tier
// daily quota was measured live at a hard 20 requests/day
// (`generate_content_free_tier_requests`,
// `GenerateRequestsPerDayPerProjectPerModel-FreeTier`) — exhausted by a
// single afternoon of this feature's own live testing. `-flash-lite` is a
// separate quota bucket, confirmed live and reachable the same day the
// full tier's was exhausted, and third-party aggregated reporting
// (Google's own current numbers are account-tier-gated, not in the
// public docs) puts its free-tier RPD in the 1,000-1,500 range — roughly
// 50-75x more headroom for the same $0 cost. This task (bounded structured
// extraction from search text, not open-ended reasoning) doesn't need the
// larger model's extra capability, so there's no real quality tradeoff
// being made for that quota headroom — see this session's own original
// reasoning for using any Gemini free-tier model over a frontier one.
const GEMINI_MODEL_ID = "gemini-3.1-flash-lite";

const SITE_TYPE_VALUES: readonly SiteType[] = [
  "shore_reef",
  "shipwreck",
  "cave",
  "spring",
  "artificial_reef",
  "unclassified",
] as const;

export interface ExtractedCandidateSite {
  name: string;
  latitude: number | null;
  longitude: number | null;
  site_type: SiteType;
  depth_min_ft: number | null;
  depth_max_ft: number | null;
  /** Plain-language access claim from the search results, not a confidence
   * enum — pre-classification. Real `shore_access` is computed later, at
   * add-to-map time, via `classifyShoreAccess()` (see `candidates/add`
   * route). */
  shore_access_claim: string;
  research_summary: string;
  research_sources: ResearchSource[];
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    candidates: {
      type: Type.ARRAY,
      description: "Real, named dive sites found in the provided search results. Empty array if none.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "The dive site's real, specific name — never invented." },
          latitude: { type: Type.NUMBER, nullable: true, description: "Decimal degrees, null if not determinable from the search results." },
          longitude: { type: Type.NUMBER, nullable: true, description: "Decimal degrees, null if not determinable from the search results." },
          site_type: { type: Type.STRING, enum: [...SITE_TYPE_VALUES] },
          depth_min_ft: { type: Type.NUMBER, nullable: true, description: "Shallowest divable depth in feet, null if unknown." },
          depth_max_ft: { type: Type.NUMBER, nullable: true, description: "Deepest point in feet, null if unknown." },
          shore_access_claim: {
            type: Type.STRING,
            description: "Plain-language description of how a diver gets in the water, based only on what the search results say.",
          },
          research_summary: {
            type: Type.STRING,
            description: "A short, original synthesis of what the search results say about this site — not copy-pasted verbatim from one source.",
          },
          research_sources: {
            type: Type.ARRAY,
            description: "Citations for this candidate — ONLY urls that literally appear in the provided search results. Never invent a url.",
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                url: { type: Type.STRING },
              },
              required: ["title", "url"],
            },
          },
        },
        required: ["name", "site_type", "shore_access_claim", "research_summary", "research_sources"],
      },
    },
  },
  required: ["candidates"],
};

export interface FetchedPage {
  url: string;
  text: string;
}

function buildPrompt(placeName: string, results: BraveSearchResult[], pages: FetchedPage[] = []): string {
  const resultsBlock = results
    .map((result, index) => `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.description}`)
    .join("\n\n");

  // Added 2026-08-11 (founder-reported: a real destination with a dozen+
  // real, named sites was only surfacing one) — a search-result snippet is
  // one or two sentences; a "Top dive sites in X" round-up article's full
  // text usually names every site it covers. Reading a few full pages
  // instead of only 20 short snippets is what actually closes that gap,
  // the same fix that already worked for coordinates.
  const pagesBlock =
    pages.length > 0
      ? "\n\nFull page text for some of the results above — read these for more names/detail than the short snippets show:\n\n" +
        pages.map((page) => `--- Full text of ${page.url} ---\n${page.text}`).join("\n\n")
      : "";

  return `You are helping a SHORE-DIVING focused app find real, named scuba/snorkel dive sites near "${placeName}". This app's whole premise is telling a diver whether a site is reachable from the beach without a boat — do not let boat-accessible "top dive sites" round-ups crowd out shore access. The search results below are a MIX of two searches: one general "dive sites" query and one specifically about shore diving/shore access — read both kinds carefully and report BOTH shore-accessible and boat-only sites you find, but make sure genuinely shore-accessible sites are not missed just because they're less prominent in general "top sites" listicles (which tend to favor boat/wreck diving). Use \`shore_access_claim\` to say plainly, in your own words based on what the text says, whether a site is shore-accessible, boat-only, or unclear — never leave this vague when the source actually says one or the other.

Base your answer ONLY on what these results actually say — do not use outside knowledge, do not guess, and do not invent a dive site, coordinate, or citation that isn't supported by the text below. If a result is about a dive SHOP or operator rather than a specific dive SITE, do not treat the shop itself as a site. If two results describe the same site, treat that as corroboration and combine them into one candidate rather than listing it twice. If none of the results describe a real, specific dive site, return an empty candidates array — an empty, honest answer is correct and expected when the results don't support one.

**Proximity matters — this is being placed as a pin on a map centered on "${placeName}", not general travel advice.** Judge proximity by the SIZE of the place actually being searched, not by matching text literally:
- If "${placeName}" is (or is inside) a small city, town, island, or small country — something you'd reasonably drive or boat across in well under an hour — then a source that discusses diving anywhere in that same small place (by its city/island/country name, not the exact street address) DOES count as near it. Example: if the target is somewhere in Bermuda (a ~21 sq mi island), an article titled "Top dive sites in Bermuda" is directly relevant — the whole island is "nearby" at that scale.
- Only exclude a site when the source ties it to somewhere CLEARLY BIGGER or DIFFERENT than that immediate area — a whole large state/province/country when "${placeName}" is one specific town within it (e.g. "Top dive sites in Florida" does NOT establish a site is near one specific Florida town — Florida is 500+ miles long), a different city/region entirely, or purely generic content with no real place tied to it at all.
If you're genuinely unsure whether a source's place is at the same small scale as "${placeName}" or a much larger one, prefer including it with an honest, hedged description over dropping a real site — the goal is not padding the list with irrelevant content, but also not discarding a real, correctly-scoped answer out of excess caution.

List EVERY distinct real dive site you find named across the snippets AND the full page text below — do not stop at the first one or two, and do not artificially limit how many candidates you return. A single "top dive sites" article often names a dozen or more real, distinct sites; find them all, not just the most prominent.

Every research_sources entry's url MUST be copied exactly from one of the URLs below — never write a url that doesn't appear below.

Search results:

${resultsBlock}${pagesBlock}`;
}

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. The map-pan AI-assisted discovery fallback cannot call Gemini without " +
        "it — get a free key from Google AI Studio (aistudio.google.com/apikey) and add it to .env.local.",
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey });
  }
  return cachedClient;
}

/**
 * Defensive normalization of one raw candidate object from Gemini's JSON
 * response — `responseSchema` constrains the *shape* Gemini aims for, not
 * that it actually complied, so nothing here is trusted without a check.
 * Returns `null` (candidate dropped, not the whole response) when a field
 * essential to showing/using the candidate is missing or malformed, mirroring
 * `webcam-extraction`'s own "one bad reading doesn't take down the batch"
 * discipline.
 */
export function normalizeCandidate(raw: unknown): ExtractedCandidateSite | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;

  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const researchSummary = typeof candidate.research_summary === "string" ? candidate.research_summary.trim() : "";
  const shoreAccessClaim = typeof candidate.shore_access_claim === "string" ? candidate.shore_access_claim.trim() : "";
  if (!name || !researchSummary || !shoreAccessClaim) return null;

  const siteType = SITE_TYPE_VALUES.includes(candidate.site_type as SiteType)
    ? (candidate.site_type as SiteType)
    : "unclassified";

  const latitude = typeof candidate.latitude === "number" && Number.isFinite(candidate.latitude) ? candidate.latitude : null;
  const longitude =
    typeof candidate.longitude === "number" && Number.isFinite(candidate.longitude) ? candidate.longitude : null;
  const depthMinFt =
    typeof candidate.depth_min_ft === "number" && Number.isFinite(candidate.depth_min_ft) ? candidate.depth_min_ft : null;
  const depthMaxFt =
    typeof candidate.depth_max_ft === "number" && Number.isFinite(candidate.depth_max_ft) ? candidate.depth_max_ft : null;

  const rawSources = Array.isArray(candidate.research_sources) ? candidate.research_sources : [];
  const researchSources: ResearchSource[] = rawSources
    .filter(
      (source): source is { title: string; url: string } =>
        !!source &&
        typeof source === "object" &&
        typeof (source as Record<string, unknown>).title === "string" &&
        typeof (source as Record<string, unknown>).url === "string",
    )
    .map((source) => ({ title: source.title, url: source.url }));

  // A candidate with zero real citations isn't usable on a safety-adjacent
  // app that requires lineage for every claim (CLAUDE.md: "never render a
  // bare... pin with no lineage") — drop it rather than show an
  // unsourced claim.
  if (researchSources.length === 0) return null;

  return {
    name,
    latitude,
    longitude,
    site_type: siteType,
    depth_min_ft: depthMinFt,
    depth_max_ft: depthMaxFt,
    shore_access_claim: shoreAccessClaim,
    research_summary: researchSummary,
    research_sources: researchSources,
  };
}

/**
 * Extracts structured candidate dive sites from a set of Brave Search
 * results. Throws on API failure (missing key, network error, no text in
 * the response) — callers (`area-research.ts`) are expected to catch and
 * degrade to "no candidates found" rather than let this crash the request,
 * same "real code, fails loudly on a real problem, caller decides how to
 * degrade" shape as `webcam-extraction/vision-client.ts`.
 */
export async function extractCandidateSites(
  placeName: string,
  results: BraveSearchResult[],
  pages: FetchedPage[] = [],
): Promise<ExtractedCandidateSite[]> {
  if (results.length === 0) return [];

  const client = getClient();
  const response = await client.models.generateContent({
    model: GEMINI_MODEL_ID,
    contents: buildPrompt(placeName, results, pages),
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    logger.error("gemini_client.no_text_in_response");
    throw new Error("Gemini response contained no text content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logger.error("gemini_client.unparseable_response", { message: errorMessage(error) });
    throw new Error("Gemini response was not valid JSON");
  }

  const rawCandidates =
    parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).candidates)
      ? ((parsed as Record<string, unknown>).candidates as unknown[])
      : [];

  return rawCandidates.map(normalizeCandidate).filter((candidate): candidate is ExtractedCandidateSite => candidate !== null);
}

// ---------------------------------------------------------------------
// Coordinate follow-up (2026-08-11) — found live: the general "dive sites
// near X" search almost never turns up coordinates in its snippets (dive
// shop pages describe sites by name/area, not GPS), so `extractCandidateSites`
// alone consistently returns real, correctly-named sites with
// latitude/longitude null on every one — unable to be placed on the map.
// This is a second, targeted pass, one Brave search per candidate still
// missing coordinates (`area-research.ts`'s `enrichMissingCoordinates`),
// then a single follow-up Gemini call across all of them at once (not one
// call per candidate, to keep this cheap) — mirrors exactly the manual
// "general search, then a specific follow-up search per site" pattern that
// found real coordinates for the Jacksonville wrecks earlier this session.
// ---------------------------------------------------------------------

export interface CoordinateLookup {
  name: string;
  latitude: number | null;
  longitude: number | null;
}

const COORDINATE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sites: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "Must exactly match one of the dive site names given below." },
          latitude: {
            type: Type.NUMBER,
            nullable: true,
            description: "Decimal degrees, ONLY if a search result explicitly states a coordinate for this site. null otherwise.",
          },
          longitude: {
            type: Type.NUMBER,
            nullable: true,
            description: "Decimal degrees, ONLY if a search result explicitly states a coordinate for this site. null otherwise.",
          },
        },
        required: ["name"],
      },
    },
  },
  required: ["sites"],
};

export interface CoordinateFollowUp {
  name: string;
  results: BraveSearchResult[];
  /** Readable text of whichever of the follow-up search's top results
   * were actually fetchable (`page-fetch.ts`) — `[]`/absent falls back to
   * snippets only. Widened from "just the #1 result" to several
   * (2026-08-11): live testing found the #1 result blocked (403) or timed
   * out often enough (real bot-detection on exactly the specialized
   * dive-site directories most likely to have a coordinate) that relying
   * on it alone left every candidate with no coordinate on some runs even
   * though a lower-ranked result would have worked. */
  pages?: FetchedPage[];
}

function buildCoordinatePrompt(followUps: CoordinateFollowUp[]): string {
  const blocks = followUps
    .map(({ name, results, pages }) => {
      const resultsText = results
        .map((result, index) => `[${index + 1}] ${result.title}\nURL: ${result.url}\n${result.description}`)
        .join("\n\n");
      const pagesBlock =
        pages && pages.length > 0
          ? "\n\n" + pages.map((page) => `Full page text from ${page.url}:\n${page.text}`).join("\n\n")
          : "";
      return `Dive site: "${name}"\nSearch results:\n${resultsText}${pagesBlock}`;
    })
    .join("\n\n---\n\n");

  return `For each dive site below, find its precise latitude/longitude — ONLY if a search result or the full page text explicitly states an actual coordinate (e.g. "18.42 N, 68.97 W", a decimal-degree pair, or an unambiguous GPS reading). Do NOT estimate, guess, or infer a coordinate from a general place name or landmark alone — "near Catalina Island" or "off the coast of X" is NOT a coordinate. If nothing below gives an explicit coordinate for a site, return latitude and longitude as null for that site — an honest null is correct and expected, do not fabricate a plausible-looking number.

${blocks}`;
}

function normalizeCoordinateLookup(raw: unknown): CoordinateLookup | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;

  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  if (!name) return null;

  const latitude =
    typeof entry.latitude === "number" && Number.isFinite(entry.latitude) && entry.latitude >= -90 && entry.latitude <= 90
      ? entry.latitude
      : null;
  const longitude =
    typeof entry.longitude === "number" &&
    Number.isFinite(entry.longitude) &&
    entry.longitude >= -180 &&
    entry.longitude <= 180
      ? entry.longitude
      : null;

  return { name, latitude, longitude };
}

/**
 * Targeted coordinate lookup across several dive sites at once (one Gemini
 * call, not one per site — see the section header above for why). Throws on
 * API failure, same "caller catches and degrades" contract as
 * `extractCandidateSites` — `area-research.ts`'s `enrichMissingCoordinates`
 * catches this and falls back to the original, coordinate-less candidates
 * rather than losing them over an enrichment-step failure.
 */
export async function extractCoordinates(followUps: CoordinateFollowUp[]): Promise<CoordinateLookup[]> {
  if (followUps.length === 0) return [];

  const client = getClient();
  const response = await client.models.generateContent({
    model: GEMINI_MODEL_ID,
    contents: buildCoordinatePrompt(followUps),
    config: {
      responseMimeType: "application/json",
      responseSchema: COORDINATE_RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    logger.error("gemini_client.coordinate_lookup_no_text");
    throw new Error("Gemini coordinate-lookup response contained no text content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    logger.error("gemini_client.coordinate_lookup_unparseable", { message: errorMessage(error) });
    throw new Error("Gemini coordinate-lookup response was not valid JSON");
  }

  const rawSites =
    parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).sites)
      ? ((parsed as Record<string, unknown>).sites as unknown[])
      : [];

  return rawSites.map(normalizeCoordinateLookup).filter((entry): entry is CoordinateLookup => entry !== null);
}
