import { describe, expect, it } from "vitest";
import {
  describeManualEntryReason,
  diveLogFormHeading,
  INITIAL_VOICE_LOG_STATE,
  SAVE_PERMITTED_FROM,
  voiceLogReducer,
  type ManualEntryReason,
  type VoiceLogEvent,
  type VoiceLogState,
  type VoiceLogStatus,
} from "./machine";
import { emptyDiveLogDraft, type DiveLogEntry } from "./types";

const DRAFT = emptyDiveLogDraft("La Jolla Cove");

const ENTRY: DiveLogEntry = {
  ...DRAFT,
  id: "entry-1",
  loggedAt: 1_800_000_000_000,
  siteId: null,
  entryMethod: "voice",
  transcribedFields: [],
  editedFields: [],
  transcript: "test",
  recordingMs: 1000,
  transcriptionPrivacyMode: "unknown",
};

/** One representative instance of every state, for exhaustive crossing. */
const ALL_STATES: VoiceLogState[] = [
  { status: "idle" },
  { status: "requesting-permission" },
  { status: "recording", startedAt: 1_800_000_000_000 },
  { status: "processing", recordingMs: 52_000 },
  {
    status: "confirm-edit",
    transcript: "went down to 55 feet",
    initialDraft: DRAFT,
    transcribedFields: ["maxDepthFt"],
    recordingMs: 52_000,
    privacyMode: "unknown",
  },
  { status: "manual-entry", reason: "user-choice" },
  { status: "saved", entry: ENTRY },
];

/** One representative instance of every event. */
const ALL_EVENTS: VoiceLogEvent[] = [
  { type: "START_VOICE", sttSupported: true },
  { type: "START_VOICE", sttSupported: false },
  { type: "START_MANUAL" },
  { type: "PERMISSION_GRANTED", startedAt: 1_800_000_000_000 },
  { type: "PERMISSION_DENIED", reason: "mic-denied" },
  { type: "STOP_RECORDING", recordingMs: 52_000 },
  {
    type: "TRANSCRIPT_READY",
    transcript: "went down to 55 feet",
    initialDraft: DRAFT,
    transcribedFields: ["maxDepthFt"],
    privacyMode: "on-device",
  },
  { type: "TRANSCRIPT_FAILED", reason: "no-speech" },
  { type: "FALL_BACK_TO_MANUAL" },
  { type: "CANCEL" },
  { type: "SAVE", entry: ENTRY },
  { type: "RESET" },
];

const ALL_MANUAL_REASONS: ManualEntryReason[] = [
  "user-choice",
  "stt-unsupported",
  "mic-denied",
  "mic-unavailable",
  "no-speech",
  "stt-failed",
  "left-processing",
];

describe("voiceLogReducer — the confirm/edit gate", () => {
  /**
   * The load-bearing test in this file. CLAUDE.md forbids auto-committing a
   * transcribed value, and creative/flows/voice-logging.md's first line of
   * defence is structural — no edge into `saved` may skip review.
   *
   * Asserted by brute force over every (state, event) pair rather than by
   * checking the paths someone thought to write down: a future edit that
   * adds a shortcut fails here, whereas a hand-picked set of happy-path
   * tests would very plausibly still pass.
   */
  it("can only reach 'saved' from confirm-edit or manual-entry, via SAVE", () => {
    const reachedSavedFrom: { status: VoiceLogStatus; event: string }[] = [];

    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        const next = voiceLogReducer(state, event);
        if (next.status === "saved" && state.status !== "saved") {
          reachedSavedFrom.push({ status: state.status, event: event.type });
        }
      }
    }

    expect(reachedSavedFrom).toEqual([
      { status: "confirm-edit", event: "SAVE" },
      { status: "manual-entry", event: "SAVE" },
    ]);
  });

  it("keeps SAVE_PERMITTED_FROM in sync with the reducer's actual behaviour", () => {
    // Reads the rule from the module rather than restating it, so the
    // constant can't drift away from what the reducer does.
    for (const state of ALL_STATES) {
      const next = voiceLogReducer(state, { type: "SAVE", entry: ENTRY });
      const permitted = SAVE_PERMITTED_FROM.includes(state.status);
      expect(next.status === "saved").toBe(permitted || state.status === "saved");
    }
  });

  it("ignores SAVE from processing — a transcript never commits itself", () => {
    const processing: VoiceLogState = { status: "processing", recordingMs: 1000 };
    expect(voiceLogReducer(processing, { type: "SAVE", entry: ENTRY })).toBe(processing);
  });

  it("routes a ready transcript through confirm-edit, carrying the lineage forward", () => {
    const next = voiceLogReducer(
      { status: "processing", recordingMs: 52_000 },
      {
        type: "TRANSCRIPT_READY",
        transcript: "went down to 55 feet",
        initialDraft: DRAFT,
        transcribedFields: ["maxDepthFt"],
        privacyMode: "on-device",
      },
    );

    expect(next).toEqual({
      status: "confirm-edit",
      transcript: "went down to 55 feet",
      initialDraft: DRAFT,
      transcribedFields: ["maxDepthFt"],
      // Carried from the processing state, not from the event — the
      // duration was measured by the recorder, not the transcriber.
      recordingMs: 52_000,
      privacyMode: "on-device",
    });
  });
});

