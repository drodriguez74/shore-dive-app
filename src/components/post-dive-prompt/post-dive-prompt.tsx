"use client";

/**
 * Single-tap condition-logging prompt (→ TASKS.md T14.2).
 *
 * Deliberately NOT a full-screen takeover — per CLAUDE.md's Product section
 * ("avoid noisy/growth-hacky patterns") and plan.md's zero-noise framing for
 * Map-Driven Exploration, this renders as a small, low-friction card that
 * can be dismissed in one tap without logging anything. Fields are
 * intentionally minimal (visibility, current, one marine-life yes/no) — this
 * is the "micro" prompt from plan.md's Task 14, not the full structured
 * voice-logging entry (max depth, runtime, etc.) from a different pillar.
 *
 * Persistence: localStorage only for now, via `storage.ts`. See that file's
 * TODO for the pending Supabase migration — this UI surfaces that
 * limitation to the user in one short line rather than hiding it.
 */

import { useId, useState } from "react";
import { savePostDiveConditionLog } from "./storage";
import {
  CURRENT_OPTIONS,
  VISIBILITY_OPTIONS,
  type CurrentStrength,
  type PostDiveConditionLog,
  type VisibilityRating,
} from "./types";
import type { PostDivePromptTriggerSource } from "@/hooks/use-post-dive-prompt-trigger";

export interface PostDivePromptProps {
  /** What caused this prompt to be shown — persisted with the log for later trigger-tuning. */
  source: PostDivePromptTriggerSource;
  /** Site the log pertains to, if known from an active dive plan. */
  siteId?: string | null;
  /** Dismiss without saving anything. */
  onDismiss: () => void;
  /** Called after a successful save. */
  onLogged?: (entry: PostDiveConditionLog) => void;
  className?: string;
}

function ChipGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{legend}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={legend}>
        {options.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(selected ? null : opt.value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                selected
                  ? "border-sky-500 bg-sky-500/15 text-sky-700 dark:border-sky-400 dark:bg-sky-400/15 dark:text-sky-300"
                  : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PostDivePrompt({ source, siteId = null, onDismiss, onLogged, className = "" }: PostDivePromptProps) {
  const [visibility, setVisibility] = useState<VisibilityRating | null>(null);
  const [current, setCurrent] = useState<CurrentStrength | null>(null);
  const [sawMarineLife, setSawMarineLife] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const headingId = useId();

  const hasAnySelection = visibility !== null || current !== null || sawMarineLife !== null;

  const handleLog = () => {
    setSaving(true);
    try {
      const entry = savePostDiveConditionLog({
        siteId,
        visibility,
        current,
        sawNotableMarineLife: sawMarineLife,
        source,
      });
      onLogged?.(entry);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby={headingId}
      className={`w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-black dark:text-zinc-50">
            Log dive conditions?
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Looks like you just wrapped up a dive. Quick tap, or skip it.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss without logging"
          className="shrink-0 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        <ChipGroup legend="Visibility" options={VISIBILITY_OPTIONS} value={visibility} onChange={setVisibility} />
        <ChipGroup legend="Current" options={CURRENT_OPTIONS} value={current} onChange={setCurrent} />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Notable marine life?</legend>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Notable marine life sighting">
            {([
              { value: true, label: "Yes" },
              { value: false, label: "No" },
            ] as const).map((opt) => {
              const selected = sawMarineLife === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSawMarineLife(selected ? null : opt.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    selected
                      ? "border-sky-500 bg-sky-500/15 text-sky-700 dark:border-sky-400 dark:bg-sky-400/15 dark:text-sky-300"
                      : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
        Saved on this device only for now — not yet synced to an account. TODO: migrate to Supabase once dive logs
        have a real backend.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={handleLog}
          disabled={!hasAnySelection || saving}
          className="flex-1 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400"
        >
          {saving ? "Saving…" : "Log conditions"}
        </button>
      </div>
    </div>
  );
}
