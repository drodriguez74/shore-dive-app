/**
 * The voice-logging state machine — a pure reducer, extracted from the UI so
 * the one rule that actually matters can be *proved* rather than reviewed.
 *
 * ## The rule
 *
 * CLAUDE.md: "Transcribed fields require a confirm/edit step before saving —
 * never auto-commit." `creative/flows/voice-logging.md` calls this a hard
 * gate and enforces it three redundant ways, the first of which is
 * structural: "there is no code path in the flow diagram from `Processing`
 * to `Saved` that skips `ConfirmEdit` — the only edges into `Saved`
 * originate from `ConfirmEdit` or `ManualEntry`."
 *
 * A diagram can say that. Only a machine can guarantee it. So `saved` is
 * reachable from exactly one event (`SAVE`) in exactly two states
 * (`confirm-edit`, `manual-entry`), and `machine.test.ts` asserts it by
 * brute force — every state crossed with every event — rather than by
 * testing the happy paths someone thought to write down. If a future edit
 * adds a shortcut, that exhaustive test fails; a hand-written test for the
 * paths the author had in mind would not.
 *
 * ## Why a reducer instead of a handful of `useState` flags
 *
 * The flow has seven states and eleven events, and several transitions are
 * genuinely non-obvious (a `no-speech` result and a `stt-failed` result both
 * land on manual entry, but carry different copy; cancelling from
 * `processing` is a *different* destination than cancelling from
 * `recording`). Encoding that as booleans in a component would put the
 * feature's real decision logic somewhere untestable, which this repo's
 * `use-post-dive-prompt-trigger.ts` already established as the wrong shape —
 * its `evaluatePostDiveTrigger()` is pure for exactly this reason.
 *
 * ## Unknown events are ignored, not thrown on
 *
 * Every unmatched (state, event) pair returns the *same object reference*
 * back. That makes the reducer safe to call from a `useReducer` under React
 * strict-mode double-invocation, and means a stray late callback (a
 * `SpeechRecognition.onend` firing after the diver already cancelled) is a
 * no-op rather than a crash or a resurrected screen — a real ordering
 * hazard here, since browser speech events are not guaranteed to stop
 * arriving the instant `abort()` is called.
 */

import type { DiveLogDraft, DiveLogEntry, DiveLogFieldName, TranscriptionPrivacyMode } from "./types";

/**
 * Why the diver ended up on the manual-entry form.
 *
 * This is not an error code. `creative/flows/voice-logging.md` is emphatic
 * that manual entry is "first-class, not an apology screen" — the reason
 * exists to select one honest sentence of explanation (or none at all, for
 * `user-choice`), never to render a failure state.
 */
export type ManualEntryReason =
  /** The diver picked "Type it in". No explanation is shown — none is owed. */
  | "user-choice"
  /** No `SpeechRecognition` constructor. The iOS Safari case CLAUDE.md names. */
  | "stt-unsupported"
  /** Mic permission denied or blocked at the OS/browser level. */
  | "mic-denied"
  /** Permission fine, but no usable capture device (unplugged, in use elsewhere). */
  | "mic-unavailable"
  /** Recognition ran but returned nothing usable. */
  | "no-speech"
  /** Recognition errored for any other reason (network, service, decode). */
  | "stt-failed"
  /** The diver bailed out of the processing wait — mockup 03's escape hatch. */
  | "left-processing";

/**
 * The subset of reasons a *capture or recognition* failure can produce.
 *
 * Narrower than `ManualEntryReason` on purpose: `user-choice`,
 * `stt-unsupported`, and `left-processing` are all things the diver or the
 * feature-detector decided, not things a browser API reported. Keeping the
 * failure channel narrow means the compiler rejects a call site that tries
 * to report "the diver chose to type" as a transcription error, which would
 * put an unearned explanation on a first-class screen.
 */
export type TranscriptionFailureReason = Extract<
  ManualEntryReason,
  "mic-denied" | "mic-unavailable" | "no-speech" | "stt-failed"
>;

export type VoiceLogStatus =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "processing"
  | "confirm-edit"
  | "manual-entry"
  | "saved";

export type VoiceLogState =
  | { status: "idle" }
  | { status: "requesting-permission" }
  | { status: "recording"; startedAt: number }
  | { status: "processing"; recordingMs: number }
  | {
      status: "confirm-edit";
      transcript: string;
      /** Parser output, frozen at entry — the baseline `edited` tags compare against. */
      initialDraft: DiveLogDraft;
      /** Fields the parser populated; candidates for a "Transcribed" tag. */
      transcribedFields: DiveLogFieldName[];
      recordingMs: number;
      privacyMode: TranscriptionPrivacyMode;
    }
  | { status: "manual-entry"; reason: ManualEntryReason }
  | { status: "saved"; entry: DiveLogEntry };

export type VoiceLogEvent =
  /** Offer screen: "Record voice log". Carries live capability, re-detected at tap time. */
  | { type: "START_VOICE"; sttSupported: boolean }
  /** Offer screen: "Type it in". */
  | { type: "START_MANUAL" }
  | { type: "PERMISSION_GRANTED"; startedAt: number }
  | { type: "PERMISSION_DENIED"; reason: Extract<ManualEntryReason, "mic-denied" | "mic-unavailable"> }
  | { type: "STOP_RECORDING"; recordingMs: number }
  | {
      type: "TRANSCRIPT_READY";
      transcript: string;
      initialDraft: DiveLogDraft;
      transcribedFields: DiveLogFieldName[];
      privacyMode: TranscriptionPrivacyMode;
    }
  | { type: "TRANSCRIPT_FAILED"; reason: TranscriptionFailureReason }
  /** Mockup 03's "Cancel and enter manually" — keeps the diver moving forward. */
  | { type: "FALL_BACK_TO_MANUAL" }
  /** Cancel/discard. Returns to the offer screen with nothing kept. */
  | { type: "CANCEL" }
  /** The only event that can ever produce `saved`. */
  | { type: "SAVE"; entry: DiveLogEntry }
  /** Dismiss the saved confirmation and return to the offer screen. */
  | { type: "RESET" };

