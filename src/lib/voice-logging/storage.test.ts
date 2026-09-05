// @vitest-environment jsdom

/**
 * Read-path tests for dive-log persistence, focused on the upgrade case.
 *
 * `loadDiveLogEntries()` filters invalid records out **silently** by design
 * — a hand-edited or version-skewed blob shouldn't crash a render. That
 * design makes one specific bug catastrophic and invisible: buddy, tank
 * pressure, water temp, and exposure suit arrived with `plan.md`'s v5
 * field-list correction, long after divers could already have saved logs
 * under this same storage key. If validation simply required the new fields,
 * every pre-existing entry would fail it and a diver's whole logbook would
 * disappear on upgrade with no error and no way back.
 *
 * These tests pin the migration that prevents that.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { loadDiveLogEntries, saveDiveLogEntry } from "./storage";
import { emptyDiveLogDraft, type DiveLogDraft } from "./types";

const STORAGE_KEY = "shore-dive:voice-logging:entries:v1";

/** An entry exactly as the pre-v5 build wrote it — none of the new keys. */
function legacyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "legacy-1",
    loggedAt: 1_700_000_000_000,
    siteId: null,
    site: "La Jolla Cove",
    maxDepthFt: 55,
    runtimeMinutes: 40,
    marineLife: ["Garibaldi"],
    visibility: "good",
    current: "none",
    notes: "kelp bed",
    entryMethod: "voice",
    transcribedFields: ["maxDepthFt", "runtimeMinutes"],
    editedFields: [],
    transcript: "went down to about fifty five feet",
    recordingMs: 52_000,
    transcriptionPrivacyMode: "browser-service",
    ...overrides,
  };
}

function write(entries: unknown[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("loadDiveLogEntries — entries saved before the v5 fields existed", () => {
  it("keeps a legacy entry rather than silently discarding it", () => {
    write([legacyEntry()]);
    const entries = loadDiveLogEntries();

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("legacy-1");
  });

  it("preserves everything the legacy entry did record", () => {
    write([legacyEntry()]);
    const [entry] = loadDiveLogEntries();

    expect(entry.site).toBe("La Jolla Cove");
    expect(entry.maxDepthFt).toBe(55);
    expect(entry.runtimeMinutes).toBe(40);
    expect(entry.marineLife).toEqual(["Garibaldi"]);
    expect(entry.transcript).toBe("went down to about fifty five feet");
  });

  it("fills the new fields with empty defaults, not invented values", () => {
    write([legacyEntry()]);
    const [entry] = loadDiveLogEntries();

    expect(entry.buddy).toBe("");
    expect(entry.tankPressureStartPsi).toBeNull();
    expect(entry.tankPressureEndPsi).toBeNull();
    expect(entry.waterTempF).toBeNull();
    expect(entry.exposureSuit).toBeNull();
  });

  it("never lets a default overwrite a value that is actually present", () => {
    // The defaults are spread first precisely so this can't happen — a
    // migration that clobbered real data would be worse than one that
    // dropped it, because it would look like a successful read.
    write([legacyEntry({ buddy: "Marcus", tankPressureStartPsi: 3000, waterTempF: 64 })]);
    const [entry] = loadDiveLogEntries();

    expect(entry.buddy).toBe("Marcus");
    expect(entry.tankPressureStartPsi).toBe(3000);
    expect(entry.waterTempF).toBe(64);
  });

  it("keeps an explicit null rather than treating it as a missing key", () => {
    write([legacyEntry({ waterTempF: null })]);
    expect(loadDiveLogEntries()[0].waterTempF).toBeNull();
  });

  it("still rejects a record whose original shape is broken", () => {
    // The migration adds missing keys; it must not turn validation off.
    write([legacyEntry({ marineLife: "Garibaldi" }), legacyEntry({ id: 42 })]);
    expect(loadDiveLogEntries()).toEqual([]);
  });

  it("rejects a new field of the wrong type", () => {
    write([legacyEntry({ tankPressureStartPsi: "3000" })]);
    expect(loadDiveLogEntries()).toEqual([]);
  });

  it("returns an empty list rather than throwing on a corrupt blob", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadDiveLogEntries()).toEqual([]);
  });
});

describe("saveDiveLogEntry — the v5 fields round-trip through storage", () => {
  function draft(overrides: Partial<DiveLogDraft> = {}): DiveLogDraft {
    return { ...emptyDiveLogDraft("Blue Heron Bridge"), ...overrides };
  }

  it("persists every new field and reads it back unchanged", () => {
    saveDiveLogEntry({
      draft: draft({
        buddy: "Marcus",
        tankPressureStartPsi: 3000,
        tankPressureEndPsi: 700,
        waterTempF: 64,
        exposureSuit: "wetsuit",
      }),
      siteId: null,
      entryMethod: "manual",
      transcribedFields: [],
      editedFields: [],
      transcript: null,
      recordingMs: null,
      transcriptionPrivacyMode: null,
    });

    const [entry] = loadDiveLogEntries();
    expect(entry.buddy).toBe("Marcus");
    expect(entry.tankPressureStartPsi).toBe(3000);
    expect(entry.tankPressureEndPsi).toBe(700);
    expect(entry.waterTempF).toBe(64);
    expect(entry.exposureSuit).toBe("wetsuit");
  });

  it("persists a half-known tank pressure without inventing the other half", () => {
    saveDiveLogEntry({
      draft: draft({ tankPressureStartPsi: 3000 }),
      siteId: null,
      entryMethod: "manual",
      transcribedFields: [],
      editedFields: [],
      transcript: null,
      recordingMs: null,
      transcriptionPrivacyMode: null,
    });

    const [entry] = loadDiveLogEntries();
    expect(entry.tankPressureStartPsi).toBe(3000);
    expect(entry.tankPressureEndPsi).toBeNull();
  });

  it("records tank pressure as a single field in the saved lineage", () => {
    saveDiveLogEntry({
      draft: draft({ tankPressureStartPsi: 3000, tankPressureEndPsi: 700 }),
      siteId: null,
      entryMethod: "voice",
      transcribedFields: ["tankPressure"],
      editedFields: [],
      transcript: "started with 3000 and came up with 700",
      recordingMs: 12_000,
      transcriptionPrivacyMode: "browser-service",
    });

    const [entry] = loadDiveLogEntries();
    expect(entry.transcribedFields).toEqual(["tankPressure"]);
  });
});
