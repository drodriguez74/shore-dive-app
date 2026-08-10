import { ProvenanceBadge } from "@/components/provenance-badge";
import type { ChopState, WebcamReading } from "@/lib/webcam-extraction/types";

/**
 * T18.4 — visually-distinct display for a single `webcam_readings` row
 * (Task 18). Reuses `ProvenanceBadge`'s existing `MODEL_INFERRED` treatment
 * (`src/components/provenance-badge.tsx`, built and documented back at
 * P0-B.5 as "forward-compat only... nothing wires it up yet") rather than
 * inventing a second visual language for "this is a model estimate, not a
 * verified reading" — THREAT_MODEL.md §9 and plan.md P0-B are both explicit
 * that an inferred reading must never carry the same visual weight as
 * verified/community hazard data, and that requirement is already fully
 * implemented in `ProvenanceBadge`; this component's only job is to feed it
 * the right props and add the visibility/chop value alongside it.
 *
 * No client-side interactivity needed — plain presentational component, no
 * `"use client"` directive.
 */

export interface WebcamReadingBadgeProps {
  reading: WebcamReading;
  className?: string;
}

const CHOP_LABELS: Record<ChopState, string> = {
  calm: "Calm",
  light: "Light chop",
  moderate: "Moderate chop",
  rough: "Rough",
  severe: "Severe",
};

function formatVisibility(meters: number | null): string | null {
  if (meters === null) return null;
  return `~${meters.toFixed(1)} m visibility`;
}

/** Deliberately NOT reusing `FreshnessBadge` here — that component's copy
 * ("Cached X ago" / "Stale — cached X ago") is specific to the offline-
 * cache freshness story (Task 13). A webcam reading's `capturedAt` is a
 * different concept (when the *source frame* was taken, not when this app
 * cached something), so it gets its own plain timestamp line rather than
 * borrowing wording that would say something untrue. */
function formatCapturedAt(capturedAt: string): string {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function WebcamReadingBadge({ reading, className = "" }: WebcamReadingBadgeProps) {
  const visibilityText = formatVisibility(reading.visibilityMeters);
  const chopText = reading.chopState ? CHOP_LABELS[reading.chopState] : null;
  const hasEstimate = visibilityText !== null || chopText !== null;

  return (
    <div className={`inline-flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge provenance="MODEL_INFERRED" confidence={reading.confidence} />
        {hasEstimate ? (
          <span className="text-sm text-zinc-700 dark:text-zinc-300">
            {[visibilityText, chopText].filter(Boolean).join(" · ")}
          </span>
        ) : (
          <span className="text-sm italic text-zinc-500 dark:text-zinc-400">
            No estimate produced from this frame
          </span>
        )}
      </div>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        From webcam frame captured {formatCapturedAt(reading.capturedAt)}
      </span>
    </div>
  );
}
