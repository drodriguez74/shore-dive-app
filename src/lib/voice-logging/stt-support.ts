/**
 * Browser speech-recognition capability detection — pure, injectable, and
 * unit-tested, because this is the single highest-consequence branch in the
 * whole voice-logging feature.
 *
 * ## Why this is its own module rather than an inline `typeof` check
 *
 * CLAUDE.md's Product pillar is explicit: in-browser STT "is NOT reliably
 * supported on iOS Safari, and this MUST degrade gracefully to manual
 * entry there, not silently fail or hang." A one-line `typeof
 * window.webkitSpeechRecognition !== "undefined"` buried in a component is
 * untestable and, worse, silently wrong in a jsdom/SSR context where
 * `window` exists but the constructor doesn't. Extracting it makes the
 * decision table explicit and lets `stt-support.test.ts` assert the iOS
 * Safari shape (a real `window`, no constructor under either name) directly.
 *
 * ## Detection is synchronous, and callers must exploit that
 *
 * `detectSpeechRecognitionSupport()` needs no `await` and no effect. That
 * matters for correctness, not just ergonomics: the offer screen renders
 * before hydration resolves capability, so its *label* may briefly reflect
 * the SSR-safe `pending` default — but its *click handler* re-detects
 * synchronously at tap time, so a diver on iOS Safari is routed to manual
 * entry even if they tap during that first paint. The render-time snapshot
 * only ever controls copy; it is never the thing that decides behaviour.
 *
 * ## The privacy half: "on-device" is an assumption, not a fact
 *
 * The design mockups and THREAT_MODEL.md §3 both frame in-browser STT as
 * the privacy-preserving choice ("prefer on-device speech-to-text... so
 * logging actually works offline"). That framing is only conditionally
 * true, and the difference is material to §3's third finding — audio
 * containing a dive buddy's voice reaching a third party without consent.
 *
 * The Web Speech API does **not** guarantee local processing. Chrome has
 * historically streamed captured audio to a remote Google speech service,
 * and Safari's implementation is server-backed by default. Genuinely local
 * recognition only exists where Chrome 138+'s `processLocally` flag is
 * supported *and* `SpeechRecognition.availableOnDevice(lang)` reports the
 * language pack is actually installed.
 *
 * So this module exposes the on-device question as a separate, explicitly
 * three-valued answer (`on-device` / `browser-service` / `unknown`) that
 * the UI is required to disclose honestly, rather than letting the product
 * claim a guarantee the platform can't back — the same standard CLAUDE.md
 * already applies to the Safe-Return timer and offline-cache freshness.
 */

import type { TranscriptionPrivacyMode } from "./types";

/** The two globals a browser may expose the constructor under. */
export type SpeechRecognitionGlobalName = "SpeechRecognition" | "webkitSpeechRecognition";

/**
 * Structural stand-in for `window`, so detection can be unit-tested against
 * fabricated environments (iOS Safari, an SSR `undefined`, a jsdom window
 * with neither global) without a browser.
 */
