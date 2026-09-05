"use client";

/**
 * Renders candidates from the map-pan AI-assisted discovery fallback
 * (`plan.md` Resolved Spec Decision #10, 2026-08-11) with a per-card
 * instant "Add to map" action — the founder's explicit design: no
 * moderation queue, results usable immediately. Reuses
 * `SiteResearchSummary` for each candidate's summary/citations/disclosure
 * rather than re-inventing that rendering — it already carries the exact
 * "AI-assisted web research — not independently verified" badge this data
 * needs, same standing rule `shore_access` observes.
 */

import { useState } from "react";
import { SiteResearchSummary } from "@/components/site-research-summary";
import { SITE_TYPE_LABELS } from "@/lib/sites/site-type-labels";
import type { SiteMarker } from "@/lib/sites/types";
import type { CandidateSite } from "@/lib/site-discovery/area-research";

export interface SiteDiscoveryCandidatesProps {
  candidates: CandidateSite[];
  /** Called with the newly-inserted site (already shaped as a `SiteMarker`)
   * right after a successful add — the caller is responsible for merging
   * it into whatever feeds the map/list, so it appears immediately. */
  onAdded: (site: SiteMarker) => void;
}

type AddStatus = "idle" | "adding" | "added" | "error";

export function SiteDiscoveryCandidates({ candidates, onAdded }: SiteDiscoveryCandidatesProps) {
  const [statuses, setStatuses] = useState<Record<number, AddStatus>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  async function handleAdd(index: number, candidate: CandidateSite) {
    setStatuses((prev) => ({ ...prev, [index]: "adding" }));
    try {
      const response = await fetch("/api/sites/candidates/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidate.name,
          latitude: candidate.latitude,
          longitude: candidate.longitude,
          site_type: candidate.site_type,
          depth_min_ft: candidate.depth_min_ft,
          depth_max_ft: candidate.depth_max_ft,
          research_summary: candidate.research_summary,
          research_sources: candidate.research_sources,
        }),
      });
      const data = (await response.json()) as { site?: SiteMarker; error?: string };
      if (!response.ok || !data.site) {
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }
      setStatuses((prev) => ({ ...prev, [index]: "added" }));
      onAdded(data.site);
    } catch (error) {
      setStatuses((prev) => ({ ...prev, [index]: "error" }));
      setErrors((prev) => ({ ...prev, [index]: error instanceof Error ? error.message : String(error) }));
    }
  }

  if (candidates.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        No real dive sites turned up in a web search of this area either — it may genuinely not have any
        documented yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {candidates.map((candidate, index) => {
        const status = statuses[index] ?? "idle";
        const hasCoordinates = candidate.latitude !== null && candidate.longitude !== null;
        return (
          <li key={`${candidate.name}-${index}`} className="rounded-xl border border-zinc-200 p-3 dark:border-depth-border">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-black dark:text-zinc-50">{candidate.name}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {SITE_TYPE_LABELS[candidate.site_type]}
                  {candidate.depth_max_ft != null ? ` · up to ${candidate.depth_max_ft} ft` : ""}
                  {" · "}
                  {candidate.shore_access_claim}
                </div>
              </div>
              <button
                type="button"
                disabled={!hasCoordinates || status === "adding" || status === "added"}
                onClick={() => handleAdd(index, candidate)}
                className="min-h-[28px] shrink-0 rounded-full border border-sky-600 bg-sky-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:border-depth-border dark:disabled:bg-depth-2 dark:disabled:text-zinc-500"
              >
                {status === "adding" ? "Adding…" : status === "added" ? "Added ✓" : "Add to map"}
              </button>
            </div>

            <div className="mt-2">
              <SiteResearchSummary
                summary={candidate.research_summary}
                sources={candidate.research_sources}
                updatedAt={new Date().toISOString()}
              />
            </div>

            {!hasCoordinates && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                No confirmed coordinates in the search results — can&apos;t be placed on the map directly.
              </p>
            )}
            {status === "error" && <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{errors[index]}</p>}
          </li>
        );
      })}
    </ul>
  );
}
