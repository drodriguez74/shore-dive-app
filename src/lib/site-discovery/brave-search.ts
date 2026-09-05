import { errorMessage } from "@/lib/error-message";
import { logger } from "./logger";

/**
 * Retrieval half of the map-pan AI-assisted discovery fallback (`plan.md`
 * Resolved Spec Decision #10, 2026-08-11). Brave Search's free tier (2,000
 * queries/month, no card required) — chosen specifically because
 * Anthropic's/OpenAI's hosted web-search tools are metered and DuckDuckGo
 * has no official supported search API (the unofficial scrape approach is
 * fragile and against their ToS, not something to build a real feature on).
 *
 * Plain authenticated `fetch` against Brave's REST endpoint — no SDK exists
 * for this, none is needed.
 *
 * Returns a result object rather than throwing, matching
 * `osm-import.ts`'s `queryOverpassNearby()` shape: this is one step in a
 * larger pipeline (`area-research.ts`) that must degrade to "no candidates
 * found" rather than crash the request over an external API having a bad
 * day.
 */

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchApiResponse {
  web?: {
    results?: { title?: string; url?: string; description?: string }[];
  };
}

export async function braveSearch(
  query: string,
): Promise<{ results: BraveSearchResult[]; error: string | null }> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return { results: [], error: "BRAVE_SEARCH_API_KEY is not set." };
  }

  const url = `${BRAVE_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) {
      const message = `Brave Search responded ${response.status}`;
      logger.warn("brave_search.non_ok_response", { status: response.status, query });
      return { results: [], error: message };
    }

    const data = (await response.json()) as BraveSearchApiResponse;
    const results: BraveSearchResult[] = (data.web?.results ?? [])
      .filter(
        (result): result is { title: string; url: string; description: string } =>
          typeof result.title === "string" && typeof result.url === "string",
      )
      .map((result) => ({ title: result.title, url: result.url, description: result.description ?? "" }));

    return { results, error: null };
  } catch (error) {
    const message = errorMessage(error);
    logger.warn("brave_search.request_failed", { message, query });
    return { results: [], error: message };
  }
}
