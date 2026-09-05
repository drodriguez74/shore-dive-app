// @vitest-environment jsdom

/**
 * Behavioural coverage for the degraded path CLAUDE.md calls the single
 * hardest constraint in this feature: "browser Speech Recognition support is
 * inconsistent — notably weak/absent on iOS Safari — so this needs a
 * graceful degraded path (manual entry) rather than assuming it always
 * works."
 *
 * jsdom is a genuinely good stand-in for that specific case, not a
 * compromise: it implements no `SpeechRecognition` under either global name,
 * which is *exactly* the shape a real iPhone Safari `window` has. The test
 * environment isn't simulating the failure — it natively is the failure.
 *
 * These assertions were added after a live browser check left the question
 * unresolved. `agent-browser` confirmed the CTA swap and the settings
 * capability row against a real Chromium with the globals deleted, but
 * couldn't confirm which manual-entry *reason* reached the form, because
 * the harness's clicks and scrolling behaved inconsistently on that page.
 * Rather than declare it verified on partial evidence, the behaviour is
 * pinned here, where it's deterministic and re-checked on every run.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VoiceLogFlow } from "./voice-log-flow";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("VoiceLogFlow — no SpeechRecognition (the iOS Safari shape)", () => {
  it("confirms the environment really has no speech recognition", () => {
    // Guards the premise of every test below: if a future jsdom or a setup
    // file ever polyfilled this, these tests would silently start proving
    // nothing.
    expect("SpeechRecognition" in window).toBe(false);
    expect("webkitSpeechRecognition" in window).toBe(false);
  });

  it("swaps the CTA to 'Log this dive' instead of offering a recorder that would fail", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);

    expect(screen.getByRole("button", { name: "Log this dive" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record voice log" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Type it in" })).toBeNull();
  });

  it("routes the swapped CTA to manual entry with the capability explanation", () => {
    // The regression this pins: wiring the swapped CTA to `startManual`
    // instead of `startVoice` lands on the same form and looks identical,
    // but carries `user-choice` — silently swallowing the one sentence of
    // explanation the diver is actually owed here.
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(
      screen.getByText(/Voice logging needs browser support this device doesn't have/i),
    ).toBeTruthy();
    expect(screen.getByText(/common on iPhone Safari/i)).toBeTruthy();
  });

  it("never reaches a recording or permission screen on this path", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(screen.queryByText(/Recording your dive log/i)).toBeNull();
    expect(screen.queryByText(/Waiting for microphone access/i)).toBeNull();
    expect(screen.queryByText(/Transcribing/i)).toBeNull();
  });

  it("presents the manual form as first-class, not as a failure", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(screen.getByRole("heading", { name: "Log this dive" })).toBeTruthy();
    expect(screen.queryByText(/failed|sorry|error|unfortunately/i)).toBeNull();
  });

  it("shows no lineage tags on the manual path — there is nothing to attribute", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(screen.queryByText("Transcribed")).toBeNull();
    expect(screen.queryByText("Edited")).toBeNull();
    expect(screen.queryByText(/Draft — not saved yet/)).toBeNull();
  });

  it("pre-fills the site from dive-plan context and renders every structured field", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(screen.getByLabelText("Site")).toHaveProperty("value", "La Jolla Cove");
    expect(screen.getByLabelText("Max depth in feet")).toBeTruthy();
    expect(screen.getByLabelText("Runtime in minutes")).toBeTruthy();
    expect(screen.getByLabelText("Add a marine life sighting")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Visibility" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Current" })).toBeTruthy();
  });

  it("renders the fields added by plan.md's v5 correction", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(screen.getByLabelText("Buddy")).toBeTruthy();
    expect(screen.getByLabelText("Starting tank pressure in psi")).toBeTruthy();
    expect(screen.getByLabelText("Ending tank pressure in psi")).toBeTruthy();
    expect(screen.getByLabelText("Water temperature in degrees Fahrenheit")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Exposure suit" })).toBeTruthy();
  });

  it("leaves the buddy field empty — there is no dive-plan buddy context to pre-fill from", () => {
    // Site pre-fills because a real siteName is threaded in. Nothing
    // supplies a buddy today, and inventing a source would be worse than an
    // empty field the diver types into.
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(screen.getByLabelText("Buddy")).toHaveProperty("value", "");
  });

  it("states the device-only limitation without leaking an implementation TODO", () => {
    // A leaked "TODO: migrate to Supabase" in user-facing copy was a real
    // bug in post-dive-prompt.tsx. This asserts it stays out of this form.
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    expect(screen.getByText(/Saved on this device only for now/i)).toBeTruthy();
    expect(screen.queryByText(/TODO/i)).toBeNull();
  });
});

describe("VoiceLogFlow — saving from the manual path", () => {
  it("saves an entry and shows the quiet confirmation", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    fireEvent.change(screen.getByLabelText("Max depth in feet"), { target: { value: "58" } });
    fireEvent.change(screen.getByLabelText("Runtime in minutes"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save log" }));

    expect(screen.getByRole("heading", { name: "Dive log saved" })).toBeTruthy();
    expect(screen.getByText(/58 ft/)).toBeTruthy();
    expect(screen.getByText(/40 min/)).toBeTruthy();
  });

  it("persists the entry with a manual entry method and no transcript", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));
    fireEvent.change(screen.getByLabelText("Max depth in feet"), { target: { value: "58" } });
    fireEvent.click(screen.getByRole("button", { name: "Save log" }));

    const raw = window.localStorage.getItem("shore-dive:voice-logging:entries:v1");
    expect(raw).toBeTruthy();
    const [entry] = JSON.parse(raw as string);

    expect(entry.entryMethod).toBe("manual");
    expect(entry.maxDepthFt).toBe(58);
    // No recording happened, so there is nothing to attribute and no audio
    // metadata to record. Storing a transcript here would be a fabrication.
    expect(entry.transcript).toBeNull();
    expect(entry.recordingMs).toBeNull();
    expect(entry.transcriptionPrivacyMode).toBeNull();
    expect(entry.transcribedFields).toEqual([]);
    expect(entry.editedFields).toEqual([]);
  });

  it("round-trips every v5 field from the form into storage", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    fireEvent.change(screen.getByLabelText("Buddy"), { target: { value: "Marcus" } });
    fireEvent.change(screen.getByLabelText("Starting tank pressure in psi"), { target: { value: "3000" } });
    fireEvent.change(screen.getByLabelText("Ending tank pressure in psi"), { target: { value: "700" } });
    fireEvent.change(screen.getByLabelText("Water temperature in degrees Fahrenheit"), {
      target: { value: "64" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Wetsuit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save log" }));

    const [entry] = JSON.parse(window.localStorage.getItem("shore-dive:voice-logging:entries:v1") as string);
    expect(entry.buddy).toBe("Marcus");
    expect(entry.tankPressureStartPsi).toBe(3000);
    expect(entry.tankPressureEndPsi).toBe(700);
    expect(entry.waterTempF).toBe(64);
    expect(entry.exposureSuit).toBe("wetsuit");
  });

  it("saves a starting pressure with no ending pressure as a valid partial entry", () => {
    // A diver who remembers the fill pressure but not the surfacing one has
    // said something true. The form must not treat that as incomplete.
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    fireEvent.change(screen.getByLabelText("Starting tank pressure in psi"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save log" }));

    expect(screen.getByRole("heading", { name: "Dive log saved" })).toBeTruthy();
    const [entry] = JSON.parse(window.localStorage.getItem("shore-dive:voice-logging:entries:v1") as string);
    expect(entry.tankPressureStartPsi).toBe(3000);
    expect(entry.tankPressureEndPsi).toBeNull();
  });

  it("makes a tank pressure on its own enough to enable Save", () => {
    render(<VoiceLogFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));
    expect(screen.getByRole("button", { name: "Save log" })).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Starting tank pressure in psi"), { target: { value: "3000" } });
    expect(screen.getByRole("button", { name: "Save log" })).toHaveProperty("disabled", false);
  });

  it("keeps Save disabled until there is something worth saving", () => {
    render(<VoiceLogFlow />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));

    // No site name supplied this time, so the draft starts genuinely empty.
    const save = screen.getByRole("button", { name: "Save log" });
    expect(save).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Max depth in feet"), { target: { value: "30" } });
    expect(screen.getByRole("button", { name: "Save log" })).toHaveProperty("disabled", false);
  });

  it("returns to the offer after Done, without re-saving", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));
    fireEvent.click(screen.getByRole("button", { name: "Save log" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByRole("button", { name: "Log this dive" })).toBeTruthy();
    const stored = JSON.parse(window.localStorage.getItem("shore-dive:voice-logging:entries:v1") as string);
    expect(stored).toHaveLength(1);
  });

  it("discards without saving on Cancel", () => {
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));
    fireEvent.change(screen.getByLabelText("Max depth in feet"), { target: { value: "58" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Log this dive" })).toBeTruthy();
    expect(window.localStorage.getItem("shore-dive:voice-logging:entries:v1")).toBeNull();
  });

  it("starts a genuinely empty draft on a second entry", () => {
    // Guards the draft-reseeding key in VoiceLogFlowView: a stale draft
    // leaking into the next log would silently attribute one dive's depth
    // to another.
    render(<VoiceLogFlow siteName="La Jolla Cove" />);
    fireEvent.click(screen.getByRole("button", { name: "Log this dive" }));
    fireEvent.change(screen.getByLabelText("Max depth in feet"), { target: { value: "58" } });
    fireEvent.click(screen.getByRole("button", { name: "Save log" }));
    fireEvent.click(screen.getByRole("button", { name: "Log another" }));

    expect(screen.getByLabelText("Max depth in feet")).toHaveProperty("value", "");
  });
});
