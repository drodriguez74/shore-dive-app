"use client";

/**
 * Orchestration hook for the voice-logging flow: owns the state machine,
 * both browser-API sessions, and the live values the recording screen
 * renders.
 *
 * The decision logic deliberately isn't here — `machine.ts` owns
 * transitions, `parse-transcript.ts` owns extraction, `field-tags.ts` owns
 * lineage, `stt-support.ts` owns capability, and all four are unit-tested
 * in isolation. What's left in this file is genuinely React-shaped work:
 * wiring async browser callbacks to `dispatch`, and tearing sessions down
 * without leaking a live microphone. That split mirrors
 * `use-post-dive-prompt-trigger.ts`, which keeps `evaluatePostDiveTrigger()`
 * pure and exported and lets the hook be a thin shell around it.
 *
 * ## Generation counter: the late-callback guard
 *
 * A diver cancelling mid-recording is not a rare path — it's mockup 02's
 * secondary action. But neither `SpeechRecognition` nor `MediaRecorder`
 * promises to stop emitting the instant it's aborted, and both hand back
 * results through callbacks captured at start time. Without a guard, a
 * recognition result arriving 200ms after a cancel would dispatch
 * `TRANSCRIPT_READY` and drag the diver into a confirm screen for a
 * recording they explicitly discarded.
 *
 * Every start bumps `generationRef`, every callback compares against it,
 * and a mismatch means "this belongs to a session the diver already walked
 * away from" — drop it silently. `machine.ts` ignoring unrecognised events
 * is the second line of defence for the same hazard.
 *
 * ## Dispatch ordering around stop
 *
 * `stopRecording()` dispatches `STOP_RECORDING` **before** asking the
 * speech session to stop. That order is required, not stylistic: the
 * reducer only accepts `TRANSCRIPT_READY` from `processing`, so if
 * recognition happened to complete synchronously inside `stop()`, a
 * reversed order would have the machine drop the transcript on the floor
 * and strand the diver on a live-looking recording screen. React processes
 * queued dispatches in order, so sequencing them here is sufficient.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  startAudioRecorderSession,
  type AudioRecorderSession,
} from "@/lib/voice-logging/audio-recorder-session";
import { collectDiveLogLineage } from "@/lib/voice-logging/field-tags";
import { logger } from "@/lib/voice-logging/logger";
import {
  INITIAL_VOICE_LOG_STATE,
  voiceLogReducer,
  type VoiceLogState,
} from "@/lib/voice-logging/machine";
import { parseDiveLogTranscript } from "@/lib/voice-logging/parse-transcript";
import {
  startSpeechRecognitionSession,
  type SpeechRecognitionSession,
} from "@/lib/voice-logging/speech-recognition-session";
import type { SpeechRecognitionSupport } from "@/lib/voice-logging/stt-support";
import { saveDiveLogEntry } from "@/lib/voice-logging/storage";
import type { DiveLogDraft, DiveLogEntry, TranscriptionPrivacyMode } from "@/lib/voice-logging/types";
import {
  readSpeechRecognitionSupport,
  useSpeechRecognitionSupport,
} from "@/hooks/use-speech-recognition-support";

/** How often the recording screen's clock and level meter refresh. */
const LIVE_SAMPLE_INTERVAL_MS = 120;

export interface UseVoiceLogFlowOptions {
  /** Dive site this log belongs to, when real dive-plan context supplies one. */
  siteId?: string | null;
  /** Site name to pre-fill. Never tagged "Transcribed" — it didn't come from speech. */
  siteName?: string;
  /** BCP-47 tag for recognition. Defaults to the session default in `speech-recognition-session.ts`. */
  lang?: string;
  /** Called after a successful save, e.g. to dismiss a host prompt. */
  onSaved?: (entry: DiveLogEntry) => void;
}

