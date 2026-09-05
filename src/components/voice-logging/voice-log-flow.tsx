"use client";

/**
 * The voice-logging flow, rendered as one surface that swaps screens with
 * the machine's state.
 *
 * This component is deliberately thin — it maps `state.status` to a screen
 * and holds the editable draft. Every decision it might otherwise have made
 * lives in a tested pure module: transitions in `machine.ts`, capability in
 * `stt-support.ts`, extraction in `parse-transcript.ts`, lineage in
 * `field-tags.ts`. The exhaustive switch below is the whole of its logic,
 * which is the point: `use-post-dive-prompt-trigger.ts` set the precedent
 * that meaningful decisions don't live inline in components.
 *
 * ## Two exports, because the settings panel drives the same flow
 *
 * Mockup 06's "Log a dive now" button has to open the *same* form instance
 * this component renders, not a second one. So the flow is split:
 *
 * - `VoiceLogFlowView` takes an already-created flow object, letting a page
 *   own the hook and wire other controls (a settings button, a trigger
 *   card) to the same `startManual` / `startVoice`.
 * - `VoiceLogFlow` is the convenience wrapper that creates its own flow,
 *   for the common case where nothing outside needs to drive it.
 *
 * The alternative — an imperative ref handle — would have hidden the same
 * capability behind a less obvious API for no benefit.
 *
 * ## Why the draft is held here and not in the machine
 *
 * The machine stores `initialDraft` — the parser's frozen output — because
 * that's the baseline the "Edited" tags compare against, and it must not
 * move. The *live, being-typed* draft is ordinary component state, reseeded
 * whenever a form is entered. Keeping them separate is what makes
 * `computeFieldTag` meaningful; folding the live draft into the machine
 * would mean every keystroke dispatched a transition and the baseline would
 * have to be duplicated anyway.
 *
 * ## Permission wait
 *
 * `requesting-permission` renders a small waiting card rather than nothing.
 * The browser's own permission prompt is modal and obvious, but on a repeat
 * visit where permission is already granted this state can flash by in a
 * few hundred milliseconds — rendering nothing would make the offer buttons
 * appear to vanish and come back.
 */

import { useCallback, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useVoiceLogFlow, type UseVoiceLogFlowOptions, type UseVoiceLogFlowResult } from "@/hooks/use-voice-log-flow";
import { emptyDiveLogDraft, type DiveLogDraft } from "@/lib/voice-logging/types";
import { DiveLogForm } from "./dive-log-form";
import { ProcessingView } from "./processing-view";
import { RecordingView } from "./recording-view";
import { SavedView } from "./saved-view";
import { VoiceLogOffer } from "./voice-log-offer";

export interface VoiceLogFlowViewProps {
  flow: UseVoiceLogFlowResult;
  /** Site name to seed a manual draft with. Must match what was passed to the hook. */
  siteName?: string;
  className?: string;
}

export function VoiceLogFlowView({ flow, siteName = "", className = "" }: VoiceLogFlowViewProps) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const [draft, setDraft] = useState<DiveLogDraft>(() => emptyDiveLogDraft(siteName));
  // Identifies which form instance the current `draft` belongs to. Entering
  // a form seeds the draft exactly once; without this key the seeding would
  // either re-run on every render (wiping keystrokes) or need an effect
  // (which would trip react-hooks/set-state-in-effect).
  const [draftKey, setDraftKey] = useState<string | null>(null);

  const { state } = flow;
  const { status } = state;

  // Seed the draft on the first render of a given form instance, using the
  // "adjust state while rendering" pattern React documents for derived
  // state. Legal here because it's a pure comparison of two state values —
  // no clock, storage, or browser API involved (the same constraint
  // `use-post-dive-prompt-trigger.ts`'s header discusses when explaining
  // why *its* edge detection could not use this pattern).
  if (state.status === "confirm-edit" && draftKey !== `voice:${state.transcript}`) {
    setDraftKey(`voice:${state.transcript}`);
    setDraft(state.initialDraft);
  } else if (state.status === "manual-entry" && draftKey !== `manual:${state.reason}`) {
    setDraftKey(`manual:${state.reason}`);
    setDraft(emptyDiveLogDraft(siteName));
  }

  const handleSave = useCallback(() => flow.save(draft), [flow, draft]);

  return (
    <div className={className}>
      {status === "idle" && (
        <VoiceLogOffer support={flow.sttSupport} onRecord={flow.startVoice} onTypeItIn={flow.startManual} />
      )}

      {status === "requesting-permission" && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-depth-border dark:bg-depth-1"
        >
          <span
            className={`h-4 w-4 shrink-0 rounded-full border-2 border-zinc-200 border-t-sky-500 dark:border-depth-3 dark:border-t-sky-400 ${
              prefersReducedMotion ? "" : "animate-spin"
            }`}
          />
          <div>
            <p className="text-sm font-medium text-black dark:text-zinc-50">Waiting for microphone access</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              If your browser asks, allow the microphone. If you&apos;d rather not, you can type the log instead.
            </p>
          </div>
        </div>
      )}

      {state.status === "recording" && (
        <RecordingView
          elapsedMs={flow.elapsedMs}
          level={flow.level}
          interimTranscript={flow.interimTranscript}
          prefersReducedMotion={prefersReducedMotion}
          onStop={flow.stopRecording}
          onCancel={flow.cancel}
        />
      )}

      {state.status === "processing" && (
        <ProcessingView
          recordingMs={state.recordingMs}
          prefersReducedMotion={prefersReducedMotion}
          onFallBackToManual={flow.fallBackToManual}
          onCancel={flow.cancel}
        />
      )}

      {state.status === "confirm-edit" && (
        <DiveLogForm
          mode="confirm-edit"
          draft={draft}
          onChange={setDraft}
          onSave={handleSave}
          onCancel={flow.cancel}
          initialDraft={state.initialDraft}
          transcribedFields={state.transcribedFields}
          transcript={state.transcript}
          privacyMode={state.privacyMode}
        />
      )}

      {state.status === "manual-entry" && (
        <DiveLogForm
          mode="manual-entry"
          draft={draft}
          onChange={setDraft}
          onSave={handleSave}
          onCancel={flow.cancel}
          manualEntryReason={state.reason}
        />
      )}

      {state.status === "saved" && (
        <SavedView entry={state.entry} onDone={flow.reset} onLogAnother={flow.startManual} />
      )}
    </div>
  );
}

export interface VoiceLogFlowProps extends UseVoiceLogFlowOptions {
  className?: string;
}

/** Self-contained flow, for callers that don't need to drive it from outside. */
export function VoiceLogFlow({ className, ...flowOptions }: VoiceLogFlowProps) {
  const flow = useVoiceLogFlow(flowOptions);
  return <VoiceLogFlowView flow={flow} siteName={flowOptions.siteName} className={className} />;
}
