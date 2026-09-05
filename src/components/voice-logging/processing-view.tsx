"use client";

/**
 * The transcription wait — mockup 03.
 *
 * `creative/flows/voice-logging.md` explains why this screen exists at all
 * rather than being a spinner overlay: STT "is explicitly a best-effort,
 * possibly-slow step, not a guaranteed instant round trip." Two things
 * follow, and both are requirements rather than flourishes.
 *
 * **The skeleton preview** shows the shape of the form that's coming, so
 * the diver has something concrete to anticipate instead of a bare spinner.
 *
 * **The manual-entry exit is offered during the wait, not only after a
 * failure.** "A diver standing at the water's edge with cold hands
 * shouldn't be stuck waiting on a spinner that might not resolve; the
 * honest move is to make the fallback reachable at every step, not just the
 * one the code happens to land on." Note this is belt-and-braces with the
 * watchdog in `speech-recognition-session.ts`, which force-resolves if
 * `onend` never fires — the code shouldn't strand anyone, and if it does,
 * there's still a button.
 */

import { formatRecordingSummary } from "@/lib/voice-logging/format";

export interface ProcessingViewProps {
  recordingMs: number;
  prefersReducedMotion: boolean;
  onFallBackToManual: () => void;
  onCancel: () => void;
}

export function ProcessingView({
  recordingMs,
  prefersReducedMotion,
  onFallBackToManual,
  onCancel,
}: ProcessingViewProps) {
  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1">
      <div>
        <h2 className="font-display text-lg font-semibold text-black dark:text-zinc-50">Transcribing…</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Turning your recording into a draft log.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-7 dark:border-depth-border dark:bg-depth-2">
        <div
          role="status"
          aria-label="Transcribing"
          className={`h-8 w-8 rounded-full border-2 border-zinc-200 border-t-sky-500 dark:border-depth-3 dark:border-t-sky-400 ${
            prefersReducedMotion ? "" : "animate-spin"
          }`}
        />
        <p className="font-display text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {formatRecordingSummary(recordingMs)}
        </p>
        <p className="max-w-64 text-center text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Extracting depth, runtime, marine life, and conditions from what you said.
        </p>
      </div>

      <div aria-hidden="true">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Draft preview
        </p>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex flex-col gap-1.5">
              <div className="h-2 w-16 rounded-full bg-zinc-200 dark:bg-depth-3" />
              <div
                className={`h-9 w-full rounded-xl bg-zinc-100 dark:bg-depth-2 ${
                  prefersReducedMotion ? "" : "animate-pulse"
                }`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onFallBackToManual}
          className="min-h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-depth-border dark:text-zinc-300 dark:hover:bg-depth-2"
        >
          Cancel and enter manually
        </button>
        <p className="max-w-72 text-center text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          Taking longer than usual? You can switch to manual entry anytime — the same structured log, just typed.
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 text-xs font-medium text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          Discard this recording
        </button>
      </div>
    </section>
  );
}