export interface UseVoiceLogFlowResult {
  state: VoiceLogState;
  /** Live recording elapsed time in ms. Zero outside the recording state. */
  elapsedMs: number;
  /** Live input level, 0..1, for the waveform. Zero when metering is unavailable. */
  level: number;
  /** Unstable in-progress recognition text. Display only — never parsed. */
  interimTranscript: string;
  /** Capability snapshot for copy and the settings row. Not the authority for behaviour. */
  sttSupport: SpeechRecognitionSupport;
  startVoice: () => void;
  startManual: () => void;
  stopRecording: () => void;
  /** Leave the voice path for manual entry without discarding progress. */
  fallBackToManual: () => void;
  cancel: () => void;
  save: (draft: DiveLogDraft) => void;
  reset: () => void;
}

export function useVoiceLogFlow(options: UseVoiceLogFlowOptions = {}): UseVoiceLogFlowResult {
  const { siteId = null, siteName = "", lang, onSaved } = options;

  const [state, dispatch] = useReducer(voiceLogReducer, INITIAL_VOICE_LOG_STATE);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState("");
  const sttSupport = useSpeechRecognitionSupport();

  const recorderRef = useRef<AudioRecorderSession | null>(null);
  const speechRef = useRef<SpeechRecognitionSession | null>(null);
  const transcriptRef = useRef("");
  const privacyModeRef = useRef<TranscriptionPrivacyMode>("unknown");
  const generationRef = useRef(0);
  const startedAtRef = useRef(0);

  /** Release both sessions and invalidate any callbacks still in flight. */
  const teardown = useCallback(() => {
    generationRef.current += 1;
    const speech = speechRef.current;
    const recorder = recorderRef.current;
    speechRef.current = null;
    recorderRef.current = null;
    speech?.abort();
    recorder?.cancel();
  }, []);

  // Releasing the microphone on unmount is not optional politeness: leaving
  // the tracks live keeps the browser's "using your microphone" indicator
  // on after the diver has navigated away.
  useEffect(() => teardown, [teardown]);

  const startVoice = useCallback(() => {
    // Re-detected synchronously at tap time rather than read from the
    // render snapshot — see use-speech-recognition-support.ts's header.
    const support = readSpeechRecognitionSupport();
    const supported = support.status === "supported";
    dispatch({ type: "START_VOICE", sttSupported: supported });
    if (!supported) {
      logger.info("flow.voice-unavailable", { reason: support.reason });
      return;
    }

    teardown();
    const generation = generationRef.current;
    transcriptRef.current = "";
    setInterimTranscript("");
    setElapsedMs(0);
    setLevel(0);

    void (async () => {
      const capture = await startAudioRecorderSession();
      if (generation !== generationRef.current) {
        if (capture.ok) capture.session.cancel();
        return;
      }
      if (!capture.ok) {
        dispatch({ type: "PERMISSION_DENIED", reason: capture.reason });
        return;
      }
      recorderRef.current = capture.session;

      const speech = await startSpeechRecognitionSession({
        lang,
        onTranscriptUpdate: (finalText, interim) => {
          if (generation !== generationRef.current) return;
          transcriptRef.current = finalText;
          setInterimTranscript(interim);
        },
        onComplete: (transcript) => {
          if (generation !== generationRef.current) return;
          transcriptRef.current = transcript;
          speechRef.current = null;

          const trimmed = transcript.trim();
          if (trimmed === "") {
            logger.info("flow.no-speech", {});
            dispatch({ type: "TRANSCRIPT_FAILED", reason: "no-speech" });
            return;
          }

          const parsed = parseDiveLogTranscript(trimmed, { site: siteName });
          logger.info("flow.transcript-parsed", {
            transcriptLength: trimmed.length,
            transcribedFields: parsed.transcribedFields,
          });
          dispatch({
            type: "TRANSCRIPT_READY",
            transcript: trimmed,
            initialDraft: parsed.draft,
            transcribedFields: parsed.transcribedFields,
            privacyMode: privacyModeRef.current,
          });
        },
        onFailure: (reason, code) => {
          if (generation !== generationRef.current) return;
          speechRef.current = null;
          recorderRef.current?.cancel();
          recorderRef.current = null;
          logger.warn("flow.transcription-failed", { reason, code });
          dispatch({ type: "TRANSCRIPT_FAILED", reason });
        },
      });

      if (generation !== generationRef.current) {
        speech?.abort();
        return;
      }

      if (!speech) {
        // Detection said supported but construction/start failed — a real
        // possibility on browsers that expose the constructor behind a
        // disabled flag. Route to manual entry rather than recording audio
        // that could never be transcribed.
        capture.session.cancel();
        recorderRef.current = null;
        logger.warn("flow.speech-session-unavailable", {});
        dispatch({ type: "TRANSCRIPT_FAILED", reason: "stt-failed" });
        return;
      }

      speechRef.current = speech;
      privacyModeRef.current = speech.privacyMode;
      startedAtRef.current = Date.now();
      dispatch({ type: "PERMISSION_GRANTED", startedAt: startedAtRef.current });
    })();
  }, [lang, siteName, teardown]);

  const startManual = useCallback(() => {
    teardown();
    dispatch({ type: "START_MANUAL" });
  }, [teardown]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    const speech = speechRef.current;
    const generation = generationRef.current;
    recorderRef.current = null;

    void (async () => {
      const fallbackDuration = Date.now() - startedAtRef.current;
      const result = recorder ? await recorder.stop() : { blob: null, durationMs: fallbackDuration };
      if (generation !== generationRef.current) return;

      // Ordering matters — see the module header.
      dispatch({ type: "STOP_RECORDING", recordingMs: result.durationMs });
      speech?.stop();
    })();
  }, []);

  const fallBackToManual = useCallback(() => {
    teardown();
    dispatch({ type: "FALL_BACK_TO_MANUAL" });
  }, [teardown]);

  const cancel = useCallback(() => {
    teardown();
    setElapsedMs(0);
    setLevel(0);
    setInterimTranscript("");
    dispatch({ type: "CANCEL" });
  }, [teardown]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const save = useCallback(
    (draft: DiveLogDraft) => {
      // The only two states a save is permitted from. Guarded here as well
      // as in the reducer so a mis-wired call site can't even build a
      // submission, let alone commit one.
      if (state.status !== "confirm-edit" && state.status !== "manual-entry") {
        logger.warn("flow.save-rejected", { status: state.status });
        return;
      }

      const fromVoice = state.status === "confirm-edit";
      const lineage = fromVoice
        ? collectDiveLogLineage(draft, state.initialDraft, state.transcribedFields)
        : { transcribedFields: [], editedFields: [] };

      const entry = saveDiveLogEntry({
        draft,
        siteId,
        entryMethod: fromVoice ? "voice" : "manual",
        transcribedFields: lineage.transcribedFields,
        editedFields: lineage.editedFields,
        transcript: fromVoice ? state.transcript : null,
        recordingMs: fromVoice ? state.recordingMs : null,
        transcriptionPrivacyMode: fromVoice ? state.privacyMode : null,
      });

      dispatch({ type: "SAVE", entry });
      onSaved?.(entry);
    },
    [state, siteId, onSaved],
  );

  // Live clock + level meter. Narrowed to a plain number first so the
  // effect's dependency is a primitive rather than the whole state union.
  const recordingStartedAt = state.status === "recording" ? state.startedAt : null;

  useEffect(() => {
    if (recordingStartedAt === null) return;

    const tick = () => {
      setElapsedMs(Date.now() - recordingStartedAt);
      setLevel(recorderRef.current?.getLevel() ?? 0);
    };

    // Interval callbacks are asynchronous, so these setState calls are
    // outside the effect's synchronous body and don't trip
    // react-hooks/set-state-in-effect — the same distinction documented in
    // use-geolocation.ts's setTimeout deferrals.
    const id = setInterval(tick, LIVE_SAMPLE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [recordingStartedAt]);

  return {
    state,
    elapsedMs,
    level,
    interimTranscript,
    sttSupport,
    startVoice,
    startManual,
    stopRecording,
    fallBackToManual,
    cancel,
    save,
    reset,
  };
}
