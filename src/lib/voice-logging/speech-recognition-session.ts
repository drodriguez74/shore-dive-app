/**
 * Web Speech API boundary — every interaction with `SpeechRecognition`
 * lives here, behind a callback interface, with no React in sight.
 *
 * CLAUDE.md's engineering standards require wrapping "every I/O and
 * browser-API boundary... microphone, Notification/Push". Isolating it in
 * plain TS also keeps the hook that consumes it readable, and lets the
 * genuinely pure parts (error classification) be unit-tested in the Node
 * environment without a jsdom shim for an API jsdom doesn't implement.
 *
 * ## Minimal local type declarations
 *
 * TypeScript's `lib.dom.d.ts` ships `SpeechRecognitionResult` and
 * `SpeechRecognitionResultList` but **not** `SpeechRecognition`,
 * `SpeechRecognitionEvent`, or `SpeechRecognitionErrorEvent` (verified
 * against this repo's installed TypeScript, not assumed). So the missing
 * three are declared here structurally. They are deliberately narrow —
 * only the members actually used — because a wider hand-written
 * declaration is a lie waiting to be believed once the real lib types land.
 *
 * ## Three failure modes this has to survive, none of them theoretical
 *
 * 1. **Events arrive after `abort()`.** The spec does not promise the
 *    engine stops emitting the instant you ask. Every callback here checks
 *    a `disposed` flag first, and `machine.ts` ignores unknown events for
 *    the same reason — belt and braces, since a resurrected recording
 *    screen would be a genuinely confusing bug to diagnose from the field.
 * 2. **`onend` fires early, mid-dive-description.** Several engines end the
 *    session on a silence gap even with `continuous = true`. A diver
 *    pausing to think would silently lose the rest of their log. Handled by
 *    a *bounded* auto-restart — bounded because an unbounded one turns a
 *    permanently-failing engine into a hot loop hammering the mic.
 * 3. **`onend` never fires after `stop()`.** Then the processing screen
 *    spins forever, which is the exact "silently fail or hang" outcome
 *    CLAUDE.md forbids. Handled by `stop()` arming a watchdog that resolves
 *    with whatever text was accumulated. Partial text beats a dead screen —
 *    and it still goes to confirm/edit, so nothing unreviewed is saved.
 */

import { logger } from "./logger";
import {
  detectSpeechRecognitionSupport,
  resolveTranscriptionPrivacyMode,
  type OnDeviceAvailability,
} from "./stt-support";
import type { TranscriptionFailureReason } from "./machine";
import type { TranscriptionPrivacyMode } from "./types";

// --- Minimal structural declarations (see header) -------------------------

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  /** Chrome 138+ only. Requesting local processing when unavailable errors rather than silently falling back. */
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  onstart: ((event: Event) => void) | null;
}

interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
  availableOnDevice?: (lang: string) => Promise<OnDeviceAvailability>;
}

interface SpeechRecognitionCapableWindow {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
}

// --- Error classification (pure, tested) ----------------------------------

/**
 * Map a `SpeechRecognitionErrorEvent.error` code to the reason the
 * manual-entry screen will explain itself with.
 *
 * `aborted` maps to `null` on purpose: it is what fires when *we* called
 * `abort()` because the diver cancelled. Treating a user-initiated cancel
 * as a failure would show an explanation for something that didn't go
 * wrong — the exact apologetic tone `creative/flows/voice-logging.md`
 * rejects.
 *
 * Unknown codes fall through to `stt-failed` rather than being assumed
 * benign, so a future browser's new error code degrades to manual entry
 * instead of leaving the diver on a stalled screen.
 */
export function classifySpeechRecognitionError(code: string): TranscriptionFailureReason | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "mic-denied";
    case "audio-capture":
      return "mic-unavailable";
    case "no-speech":
      return "no-speech";
    default:
      return "stt-failed";
  }
}

// --- Session --------------------------------------------------------------

export interface SpeechRecognitionSessionCallbacks {
  /** Live transcript updates for the recording screen. `interim` is unstable and must never be parsed. */
  onTranscriptUpdate?: (finalText: string, interimText: string) => void;
  /** Recognition finished normally. `transcript` may legitimately be empty. */
  onComplete: (transcript: string) => void;
  /** Recognition failed in a way that should route to manual entry. */
  onFailure: (reason: TranscriptionFailureReason, code: string) => void;
}

export interface SpeechRecognitionSessionOptions extends SpeechRecognitionSessionCallbacks {
  lang?: string;
  /** Ceiling on silence-gap restarts. See failure mode 2 in the header. */
  maxRestarts?: number;
  /** How long to wait for `onend` after `stop()` before force-resolving. See failure mode 3. */
  stopTimeoutMs?: number;
}

export interface SpeechRecognitionSession {
  /** Where recognition actually ran — for the honest privacy disclosure. */
  readonly privacyMode: TranscriptionPrivacyMode;
  /** Graceful finish: flush, then fire `onComplete` (watchdog-backed). */
  stop(): void;
  /** Discard: no callback fires after this returns. */
  abort(): void;
}

const DEFAULT_LANG = "en-US";
const DEFAULT_MAX_RESTARTS = 5;
const DEFAULT_STOP_TIMEOUT_MS = 4000;

function resolveConstructor(win: SpeechRecognitionCapableWindow): SpeechRecognitionConstructorLike | null {
  const support = detectSpeechRecognitionSupport(win);
  if (support.globalName === "SpeechRecognition") return win.SpeechRecognition ?? null;
  if (support.globalName === "webkitSpeechRecognition") return win.webkitSpeechRecognition ?? null;
  return null;
}