describe("voiceLogReducer — the unsupported-STT path", () => {
  it("routes straight to manual entry without ever entering the recording path", () => {
    // The iOS Safari case. The diver must never reach a permission prompt
    // or a recorder that was always going to fail.
    const next = voiceLogReducer(INITIAL_VOICE_LOG_STATE, { type: "START_VOICE", sttSupported: false });
    expect(next).toEqual({ status: "manual-entry", reason: "stt-unsupported" });
  });

  it("requests permission first when STT is supported", () => {
    const next = voiceLogReducer(INITIAL_VOICE_LOG_STATE, { type: "START_VOICE", sttSupported: true });
    expect(next).toEqual({ status: "requesting-permission" });
  });

  it("applies the same guard when starting again from the saved screen", () => {
    const saved: VoiceLogState = { status: "saved", entry: ENTRY };
    expect(voiceLogReducer(saved, { type: "START_VOICE", sttSupported: false })).toEqual({
      status: "manual-entry",
      reason: "stt-unsupported",
    });
  });
});

describe("voiceLogReducer — manual entry is reachable from everywhere it should be", () => {
  it("is reachable directly from idle, not only after a failed voice attempt", () => {
    // creative/flows/voice-logging.md treats manual entry as first-class;
    // the design brief calls out that it must be reachable directly.
    expect(voiceLogReducer(INITIAL_VOICE_LOG_STATE, { type: "START_MANUAL" })).toEqual({
      status: "manual-entry",
      reason: "user-choice",
    });
  });

  it("is reachable mid-processing, with a reason that isn't framed as a failure", () => {
    const next = voiceLogReducer({ status: "processing", recordingMs: 1000 }, { type: "FALL_BACK_TO_MANUAL" });
    expect(next).toEqual({ status: "manual-entry", reason: "left-processing" });
  });

  it("is reachable mid-recording", () => {
    const next = voiceLogReducer({ status: "recording", startedAt: 1 }, { type: "FALL_BACK_TO_MANUAL" });
    expect(next).toEqual({ status: "manual-entry", reason: "user-choice" });
  });

  it("carries a permission denial through as its own distinct reason", () => {
    expect(
      voiceLogReducer({ status: "requesting-permission" }, { type: "PERMISSION_DENIED", reason: "mic-unavailable" }),
    ).toEqual({ status: "manual-entry", reason: "mic-unavailable" });
  });

  it("handles a mid-recording device failure rather than stranding a live-looking screen", () => {
    const next = voiceLogReducer(
      { status: "recording", startedAt: 1 },
      { type: "TRANSCRIPT_FAILED", reason: "mic-unavailable" },
    );
    expect(next).toEqual({ status: "manual-entry", reason: "mic-unavailable" });
  });
});

describe("voiceLogReducer — cancel and reset", () => {
  it("returns to idle from every cancellable state", () => {
    for (const state of ALL_STATES) {
      expect(voiceLogReducer(state, { type: "CANCEL" }).status).toBe("idle");
    }
  });

  it("returns to idle on RESET from saved", () => {
    expect(voiceLogReducer({ status: "saved", entry: ENTRY }, { type: "RESET" })).toEqual(INITIAL_VOICE_LOG_STATE);
  });
});

describe("voiceLogReducer — late/unknown events are inert", () => {
  it("returns the identical state object for every unhandled pair", () => {
    // Identity, not just equality: a browser speech event arriving after a
    // cancel must not produce a new object and re-render, let alone
    // resurrect a screen the diver dismissed.
    const unhandled: [VoiceLogState, VoiceLogEvent][] = [
      [{ status: "idle" }, { type: "STOP_RECORDING", recordingMs: 1 }],
      [{ status: "idle" }, { type: "PERMISSION_GRANTED", startedAt: 1 }],
      [{ status: "recording", startedAt: 1 }, { type: "START_MANUAL" }],
      [{ status: "processing", recordingMs: 1 }, { type: "STOP_RECORDING", recordingMs: 1 }],
      [{ status: "manual-entry", reason: "user-choice" }, { type: "TRANSCRIPT_READY", transcript: "x", initialDraft: DRAFT, transcribedFields: [], privacyMode: "unknown" }],
    ];

    for (const [state, event] of unhandled) {
      expect(voiceLogReducer(state, event)).toBe(state);
    }
  });

  it("never throws on any (state, event) pair", () => {
    for (const state of ALL_STATES) {
      for (const event of ALL_EVENTS) {
        expect(() => voiceLogReducer(state, event)).not.toThrow();
      }
    }
  });
});

describe("describeManualEntryReason", () => {
  it("says nothing when the diver chose to type", () => {
    // No explanation is owed for a deliberate choice, and offering one
    // would turn a first-class path into an apology.
    expect(describeManualEntryReason("user-choice")).toBeNull();
  });

  it("matches mockup 05's wording for the unsupported-browser case", () => {
    expect(describeManualEntryReason("stt-unsupported")).toBe(
      "Voice logging needs browser support this device doesn't have — common on iPhone Safari. Same structured log, just typed.",
    );
  });

  it("never apologises or frames any reason as a failure", () => {
    // Tone is a stated design decision here, not a preference: the flow doc
    // rejects "Voice logging failed" / "Sorry" framing explicitly.
    for (const reason of ALL_MANUAL_REASONS) {
      const copy = describeManualEntryReason(reason);
      if (copy === null) continue;
      expect(copy).not.toMatch(/sorry|failed|error|unfortunately|oops/i);
    }
  });

  it("pivots every explanation to the capability that still works", () => {
    for (const reason of ALL_MANUAL_REASONS) {
      const copy = describeManualEntryReason(reason);
      if (copy === null) continue;
      expect(copy).toMatch(/same structured log/i);
    }
  });
});

describe("diveLogFormHeading", () => {
  it("uses the review framing on the voice path and a plain one on manual", () => {
    expect(diveLogFormHeading("confirm-edit")).toBe("Review your dive log");
    // Mockup 05: "Log this dive", not "Voice logging failed".
    expect(diveLogFormHeading("manual-entry")).toBe("Log this dive");
  });
});
