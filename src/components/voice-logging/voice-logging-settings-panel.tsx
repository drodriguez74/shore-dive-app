"use client";

/**
 * Post-dive logging settings — mockup 06.
 *
 * ## Judgment call: no new persisted preference was invented
 *
 * Mockup 06 has three sections, and reading them carefully, only one is a
 * *setting*:
 *
 * - **Automatic prompt** — the auto-prompt toggle, which already exists as
 *   `usePostDivePromptSettings` (T14.3). Composed here via the shipped
 *   `PostDivePromptSettingsToggle` rather than reimplemented, so there is
 *   one toggle and one storage key rather than two that can disagree.
 * - **Voice logging** — a *read-only capability row*. Whether the browser
 *   supports STT is a fact about the device, not a user preference; making
 *   it a toggle would let someone "turn on" something their browser can't
 *   do.
 * - **Manual entry** — an action, not a setting.
 *
 * So this panel deliberately adds **no new `localStorage`-backed
 * preference**. The `useSyncExternalStore` module-cache pattern used
 * throughout this repo is the right shape when a new preference is
 * genuinely needed; inventing one here to have something to persist would
 * add a key to migrate later in exchange for nothing. Flagged as a call
 * rather than made silently.
 *
 * ## The capability row states the real limitation
 *
 * It reports live detection, and its supporting line names iPhone Safari
 * explicitly and says what happens instead — the same "state the limitation
 * once, plainly, then get out of the way" tone the Safe-Return
 * degraded-capability screen established.
 */

import { PostDivePromptSettingsToggle } from "@/components/post-dive-prompt";
import { useSpeechRecognitionSupport } from "@/hooks/use-speech-recognition-support";
import { describeSpeechRecognitionSupport } from "@/lib/voice-logging/stt-support";

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500";
const CARD = "rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1";

export interface VoiceLoggingSettingsPanelProps {
  /** Opens the manual-entry form. Always available, regardless of the auto-prompt toggle. */
  onLogDiveNow: () => void;
  className?: string;
}

export function VoiceLoggingSettingsPanel({ onLogDiveNow, className = "" }: VoiceLoggingSettingsPanelProps) {
  const support = useSpeechRecognitionSupport();

  const statusTone =
    support.status === "supported"
      ? "text-emerald-600 dark:text-emerald-400"
      : support.status === "unsupported"
        ? "text-amber-600 dark:text-amber-400"
        : "text-zinc-500 dark:text-zinc-400";

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <p className={SECTION_LABEL}>Automatic prompt</p>
      <PostDivePromptSettingsToggle />
      <div className="flex gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-depth-border">
        <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Turning this off only disables the automatic prompt — you can still log a dive manually anytime below. It
          also never appears while a Safe-Return alarm may be sounding.
        </p>
      </div>

      <p className={`${SECTION_LABEL} mt-2`}>Voice logging</p>
      <div className={CARD}>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-zinc-400 dark:text-zinc-500" aria-hidden="true">
              <path
                d="M12 2a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3ZM5 10a7 7 0 0 0 14 0M12 19v3"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Speech-to-text
          </span>
          <span className={`text-xs font-semibold ${statusTone}`} role="status">
            {describeSpeechRecognitionSupport(support)}
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Your browser does the transcription — Shore Dive never uploads or stores your audio, and the review screen
          shows whether it ran on this device or on your browser vendor&apos;s servers. Unsupported on some browsers
          (notably iPhone Safari); when it&apos;s not available, &ldquo;Record voice log&rdquo; is replaced with manual
          entry automatically.
        </p>
      </div>

      <p className={`${SECTION_LABEL} mt-2`}>Manual entry</p>
      <div className={`${CARD} flex flex-col items-start gap-2.5`}>
        <p className="text-sm font-semibold text-black dark:text-zinc-50">Log a dive now</p>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          Open the same structured logbook entry — depth, runtime, marine life, conditions — without waiting for a
          prompt.
        </p>
        <button
          type="button"
          onClick={onLogDiveNow}
          className="min-h-12 w-full rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
        >
          Log a dive now
        </button>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Always available, even with auto-prompt off.</p>
      </div>
    </div>
  );
}
