"use client";

/**
 * Candidates from the map-pan AI-assisted discovery fallback (`plan.md`
 * Resolved Spec Decision #10) with a per-card instant "Add to map" — no
 * moderation queue, results usable immediately. Reuses `SiteResearchSummary`
 * for the summary/citations/disclosure so the "not independently verified"
 * badge is identical everywhere it appears.
 */

import { useState } from "react";
import { SiteResearchSummary } from "@/components/site-research-summary";
import { SITE_TYPE_LABELS } from "@/lib/sites/site-type-labels";
import type { SiteMarker } from "@/lib/sites/types";
import type { CandidateSite } from "@/lib/site-discovery/area-research";

export interface SiteDiscoveryCandidatesProps {
  candidates: CandidateSite[];
  /** Called with the newly-inserted site (already shaped as a `SiteMarker`)
   * right after a successful add — the caller merges it into whatever feeds
   * the map/list so it appears immediately. */
  onAdded: (site: SiteMarker) => void;
}

type AddStatus = "idle" | "adding" | "added" | "error";

const linkClass =
  "font-medium text-sky-700 underline underline-offset-2 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300";

export function SiteDiscoveryCandidates({ candidates, onAdded }: SiteDiscoveryCandidatesProps) {
  const [statuses, setStatuses] = useState<Record<number, AddStatus>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  async function handleAdd(index: number, candidate: CandidateSite, coordsOverride?: { latitude: number; longitude: number }) {
    setStatuses((prev) => ({ ...prev, [index]: "adding" }));
    try {
      const response = await fetch("/api/sites/candidates/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidate.name,
          latitude: coordsOverride?.latitude ?? candidate.latitude,
          longitude: coordsOverride?.longitude ?? candidate.longitude,
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

            {/* No coordinates from the pipeline isn't a dead end: link the diver
                out to look the site up, and let them add it once they have a
                real lat/long. The add route validates the coordinates. */}
            {!hasCoordinates && status !== "added" && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  No confirmed coordinates in the search results — find them to place this on the map.
                </p>
                <div>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(candidate.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`text-xs ${linkClass}`}
                  >
                    Look up “{candidate.name}” on Google Maps →
                  </a>
                </div>
                <ManualCoordinateEntry
                  busy={status === "adding"}
                  onSubmit={(latitude, longitude) => handleAdd(index, candidate, { latitude, longitude })}
                />
              </div>
            )}

            {status === "error" && <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{errors[index]}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/** Reveal-on-demand lat/long inputs for a candidate the pipeline couldn't
 * geolocate. Holds its own draft state; the parent owns the actual add. */
function ManualCoordinateEntry({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (latitude: number, longitude: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`text-xs ${linkClass}`}>
        I have the coordinates — add manually
      </button>
    );
  }

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  const valid =
    lat.trim() !== "" &&
    lng.trim() !== "" &&
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180;

  const fieldClass =
    "mt-0.5 w-28 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-black dark:border-depth-border dark:bg-depth-1 dark:text-zinc-50";

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Latitude
        <input inputMode="decimal" value={lat} onChange={(event) => setLat(event.target.value)} className={fieldClass} />
      </label>
      <label className="flex flex-col text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Longitude
        <input inputMode="decimal" value={lng} onChange={(event) => setLng(event.target.value)} className={fieldClass} />
      </label>
      <button
        type="button"
        disabled={!valid || busy}
        onClick={() => onSubmit(parsedLat, parsedLng)}
        className="min-h-[28px] rounded-full border border-sky-600 bg-sky-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:bg-zinc-200 disabled:text-zinc-500 dark:disabled:border-depth-border dark:disabled:bg-depth-2 dark:disabled:text-zinc-500"
      >
        {busy ? "Adding…" : "Add with these coordinates"}
      </button>
    </div>
  );
}