export const INITIAL_VOICE_LOG_STATE: VoiceLogState = { status: "idle" };

/**
 * The two states from which a save is permitted. Exported so the exhaustive
 * test can assert against a named constant rather than restating the rule
 * (a test that restates the rule from memory can drift with the code; one
 * that reads it from the module cannot).
 */
export const SAVE_PERMITTED_FROM: readonly VoiceLogStatus[] = ["confirm-edit", "manual-entry"] as const;

export function voiceLogReducer(state: VoiceLogState, event: VoiceLogEvent): VoiceLogState {
  switch (state.status) {
    case "idle": {
      if (event.type === "START_VOICE") {
        // The unsupported branch never enters the recording path at all —
        // it routes straight to manual entry, so the diver never taps a
        // control that was always going to fail. This is the flow doc's
        // "the card detects this up front and swaps the CTA" rule, enforced
        // here as well as in the offer component's label, because the label
        // is cosmetic and this is not.
        return event.sttSupported
          ? { status: "requesting-permission" }
          : { status: "manual-entry", reason: "stt-unsupported" };
      }
      if (event.type === "START_MANUAL") {
        return { status: "manual-entry", reason: "user-choice" };
      }
      return state;
    }

    case "requesting-permission": {
      if (event.type === "PERMISSION_GRANTED") {
        return { status: "recording", startedAt: event.startedAt };
      }
      if (event.type === "PERMISSION_DENIED") {
        return { status: "manual-entry", reason: event.reason };
      }
      if (event.type === "CANCEL") return INITIAL_VOICE_LOG_STATE;
      return state;
    }

    case "recording": {
      if (event.type === "STOP_RECORDING") {
        return { status: "processing", recordingMs: event.recordingMs };
      }
      // A permission revocation or device failure mid-recording surfaces as
      // TRANSCRIPT_FAILED from the recognition layer; honour it here too
      // rather than stranding the diver on a live-looking recording screen.
      if (event.type === "TRANSCRIPT_FAILED") {
        return { status: "manual-entry", reason: event.reason };
      }
      if (event.type === "FALL_BACK_TO_MANUAL") {
        return { status: "manual-entry", reason: "user-choice" };
      }
      if (event.type === "CANCEL") return INITIAL_VOICE_LOG_STATE;
      return state;
    }

    case "processing": {
      if (event.type === "TRANSCRIPT_READY") {
        return {
          status: "confirm-edit",
          transcript: event.transcript,
          initialDraft: event.initialDraft,
          transcribedFields: event.transcribedFields,
          recordingMs: state.recordingMs,
          privacyMode: event.privacyMode,
        };
      }
      if (event.type === "TRANSCRIPT_FAILED") {
        return { status: "manual-entry", reason: event.reason };
      }
      if (event.type === "FALL_BACK_TO_MANUAL") {
        return { status: "manual-entry", reason: "left-processing" };
      }
      if (event.type === "CANCEL") return INITIAL_VOICE_LOG_STATE;
      // Note the absence of a SAVE case. This is the structural half of the
      // confirm/edit gate — see the module header.
      return state;
    }

    case "confirm-edit": {
      if (event.type === "SAVE") return { status: "saved", entry: event.entry };
      if (event.type === "CANCEL") return INITIAL_VOICE_LOG_STATE;
      return state;
    }

    case "manual-entry": {
      if (event.type === "SAVE") return { status: "saved", entry: event.entry };
      if (event.type === "CANCEL") return INITIAL_VOICE_LOG_STATE;
      return state;
    }

    case "saved": {
      if (event.type === "RESET" || event.type === "CANCEL") return INITIAL_VOICE_LOG_STATE;
      if (event.type === "START_MANUAL") return { status: "manual-entry", reason: "user-choice" };
      if (event.type === "START_VOICE") {
        return event.sttSupported
          ? { status: "requesting-permission" }
          : { status: "manual-entry", reason: "stt-unsupported" };
      }
      return state;
    }
  }
}

/**
 * The honest one-liner shown above the manual-entry form, or null when no
 * explanation is owed.
 *
 * Tone rules, taken from `creative/flows/voice-logging.md` and mockup 05 and
 * enforced by `machine.test.ts`: state the limitation once, plainly, then
 * pivot to capability. No apology, no "failed", no retry nag. `user-choice`
 * returns null because a diver who *chose* to type does not need to be told
 * why they're typing.
 */
export function describeManualEntryReason(reason: ManualEntryReason): string | null {
  switch (reason) {
    case "user-choice":
      return null;
    case "stt-unsupported":
      return "Voice logging needs browser support this device doesn't have — common on iPhone Safari. Same structured log, just typed.";
    case "mic-denied":
      return "Shore Dive doesn't have microphone access on this browser. Same structured log, just typed.";
    case "mic-unavailable":
      return "No microphone was available to record with. Same structured log, just typed.";
    case "no-speech":
      return "The recording didn't pick up any speech. Same structured log, just typed.";
    case "stt-failed":
      return "Transcription didn't complete on this browser. Same structured log, just typed.";
    case "left-processing":
      return "Picking up where transcription left off — same structured log, just typed.";
  }
}

/** Heading for the structured form, which differs between the two paths. */
export function diveLogFormHeading(mode: "confirm-edit" | "manual-entry"): string {
  return mode === "confirm-edit" ? "Review your dive log" : "Log this dive";
}
