/**
 * Error-classification tests for the two browser-API boundaries.
 *
 * Both modules touch browser globals, but only inside their exported
 * *functions* — nothing runs at import time — so the pure classifiers can be
 * exercised in the default Node environment without a jsdom shim for APIs
 * jsdom doesn't implement anyway (`SpeechRecognition`, `MediaRecorder`).
 *
 * These two functions decide which sentence a diver reads when voice
 * logging doesn't work. Getting them wrong sends someone to fix a
 * permission they never denied, so they're tested rather than eyeballed.
 */

import { describe, expect, it } from "vitest";
import { classifyGetUserMediaError } from "./audio-recorder-session";
import { classifySpeechRecognitionError } from "./speech-recognition-session";
import { describeManualEntryReason } from "./machine";

describe("classifySpeechRecognitionError", () => {
  it("treats a user-initiated abort as no failure at all", () => {
    // `abort` is what fires when we cancel on the diver's behalf. Showing
    // an explanation for that would apologise for something that didn't go
    // wrong.
    expect(classifySpeechRecognitionError("aborted")).toBeNull();
  });

  it("maps both permission codes to a denial", () => {
    expect(classifySpeechRecognitionError("not-allowed")).toBe("mic-denied");
    expect(classifySpeechRecognitionError("service-not-allowed")).toBe("mic-denied");
  });

  it("distinguishes a missing capture device from a denial", () => {
    expect(classifySpeechRecognitionError("audio-capture")).toBe("mic-unavailable");
  });

  it("maps silence to its own reason", () => {
    expect(classifySpeechRecognitionError("no-speech")).toBe("no-speech");
  });

  it("degrades an unknown or future code to a generic failure, not to silence", () => {
    // A new browser error code must still route to manual entry rather
    // than leaving the diver on a stalled processing screen.
    expect(classifySpeechRecognitionError("network")).toBe("stt-failed");
    expect(classifySpeechRecognitionError("language-not-supported")).toBe("stt-failed");
    expect(classifySpeechRecognitionError("some-code-invented-in-2029")).toBe("stt-failed");
    expect(classifySpeechRecognitionError("")).toBe("stt-failed");
  });

  it("only ever produces reasons the manual-entry screen can explain", () => {
    const codes = ["not-allowed", "service-not-allowed", "audio-capture", "no-speech", "network", "unknown"];
    for (const code of codes) {
      const reason = classifySpeechRecognitionError(code);
      if (reason === null) continue;
      // A reason with no copy would render a bare, unexplained screen.
      expect(describeManualEntryReason(reason)).toBeTruthy();
    }
  });
});

describe("classifyGetUserMediaError", () => {
  it("maps the permission-refusal DOMException names to a denial", () => {
    expect(classifyGetUserMediaError("NotAllowedError")).toBe("mic-denied");
    expect(classifyGetUserMediaError("PermissionDeniedError")).toBe("mic-denied");
    expect(classifyGetUserMediaError("SecurityError")).toBe("mic-denied");
  });

  it("maps hardware and constraint failures to unavailability", () => {
    expect(classifyGetUserMediaError("NotFoundError")).toBe("mic-unavailable");
    expect(classifyGetUserMediaError("NotReadableError")).toBe("mic-unavailable");
    expect(classifyGetUserMediaError("OverconstrainedError")).toBe("mic-unavailable");
    expect(classifyGetUserMediaError("AbortError")).toBe("mic-unavailable");
  });

  it("defaults an unknown name to unavailable rather than denied", () => {
    // Telling someone they denied a permission they didn't deny sends them
    // to fix something that isn't broken.
    expect(classifyGetUserMediaError("SomethingNew")).toBe("mic-unavailable");
    expect(classifyGetUserMediaError("")).toBe("mic-unavailable");
  });
});
