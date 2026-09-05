"use client";

/**
 * The post-save confirmation.
 *
 * `creative/flows/voice-logging.md`'s diagram annotates this state "quiet
 * checkmark, settles — not a celebratory animation (§6)". DESIGN_SYSTEM.md
 * §6 is the source: "no bounce, no elastic easing, no confetti or
 * celebratory animation on safety-adjacent actions." So this is a small
 * emerald check and a factual summary, with no motion at all.
 *
 * The summary restates what was actually saved rather than just saying
 * "Saved". After a flow whose whole premise is that a machine may have
 * misheard a number, the last thing a diver sees should be the number.
 */

import { formatDepthFt, formatRuntimeMinutes, formatTankPressure } from "@/lib/voice-logging/format";
import type { DiveLogEntry } from "@/lib/voice-logging/types";

export interface SavedViewProps {
  entry: DiveLogEntry;
  onDone: () => void;
  onLogAnother: () => void;
}

export function SavedView({ entry, onDone, onLogAnother }: SavedViewProps) {
  const summary = [
    entry.site.trim() === "" ? null : entry.site.trim(),
    entry.maxDepthFt === null ? null : formatDepthFt(entry.maxDepthFt),
    entry.runtimeMinutes === null ? null : formatRuntimeMinutes(entry.runtimeMinutes),
    /*
      Tank pressure joins depth and runtime here, and the other three v5
      fields deliberately don't. This screen exists to put a *transcribed
      number* back in front of a diver after a flow whose whole premise is
      that a machine may have misheard one; buddy, water temp, and suit are
      either not numbers or not ones a misparse would endanger anyone over.
      They're all visible in "Saved dive logs" — this screen stays quiet.
    */
    entry.tankPressureStartPsi === null && entry.tankPressureEndPsi === null
      ? null
      : formatTankPressure(entry.tankPressureStartPsi, entry.tankPressureEndPsi),
    entry.marineLife.length === 0 ? null : `${entry.marineLife.length} sighting${entry.marineLife.length === 1 ? "" : "s"}`,
  ].filter((part): part is string => part !== null);

  return (
    <section
      role="status"
      className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-depth-border dark:bg-depth-1"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10">
        <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>

      <div>
        <h2 className="font-display text-base font-semibold text-black dark:text-zinc-50">Dive log saved</h2>
        {summary.length > 0 && (
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{summary.join(" · ")}</p>
        )}
      </div>

      {entry.editedFields.length > 0 && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {entry.editedFields.length} field{entry.editedFields.length === 1 ? "" : "s"} corrected before saving.
        </p>
      )}

      <p className="text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
        Saved on this device only for now — not yet synced to an account.
      </p>

      <div className="mt-1 flex w-full gap-2">
        <button
          type="button"
          onClick={onLogAnother}
          className="min-h-11 flex-1 rounded-xl border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-depth-border dark:text-zinc-300 dark:hover:bg-depth-2"
        >
          Log another
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 flex-1 rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
        >
          Done
        </button>
      </div>
    </section>
  );
}
