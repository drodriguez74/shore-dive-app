"use client";

/**
 * The "log the full dive" offer — the voice-offer section of mockup 01.
 *
 * ## The CTA swaps rather than failing
 *
 * `creative/flows/voice-logging.md`: "when `SpeechRecognition` is
 * undetected, the 'Record voice log' button doesn't just error out after a
 * tap — the card detects this up front and swaps the CTA to 'Log this
 * dive,' which routes straight to `ManualEntry`. This is the same
 * 'best-effort, disclosed honestly' pattern `CLAUDE.md` already requires for
 * offline caching, applied here to STT support instead of network
 * reachability."
 *
 * The swap is copy only. Behavioural correctness lives in `startVoice()`,
 * which re-detects synchronously at tap time — so a diver who taps during
 * the single pre-hydration frame, before capability is known, still lands
 * on manual entry rather than a recorder that was never going to work.
 * That's why `pending` renders the recording CTA rather than hiding it: the
 * optimistic label costs nothing when the pessimistic path is already safe.
 *
 * ## "Type it in" is a peer, not a fallback
 *
 * It sits beside the record button at the same size, always, on every
 * device — reachable directly rather than only after a failed voice
 * attempt. Manual entry being first-class is a stated design decision, and
 * demoting this to a text link would quietly undo it.
 */

import type { SpeechRecognitionSupport } from "@/lib/voice-logging/stt-support";
import { shouldOfferVoiceRecording } from "@/lib/voice-logging/stt-support";

export interface VoiceLogOfferProps {
  support: SpeechRecognitionSupport;
  onRecord: () => void;
  onTypeItIn: () => void;
  className?: string;
}

export function VoiceLogOffer({ support, onRecord, onTypeItIn, className = "" }: VoiceLogOfferProps) {
  const offerRecording = shouldOfferVoiceRecording(support);

  return (
    <div className={className}>
      <div className="flex items-center gap-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Log the full dive
        </span>
        <span className="h-px flex-1 bg-zinc-200 dark:bg-depth-border" aria-hidden="true" />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        Depth, runtime, and what you saw — talked through or typed in. You&apos;ll review everything before it saves.
      </p>

      <div className="mt-3 flex gap-2">
        {offerRecording ? (
          <button
            type="button"
            onClick={onRecord}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path
                d="M12 2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3ZM5 10a7 7 0 0 0 14 0M12 19v3"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Record voice log
          </button>
        ) : (
          // Routed through `onRecord` (i.e. `startVoice`), not `onTypeItIn`,
          // even though it lands on the same form. That's the flow
          // diagram's own edge — "Record voice log (SpeechRecognition
          // unsupported — CTA reads 'Log this dive' instead)" — and it
          // reaches manual entry carrying the `stt-unsupported` reason
          // rather than `user-choice`, which is what makes mockup 05's
          // capability note appear on the form. Wiring it to `onTypeItIn`
          // would silently swallow the explanation a diver is owed here,
          // while looking identical in every other respect.
          <button
            type="button"
            onClick={onRecord}
            className="flex min-h-12 flex-1 items-center justify-center rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            Log this dive
          </button>
        )}

        {offerRecording && (
          <button
            type="button"
            onClick={onTypeItIn}
            className="min-h-12 flex-1 rounded-xl border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-depth-border dark:text-zinc-300 dark:hover:bg-depth-2"
          >
            Type it in
          </button>
        )}
      </div>

      {/*
        No capability note here, deliberately. Mockup 01 swaps the CTA and
        says nothing more; mockup 05 carries the explanation on the form the
        diver lands on. Repeating it in both places would state the same
        limitation twice in two taps, which is the opposite of "state it
        once, plainly, then get out of the way."
      */}
    </div>
  );
}
