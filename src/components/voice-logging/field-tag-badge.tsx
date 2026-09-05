/**
 * The per-field "Transcribed" / "Edited" lineage tag on the confirm/edit
 * form (mockup 04).
 *
 * The visual language is borrowed on purpose, not by coincidence.
 * `creative/flows/voice-logging.md`: the transcribed tag "echo[es]
 * (deliberately, not coincidentally) the visual language
 * `provenance-badge.tsx` already uses for `MODEL_INFERRED` — muted, dashed,
 * never confused with confirmed data." A diver who has learned that a
 * dashed grey badge means "extracted, plausible, unverified" on a hazard
 * pin reads the same thing here without being taught twice.
 *
 * It isn't a call to `ProvenanceBadge` itself, though, and shouldn't
 * become one: that component answers "where did this datum come from" for
 * shared, community-visible data (`VERIFIED` / `COMMUNITY` /
 * `MODEL_INFERRED`), which is a different question from "did you change
 * this since we heard it" about the diver's own private draft. Reusing the
 * component would couple a form-editing affordance to the provenance
 * taxonomy P0-B owns, and the first time either needed to change
 * independently they'd fight. Shared vocabulary, separate components.
 */

import type { DiveLogFieldTag } from "@/lib/voice-logging/types";

export function FieldTagBadge({ tag }: { tag: DiveLogFieldTag }) {
  if (tag === null) return null;

  if (tag === "edited") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:border-sky-400 dark:text-sky-300">
        <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5" aria-hidden="true">
          <path
            d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Edited
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-zinc-400 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
      Transcribed
    </span>
  );
}
