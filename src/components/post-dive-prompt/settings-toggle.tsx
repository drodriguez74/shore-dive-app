"use client";

/**
 * Settings toggle UI for T14.3 — wraps `usePostDivePromptSettings`. There's
 * no real settings page/architecture in this app yet (per CLAUDE.md, that's
 * future work), so this is a small, self-contained switch a future settings
 * page can mount as-is, not a placeholder to be rebuilt later.
 *
 * Turning this off only silences the *automatic* (inference-based) prompt —
 * `use-post-dive-prompt-trigger.ts`'s `showManually()` path is unaffected,
 * so manual logging keeps working regardless, per plan.md's Task 14 spec.
 */

import { usePostDivePromptSettings } from "@/hooks/use-post-dive-prompt-settings";

export function PostDivePromptSettingsToggle({ className = "" }: { className?: string }) {
  const { autoPromptEnabled, setAutoPromptEnabled, isHydrated } = usePostDivePromptSettings();

  return (
    <div
      className={`flex items-start justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <div>
        <p className="text-sm font-medium text-black dark:text-zinc-50">Auto-prompt for dive conditions</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          When on, Shore Dive may show a quick conditions-logging prompt after a Safe-Return check-in or a completed
          dive plan. Turning this off only disables the automatic prompt — you can still log conditions manually
          anytime.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={autoPromptEnabled}
        aria-label="Auto-prompt for dive conditions"
        disabled={!isHydrated}
        onClick={() => setAutoPromptEnabled(!autoPromptEnabled)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          autoPromptEnabled ? "bg-sky-600 dark:bg-sky-500" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            autoPromptEnabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
