"use client";

/**
 * The live recording screen — mockup 02.
 *
 * ## The waveform is instrumentation, not decoration
 *
 * Bar heights are driven by the real `AnalyserNode` level rather than a
 * fixed CSS animation. That distinction matters: a purely decorative
 * animation would keep dancing against a muted or unplugged microphone, and
 * a diver who records two minutes into a dead mic and finds out at the
 * confirm screen has lost the log. A meter that sits flat is telling the
 * truth, and it's the only feedback available before transcription lands.
 *
 * The bars therefore animate via inline `scaleY` transforms driven by
 * state, not `@keyframes` — which also means `prefers-reduced-motion` needs
 * handling explicitly rather than inheriting the mockup's global animation
 * override. Under that preference the meter switches to a single numeric
 * level readout: same information, no movement (DESIGN_SYSTEM.md §6 makes
 * respecting the preference a requirement, not polish).
 *
 * ## Hint chips
 *
 * Mockup 02's "Try to mention" chips are load-bearing for the parser, not
 * filler: `parse-transcript.ts` extracts depth, runtime, sightings, and
 * conditions, and a diver who mentions those gets a fuller draft. They're
 * a prompt for the four things the extractor can actually use.
 */

import { formatElapsedClock } from "@/lib/voice-logging/format";

const BAR_COUNT = 13;

/**
 * Fixed per-bar weights so the meter reads as a waveform rather than
 * thirteen identical bars rising in lockstep. Deterministic, not random —
 * a random pattern would re-roll every render and shimmer.
 */
const BAR_WEIGHTS = [0.35, 0.65, 0.95, 0.5, 0.85, 1, 0.55, 0.75, 0.4, 0.7, 0.9, 0.45, 0.6];

export interface RecordingViewProps {
  elapsedMs: number;
  /** 0..1 input level. */
  level: number;
  /** Unstable in-progress recognition text, shown for reassurance only. */
  interimTranscript: string;
  prefersReducedMotion: boolean;
  onStop: () => void;
  onCancel: () => void;
}

export function RecordingView({
  elapsedMs,
  level,
  interimTranscript,
  prefersReducedMotion,
  onStop,
  onCancel,
}: RecordingViewProps) {
  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
      <div>
        <h2 className="font-display text-lg font-semibold text-black dark:text-zinc-50">Recording your dive log</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Mention max depth, total time, what you saw, and conditions — you&apos;ll review the draft next.
        </p>
      </div>

      <div className="flex flex-col items-center gap-5 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-8 dark:border-depth-border dark:bg-depth-2">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full bg-sky-500 dark:bg-sky-400 ${prefersReducedMotion ? "" : "animate-pulse"}`}
            aria-hidden="true"
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
            Recording
          </span>
        </div>

        <p className="font-display text-5xl font-semibold tabular-nums leading-none text-zinc-900 dark:text-zinc-50" aria-live="off">
          {formatElapsedClock(elapsedMs)}
        </p>
        {/*
          The clock updates ~8x/second. Announcing every tick would make a
          screen reader unusable, so the visual display is aria-live="off"
          and a coarse status line carries the same fact instead.
        */}
        <p className="sr-only" role="status">
          Recording, {Math.floor(elapsedMs / 1000)} seconds elapsed.
        </p>

        {prefersReducedMotion ? (
          <div className="flex h-10 w-full max-w-56 items-center gap-2" role="img" aria-label="Microphone level">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-depth-3">
              <div className="h-full rounded-full bg-sky-500 dark:bg-sky-400" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              {Math.round(level * 100)}%
            </span>
          </div>
        ) : (
          <div className="flex h-10 items-center gap-[3px]" role="img" aria-label="Live microphone level">
            {Array.from({ length: BAR_COUNT }, (_, index) => {
              // Floor of 0.12 keeps the meter visible at rest, so "flat"
              // reads as a quiet microphone rather than a broken component.
              const scale = Math.max(0.12, Math.min(1, level * BAR_WEIGHTS[index] * 1.6));
              return (
                <span
                  key={index}
                  className="w-[3px] rounded-full bg-sky-500 transition-transform duration-100 dark:bg-sky-400"
                  style={{ height: "40px", transform: `scaleY(${scale})` }}
                />
              );
            })}
          </div>
        )}

        <div className="w-full">
          <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Try to mention
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {["Max depth", "Total time", "What you saw", "Conditions"].map((hint) => (
              <span
                key={hint}
                className="rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-[11px] text-zinc-500 dark:border-depth-border dark:text-zinc-400"
              >
                {hint}
              </span>
            ))}
          </div>
        </div>

        {interimTranscript !== "" && (
          <p className="line-clamp-2 max-w-full text-center text-xs italic text-zinc-400 dark:text-zinc-500">
            &ldquo;{interimTranscript}&rdquo;
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onStop}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-6 text-base font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          </svg>
          Stop recording
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 w-full rounded-xl text-sm font-medium text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-depth-2"
        >
          Cancel — discard
        </button>
      </div>

      <div className="flex gap-2">
        <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden="true">
          <path
            d="M3 11h18v10H3zM12 3a4 4 0 0 1 4 4v4H8V7a4 4 0 0 1 4-4Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {/*
          Deliberately narrower than mockup 02's "Recorded and transcribed on
          this device — nothing is uploaded." That claim isn't reliably true:
          the Web Speech API is server-backed on most browsers today. The
          exact, resolved privacy mode is disclosed on the review screen once
          it's actually known; here we only state what is true in every case.
        */}
        <p className="text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          Recorded on this device. Shore Dive never uploads or stores your audio — your browser handles transcription,
          and the review screen shows exactly where that ran.
        </p>
      </div>
    </section>
  );
}