/**
 * Ask whether an on-device speech model is actually installed for `lang`.
 *
 * Wrapped in try/catch and tolerant of the method being absent entirely,
 * which is the common case: this is a Chrome 138+ surface. A rejection, a
 * throw, or an absence all resolve to `null`, which
 * `resolveTranscriptionPrivacyMode` turns into `"unknown"` — never into an
 * optimistic `"on-device"`.
 */
async function probeOnDeviceAvailability(
  ctor: SpeechRecognitionConstructorLike,
  lang: string,
): Promise<OnDeviceAvailability | null> {
  if (typeof ctor.availableOnDevice !== "function") return null;
  try {
    return await ctor.availableOnDevice(lang);
  } catch (err) {
    logger.debug("stt.on-device-probe-failed", { error: String(err) });
    return null;
  }
}

/**
 * Start a recognition session.
 *
 * Returns `null` when the API isn't available at all — callers treat that
 * as `stt-unsupported` and route to manual entry. Never throws.
 */
export async function startSpeechRecognitionSession(
  options: SpeechRecognitionSessionOptions,
): Promise<SpeechRecognitionSession | null> {
  if (typeof window === "undefined") return null;

  const lang = options.lang ?? DEFAULT_LANG;
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

  const ctor = resolveConstructor(window as unknown as SpeechRecognitionCapableWindow);
  if (!ctor) {
    logger.info("stt.unsupported", { reason: "no-constructor" });
    return null;
  }

  const availability = await probeOnDeviceAvailability(ctor, lang);
  const privacyMode = resolveTranscriptionPrivacyMode(availability);

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new ctor();
  } catch (err) {
    logger.warn("stt.construct-failed", { error: String(err) });
    return null;
  }

  let disposed = false;
  let stopRequested = false;
  let restarts = 0;
  let finalText = "";
  let stopWatchdog: ReturnType<typeof setTimeout> | null = null;

  const clearWatchdog = () => {
    if (stopWatchdog !== null) {
      clearTimeout(stopWatchdog);
      stopWatchdog = null;
    }
  };

  const dispose = () => {
    disposed = true;
    clearWatchdog();
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.onstart = null;
  };

  const complete = () => {
    if (disposed) return;
    const transcript = finalText.trim();
    dispose();
    options.onComplete(transcript);
  };

  const fail = (reason: TranscriptionFailureReason, code: string) => {
    if (disposed) return;
    dispose();
    options.onFailure(reason, code);
  };

  try {
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    // Only opt into local processing when the probe confirmed a model is
    // installed. Setting it optimistically makes Chrome error the session
    // out with `language-not-supported` instead of falling back — trading a
    // working transcription for a privacy claim we'd then have to walk back.
    if (privacyMode === "on-device") {
      recognition.processLocally = true;
    }
  } catch (err) {
    logger.warn("stt.configure-failed", { error: String(err) });
  }

  recognition.onresult = (event) => {
    if (disposed) return;
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const alternative = result[0];
      if (!alternative) continue;
      if (result.isFinal) {
        finalText += (finalText === "" ? "" : " ") + alternative.transcript.trim();
      } else {
        interim += alternative.transcript;
      }
    }
    options.onTranscriptUpdate?.(finalText, interim.trim());
  };

  recognition.onerror = (event) => {
    if (disposed) return;
    const code = event.error ?? "unknown";
    const reason = classifySpeechRecognitionError(code);
    // `no-speech` is only terminal if we have nothing at all. Mid-session
    // it's a silence gap, and `onend`'s restart path handles it.
    if (reason === "no-speech" && !stopRequested && finalText.trim() !== "") {
      logger.debug("stt.no-speech-gap", { restarts });
      return;
    }
    if (reason === null) {
      logger.debug("stt.aborted", {});
      return;
    }
    logger.warn("stt.error", { code, reason });
    fail(reason, code);
  };

  recognition.onend = () => {
    if (disposed) return;

    if (stopRequested) {
      complete();
      return;
    }

    // Ended on its own — a silence gap, most likely. Resume, bounded.
    if (restarts < maxRestarts) {
      restarts += 1;
      try {
        recognition.start();
        logger.debug("stt.restarted", { restarts });
        return;
      } catch (err) {
        logger.warn("stt.restart-failed", { restarts, error: String(err) });
      }
    }

    // Out of restarts, or the restart threw. Whatever was captured still
    // goes to confirm/edit rather than being discarded.
    complete();
  };

  try {
    recognition.start();
  } catch (err) {
    logger.warn("stt.start-failed", { error: String(err) });
    dispose();
    return null;
  }

  logger.info("stt.started", { lang, privacyMode, onDeviceAvailability: availability ?? "unreported" });

  return {
    privacyMode,
    stop() {
      if (disposed || stopRequested) return;
      stopRequested = true;
      // Watchdog first, then stop() — if stop() throws synchronously the
      // watchdog is already armed and the diver still gets a resolution.
      stopWatchdog = setTimeout(() => {
        logger.warn("stt.stop-timeout", { stopTimeoutMs, transcriptLength: finalText.trim().length });
        complete();
      }, stopTimeoutMs);
      try {
        recognition.stop();
      } catch (err) {
        logger.warn("stt.stop-failed", { error: String(err) });
      }
    },
    abort() {
      if (disposed) return;
      dispose();
      try {
        recognition.abort();
      } catch (err) {
        logger.debug("stt.abort-failed", { error: String(err) });
      }
    },
  };
}
