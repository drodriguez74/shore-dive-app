"use client";

import { useCallback, useState } from "react";
import type { GeolocationCoords } from "@/hooks/use-geolocation";
import { errorMessage } from "@/lib/error-message";
import type { CandidateSite } from "@/lib/site-discovery/area-research";
import { logger } from "@/lib/sites/logger";

/** State of the metered web-search discovery pipeline (Brave + Gemini), separate from the free local/OSM search. */
export interface AiSearchState {
  status: "idle" | "loading" | "done" | "error";
  candidates: CandidateSite[];
  error: string | null;
}

export interface AiSearchResponse {
  candidates?: CandidateSite[];
  error?: string | null;
}

const IDLE_AI_SEARCH_STATE: AiSearchState = { status: "idle", candidates: [], error: null };

/**
 * The route returns HTTP 200 with `error` set for an upstream failure (for
 * example a quota error), so `response.ok` alone would read a failure as
 * "searched the web, found nothing".
 */
export function nextAiSearchStateFromResponse(
  data: AiSearchResponse,
  responseOk: boolean,
  statusCode: number,
): AiSearchState {
  if (!responseOk || data.error) {
    return { status: "error", candidates: [], error: data.error ?? `Request failed (${statusCode})` };
  }
  return { status: "done", candidates: data.candidates ?? [], error: null };
}

/** Explicit, diver-triggered web search for dive sites around a location picked on the map. */
export function useAreaResearch(center: GeolocationCoords | null) {
  const [aiSearch, setAiSearch] = useState<AiSearchState>(IDLE_AI_SEARCH_STATE);

  const run = useCallback(async () => {
    if (!center) return;
    setAiSearch({ status: "loading", candidates: [], error: null });
    try {
      const response = await fetch("/api/sites/research-area", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude: center.latitude, longitude: center.longitude }),
      });
      const data = (await response.json()) as AiSearchResponse;
      setAiSearch(nextAiSearchStateFromResponse(data, response.ok, response.status));
    } catch (error) {
      logger.warn("ai_area_search_failed", { message: errorMessage(error) });
      setAiSearch({ status: "error", candidates: [], error: "Something went wrong — try again." });
    }
  }, [center]);

  /** Candidates belong to one spot on the map; call this whenever the search centre changes. */
  const reset = useCallback(() => setAiSearch(IDLE_AI_SEARCH_STATE), []);

  return { aiSearch, run, reset };
}