export interface SpeechRecognitionWindowLike {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

/**
 * Tri-state on purpose. `pending` is not a synonym for `unsupported` — it
 * means "the server rendered this, we genuinely do not know yet." Copy that
 * treats the two the same would tell a Chrome user on their first paint
 * that their device can't do something it can.
 */
export type SpeechRecognitionSupportStatus = "pending" | "supported" | "unsupported";

export interface SpeechRecognitionSupport {
  status: SpeechRecognitionSupportStatus;
  /** Machine-readable detail, for structured logs and the settings capability row. */
  reason: "pending" | "supported" | "no-window" | "no-constructor";
  /** Which global provided the constructor. Null unless `status === "supported"`. */
  globalName: SpeechRecognitionGlobalName | null;
}

/**
 * The SSR / pre-hydration answer. A module-level frozen constant rather than
 * a fresh object per call: `useSyncExternalStore` requires
 * `getServerSnapshot` to return an `Object.is`-equal value across calls or
 * it warns and can loop during hydration reconciliation — the same
 * `EMPTY_LOGS` trick `post-dive-prompt/storage.ts` uses for its array.
 */
export const PENDING_SPEECH_RECOGNITION_SUPPORT: SpeechRecognitionSupport = Object.freeze({
  status: "pending",
  reason: "pending",
  globalName: null,
});

const UNSUPPORTED_NO_WINDOW: SpeechRecognitionSupport = Object.freeze({
  status: "unsupported",
  reason: "no-window",
  globalName: null,
});

const UNSUPPORTED_NO_CONSTRUCTOR: SpeechRecognitionSupport = Object.freeze({
  status: "unsupported",
  reason: "no-constructor",
  globalName: null,
});

const SUPPORTED_STANDARD: SpeechRecognitionSupport = Object.freeze({
  status: "supported",
  reason: "supported",
  globalName: "SpeechRecognition",
});

const SUPPORTED_WEBKIT: SpeechRecognitionSupport = Object.freeze({
  status: "supported",
  reason: "supported",
  globalName: "webkitSpeechRecognition",
});

/**
 * Feature-detect the Web Speech API. Never throws, never awaits.
 *
 * Prefers the unprefixed `SpeechRecognition` when both are present, because
 * where both exist the unprefixed one is the standards-track implementation
 * that also carries the `processLocally` / `availableOnDevice` on-device
 * surface this module cares about.
 *
 * Note the deliberate `typeof === "function"` check rather than a truthiness
 * or `in` test: a few environments (and some polyfill shims) define the
 * property as `undefined` or as a non-constructible object, which an `in`
 * check would wrongly report as supported — producing exactly the "silently
 * fail or hang" outcome CLAUDE.md forbids.
 */
export function detectSpeechRecognitionSupport(
  win: SpeechRecognitionWindowLike | undefined | null,
): SpeechRecognitionSupport {
  if (!win) return UNSUPPORTED_NO_WINDOW;
  if (typeof win.SpeechRecognition === "function") return SUPPORTED_STANDARD;
  if (typeof win.webkitSpeechRecognition === "function") return SUPPORTED_WEBKIT;
  return UNSUPPORTED_NO_CONSTRUCTOR;
}

/**
 * Whether the *offer* screen should present recording at all.
 *
 * `pending` returns true deliberately — see the module header. Hiding the
 * record CTA during the pre-hydration frame would make Chrome users watch
 * the primary action pop into existence, and the click handler re-detects
 * synchronously anyway, so an unsupported device that gets tapped mid-flash
 * still lands on manual entry rather than a broken recorder.
 */
export function shouldOfferVoiceRecording(support: SpeechRecognitionSupport): boolean {
  return support.status !== "unsupported";
}

// --- On-device / privacy resolution ---------------------------------------

/**
 * Return values of Chrome's `SpeechRecognition.availableOnDevice(lang)`.
 * Typed as a union of the documented strings plus `string`, because this is
 * a young API surface and an unrecognised future value must fall through to
 * `unknown` rather than being optimistically read as local.
 */
export type OnDeviceAvailability = "available" | "downloadable" | "downloading" | "unavailable" | (string & {});

/**
 * Map an availability answer to the privacy mode the UI discloses.
 *
 * Fails *pessimistic*, not optimistic: anything other than a definite
 * `"available"` is reported as `browser-service` or `unknown`, never
 * `on-device`. Over-claiming privacy here would be the voice-logging
 * equivalent of a Safe-Return UI implying "help is coming" — the exact
 * failure mode CLAUDE.md's engineering standards single out.
 */
export function resolveTranscriptionPrivacyMode(
  availability: OnDeviceAvailability | null | undefined,
): TranscriptionPrivacyMode {
  if (availability === "available") return "on-device";
  if (
    availability === "downloadable" ||
    availability === "downloading" ||
    availability === "unavailable"
  ) {
    return "browser-service";
  }
  return "unknown";
}

/**
 * The one-line honest disclosure for each mode. Kept here, next to the
 * resolution logic, so the copy can't drift away from the fact it describes
 * — and unit-tested, so no future edit can quietly reintroduce an
 * unconditional "nothing is uploaded" claim.
 */
export function describeTranscriptionPrivacy(mode: TranscriptionPrivacyMode): string {
  switch (mode) {
    case "on-device":
      return "Transcribed on this device — your browser confirmed it has an on-device speech model, so the audio never leaves it.";
    case "browser-service":
      return "Your browser handles transcription with its own speech service, which may send the audio to the browser vendor. Shore Dive never uploads or stores it.";
    case "unknown":
      return "Your browser handles transcription, and it doesn't say whether that happens on this device or on its servers. Shore Dive never uploads or stores the audio.";
  }
}

/** Short status label for the settings capability row (mockup 06). */
export function describeSpeechRecognitionSupport(support: SpeechRecognitionSupport): string {
  switch (support.status) {
    case "pending":
      return "Checking…";
    case "supported":
      return "Available on this device";
    case "unsupported":
      return "Not available on this browser";
  }
}
