import { describe, expect, it } from "vitest";
import {
  describeSpeechRecognitionSupport,
  describeTranscriptionPrivacy,
  detectSpeechRecognitionSupport,
  PENDING_SPEECH_RECOGNITION_SUPPORT,
  resolveTranscriptionPrivacyMode,
  shouldOfferVoiceRecording,
} from "./stt-support";

/** Stand-in for a real constructor — detection only checks `typeof === "function"`. */
function fakeCtor(): unknown {
  return function FakeSpeechRecognition() {};
}

describe("detectSpeechRecognitionSupport", () => {
  it("reports the unprefixed constructor when present", () => {
    const support = detectSpeechRecognitionSupport({ SpeechRecognition: fakeCtor() });
    expect(support).toEqual({ status: "supported", reason: "supported", globalName: "SpeechRecognition" });
  });

  it("falls back to the webkit-prefixed constructor", () => {
    const support = detectSpeechRecognitionSupport({ webkitSpeechRecognition: fakeCtor() });
    expect(support).toEqual({ status: "supported", reason: "supported", globalName: "webkitSpeechRecognition" });
  });

  it("prefers the unprefixed constructor when both exist (it carries the on-device surface)", () => {
    const support = detectSpeechRecognitionSupport({
      SpeechRecognition: fakeCtor(),
      webkitSpeechRecognition: fakeCtor(),
    });
    expect(support.globalName).toBe("SpeechRecognition");
  });

  it("reports unsupported for a window with neither global — the iOS Safari case", () => {
    // This is the exact shape CLAUDE.md names: a perfectly real `window`
    // object that simply has no speech-recognition constructor under either
    // name. It must resolve to `unsupported`, not `pending`, so the offer
    // screen can swap its CTA rather than presenting a control that fails.
    const support = detectSpeechRecognitionSupport({});
    expect(support).toEqual({ status: "unsupported", reason: "no-constructor", globalName: null });
  });

  it("reports unsupported (no-window) during SSR", () => {
    expect(detectSpeechRecognitionSupport(undefined).reason).toBe("no-window");
    expect(detectSpeechRecognitionSupport(null).reason).toBe("no-window");
  });

  it("does not treat a defined-but-not-callable property as support", () => {
    // An `in` check or a truthiness check would pass these and produce the
    // "silently fail or hang" outcome CLAUDE.md forbids.
    expect(detectSpeechRecognitionSupport({ SpeechRecognition: undefined }).status).toBe("unsupported");
    expect(detectSpeechRecognitionSupport({ SpeechRecognition: {} }).status).toBe("unsupported");
    expect(detectSpeechRecognitionSupport({ webkitSpeechRecognition: "yes" }).status).toBe("unsupported");
  });

  it("returns Object.is-stable results, as useSyncExternalStore requires", () => {
    const a = detectSpeechRecognitionSupport({});
    const b = detectSpeechRecognitionSupport({});
    expect(a).toBe(b);
  });
});

describe("shouldOfferVoiceRecording", () => {
  it("offers recording while support is still pending", () => {
    // Pre-hydration must not hide the primary action; the tap handler
    // re-detects synchronously, so an unsupported device tapped mid-flash
    // still lands on manual entry.
    expect(shouldOfferVoiceRecording(PENDING_SPEECH_RECOGNITION_SUPPORT)).toBe(true);
  });

  it("offers recording when supported", () => {
    expect(shouldOfferVoiceRecording(detectSpeechRecognitionSupport({ SpeechRecognition: fakeCtor() }))).toBe(true);
  });

  it("withholds the recording offer when definitively unsupported", () => {
    expect(shouldOfferVoiceRecording(detectSpeechRecognitionSupport({}))).toBe(false);
  });
});

describe("resolveTranscriptionPrivacyMode", () => {
  it("only claims on-device for a definite 'available'", () => {
    expect(resolveTranscriptionPrivacyMode("available")).toBe("on-device");
  });

  it("treats every non-available answer as the browser's own service", () => {
    expect(resolveTranscriptionPrivacyMode("downloadable")).toBe("browser-service");
    expect(resolveTranscriptionPrivacyMode("downloading")).toBe("browser-service");
    expect(resolveTranscriptionPrivacyMode("unavailable")).toBe("browser-service");
  });

  it("falls to 'unknown' when the browser doesn't answer at all", () => {
    // The common case: the API predates `availableOnDevice` entirely.
    expect(resolveTranscriptionPrivacyMode(null)).toBe("unknown");
    expect(resolveTranscriptionPrivacyMode(undefined)).toBe("unknown");
  });

  it("fails pessimistic on an unrecognised future value", () => {
    expect(resolveTranscriptionPrivacyMode("some-future-state")).toBe("unknown");
  });
});

describe("describeTranscriptionPrivacy", () => {
  it("only says audio never leaves the device in the on-device mode", () => {
    expect(describeTranscriptionPrivacy("on-device")).toMatch(/never leaves it/i);
  });

  it("discloses possible transmission in the other two modes", () => {
    // THREAT_MODEL.md §3's consent finding. These assertions exist so a
    // future copy edit can't quietly restore a blanket "nothing is
    // uploaded" claim the platform doesn't support.
    expect(describeTranscriptionPrivacy("browser-service")).toMatch(/may send the audio/i);
    expect(describeTranscriptionPrivacy("unknown")).toMatch(/doesn't say whether/i);
  });

  it("never claims audio stays local in a mode that can't guarantee it", () => {
    for (const mode of ["browser-service", "unknown"] as const) {
      expect(describeTranscriptionPrivacy(mode)).not.toMatch(/never leaves/i);
    }
  });

  it("makes clear Shore Dive itself never uploads, in every mode", () => {
    expect(describeTranscriptionPrivacy("browser-service")).toMatch(/Shore Dive never uploads/i);
    expect(describeTranscriptionPrivacy("unknown")).toMatch(/Shore Dive never uploads/i);
  });
});

describe("describeSpeechRecognitionSupport", () => {
  it("distinguishes pending from unsupported", () => {
    expect(describeSpeechRecognitionSupport(PENDING_SPEECH_RECOGNITION_SUPPORT)).toBe("Checking…");
    expect(describeSpeechRecognitionSupport(detectSpeechRecognitionSupport({}))).toBe("Not available on this browser");
  });

  it("matches mockup 06's capability-row wording when supported", () => {
    expect(describeSpeechRecognitionSupport(detectSpeechRecognitionSupport({ SpeechRecognition: fakeCtor() }))).toBe(
      "Available on this device",
    );
  });
});
