"use client";

import type { UseSafeReturnTimerResult } from "@/hooks/use-safe-return-timer";
import type { UsePostDivePromptTriggerResult } from "@/hooks/use-post-dive-prompt-trigger";
import { PostDivePrompt } from "@/components/post-dive-prompt";

interface CheckedInViewProps {
  timer: UseSafeReturnTimerResult;
  /**
   * Wired from `safe-return-timer.tsx`, which owns the `running ->
   * checked-in` edge detection (→ TASKS.md T14, plan.md v5 Priority Triage
   * #4). When the automatic trigger has fired (`visible === true`), the real
   * post-dive-prompt UI renders here as a quiet continuation of the
   * check-in confirmation — not a separate interruption. The manual
   * `showManually()` escape hatch stays reachable below regardless of
   * whether the auto-trigger fired, per T14.3.
   */
  postDivePrompt: UsePostDivePromptTriggerResult;
}

export function CheckedInView({ timer, postDivePrompt }: CheckedInViewProps) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center">
      <div className="rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-6 dark:border-emerald-400/40 dark:bg-emerald-400/10">
        <p className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
          Checked in — nice dive
          {timer.label ? `, ${timer.label}` : ""}.
        </p>
      </div>

      {postDivePrompt.visible ? (
        <PostDivePrompt
          source={postDivePrompt.source ?? "manual"}
          siteId={null}
          onDismiss={postDivePrompt.dismiss}
          onLogged={postDivePrompt.markLogged}
        />
      ) : (
        <button
          type="button"
          onClick={postDivePrompt.showManually}
          className="text-sm font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-700 dark:text-zinc-400 dark:decoration-zinc-700 dark:hover:text-zinc-200"
        >
          Log dive conditions
        </button>
      )}

      <button
        type="button"
        onClick={timer.reset}
        className="min-h-[48px] rounded-2xl bg-sky-600 px-6 py-3 text-sm font-semibold text-white"
      >
        Start a new timer
      </button>
    </div>
  );
}
