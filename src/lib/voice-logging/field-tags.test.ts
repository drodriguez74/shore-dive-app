import { describe, expect, it } from "vitest";
import {
  collectDiveLogLineage,
  computeFieldTag,
  diveLogFieldLabel,
  isFieldEdited,
  type DiveLogFormMode,
} from "./field-tags";
import { DIVE_LOG_FIELD_NAMES, emptyDiveLogDraft, type DiveLogDraft } from "./types";

function draft(overrides: Partial<DiveLogDraft> = {}): DiveLogDraft {
  return { ...emptyDiveLogDraft(), ...overrides };
}

const TRANSCRIBED = draft({
  maxDepthFt: 55,
  runtimeMinutes: 40,
  marineLife: ["Garibaldi", "Leopard shark (maybe)"],
  visibility: "good",
  current: "none",
});

const TRANSCRIBED_FIELDS = ["maxDepthFt", "runtimeMinutes", "marineLife", "visibility", "current"] as const;

describe("isFieldEdited", () => {
  it("is false for an untouched field", () => {
    expect(isFieldEdited(TRANSCRIBED, TRANSCRIBED, "maxDepthFt")).toBe(false);
  });

  it("is true once a number changes", () => {
    expect(isFieldEdited(draft({ ...TRANSCRIBED, maxDepthFt: 58 }), TRANSCRIBED, "maxDepthFt")).toBe(true);
  });

  it("compares arrays element-wise, not by reference", () => {
    // A fresh array with identical contents is not an edit; `===` would
    // wrongly say it was, and every re-render would flip the tag.
    const same = draft({ ...TRANSCRIBED, marineLife: ["Garibaldi", "Leopard shark (maybe)"] });
    expect(isFieldEdited(same, TRANSCRIBED, "marineLife")).toBe(false);

    const removed = draft({ ...TRANSCRIBED, marineLife: ["Garibaldi"] });
    expect(isFieldEdited(removed, TRANSCRIBED, "marineLife")).toBe(true);
  });

  it("is order-sensitive on arrays", () => {
    const reordered = draft({ ...TRANSCRIBED, marineLife: ["Leopard shark (maybe)", "Garibaldi"] });
    expect(isFieldEdited(reordered, TRANSCRIBED, "marineLife")).toBe(true);
  });

  it("ignores surrounding whitespace on text fields", () => {
    // A controlled input can pick up stray whitespace without the diver
    // meaning anything by it; that should not read as a correction.
    const base = draft({ notes: "kelp bed" });
    expect(isFieldEdited(draft({ notes: "  kelp bed  " }), base, "notes")).toBe(false);
    expect(isFieldEdited(draft({ notes: "kelp bed, north side" }), base, "notes")).toBe(true);
  });

  it("treats clearing a field as an edit", () => {
    expect(isFieldEdited(draft({ ...TRANSCRIBED, maxDepthFt: null }), TRANSCRIBED, "maxDepthFt")).toBe(true);
  });
});

describe("isFieldEdited — tank pressure's two halves under one tag", () => {
  // Tank pressure is one row with one badge but two numbers, so the
  // comparison has to consider both halves together: correcting only the
  // surfacing figure still means "this row differs from what was heard",
  // which is exactly what the badge claims.
  const PAIR = draft({ tankPressureStartPsi: 3000, tankPressureEndPsi: 500 });

  it("is false when neither half changed", () => {
    expect(isFieldEdited(draft({ ...PAIR }), PAIR, "tankPressure")).toBe(false);
  });

  it("is true when only the end half changed", () => {
    expect(isFieldEdited(draft({ ...PAIR, tankPressureEndPsi: 700 }), PAIR, "tankPressure")).toBe(true);
  });

  it("is true when only the start half changed", () => {
    expect(isFieldEdited(draft({ ...PAIR, tankPressureStartPsi: 3200 }), PAIR, "tankPressure")).toBe(true);
  });

  it("treats filling in a half the parser never heard as an edit", () => {
    // The partial case: the diver said "went in with 3000" and then typed
    // the surfacing pressure themselves.
    const partial = draft({ tankPressureStartPsi: 3000, tankPressureEndPsi: null });
    expect(isFieldEdited(draft({ ...partial, tankPressureEndPsi: 500 }), partial, "tankPressure")).toBe(true);
  });

  it("does not confuse a start-only pair with an end-only pair", () => {
    const startOnly = draft({ tankPressureStartPsi: 3000, tankPressureEndPsi: null });
    const endOnly = draft({ tankPressureStartPsi: null, tankPressureEndPsi: 3000 });
    expect(isFieldEdited(startOnly, endOnly, "tankPressure")).toBe(true);
  });
});

describe("computeFieldTag", () => {
  const base = { mode: "confirm-edit" as DiveLogFormMode, transcribedFields: TRANSCRIBED_FIELDS };

  it("tags an untouched extracted field 'transcribed'", () => {
    expect(computeFieldTag({ ...base, field: "maxDepthFt", current: TRANSCRIBED, initial: TRANSCRIBED })).toBe(
      "transcribed",
    );
  });

  it("flips to 'edited' the moment the diver changes it", () => {
    // Mockup 04 shows Max depth already edited from 55 to 58, precisely to
    // demonstrate this transition rather than assert it exists.
    expect(
      computeFieldTag({
        ...base,
        field: "maxDepthFt",
        current: draft({ ...TRANSCRIBED, maxDepthFt: 58 }),
        initial: TRANSCRIBED,
      }),
    ).toBe("edited");
  });

  it("flips back to 'transcribed' if the diver restores the original value", () => {
    // The tag means "this differs from what was heard", not "this field was
    // touched at some point" — the latter isn't a fact worth showing anyone.
    expect(
      computeFieldTag({ ...base, field: "maxDepthFt", current: draft({ ...TRANSCRIBED }), initial: TRANSCRIBED }),
    ).toBe("transcribed");
  });

  it("shows no tag for a field the parser never populated", () => {
    // Calling it "Edited" would imply a transcribed value it was edited
    // from; the diver simply typed it.
    expect(
      computeFieldTag({ ...base, field: "notes", current: draft({ notes: "typed" }), initial: TRANSCRIBED }),
    ).toBeNull();
  });

  it("shows no tags at all on the manual-entry path", () => {
    // Mockup 05 reuses the same form with the tags "simply absent (there's
    // nothing to attribute)".
    for (const field of DIVE_LOG_FIELD_NAMES) {
      expect(
        computeFieldTag({
          field,
          mode: "manual-entry",
          current: TRANSCRIBED,
          initial: emptyDiveLogDraft(),
          transcribedFields: TRANSCRIBED_FIELDS,
        }),
      ).toBeNull();
    }
  });

  it("never returns a tag that isn't one of the two documented values or null", () => {
    for (const field of DIVE_LOG_FIELD_NAMES) {
      const tag = computeFieldTag({ ...base, field, current: TRANSCRIBED, initial: TRANSCRIBED });
      expect([null, "transcribed", "edited"]).toContain(tag);
    }
  });
});

describe("collectDiveLogLineage", () => {
  it("splits extracted fields into left-as-heard and corrected", () => {
    const corrected = draft({ ...TRANSCRIBED, maxDepthFt: 58, visibility: "excellent" });
    const lineage = collectDiveLogLineage(corrected, TRANSCRIBED, TRANSCRIBED_FIELDS);

    expect(lineage.editedFields).toEqual(["maxDepthFt", "visibility"]);
    expect(lineage.transcribedFields).toEqual(["runtimeMinutes", "marineLife", "current"]);
  });

  it("accounts for every extracted field exactly once", () => {
    // No field may go missing from the record — the split is the only
    // signal that would ever reveal a systematically bad extractor.
    const corrected = draft({ ...TRANSCRIBED, runtimeMinutes: 44 });
    const lineage = collectDiveLogLineage(corrected, TRANSCRIBED, TRANSCRIBED_FIELDS);
    const combined = [...lineage.transcribedFields, ...lineage.editedFields].sort();
    expect(combined).toEqual([...TRANSCRIBED_FIELDS].sort());
  });

  it("records nothing when there was nothing extracted (the manual path)", () => {
    const lineage = collectDiveLogLineage(draft({ maxDepthFt: 30 }), emptyDiveLogDraft(), []);
    expect(lineage).toEqual({ transcribedFields: [], editedFields: [] });
  });

  it("puts every field in 'edited' when the diver corrected all of them", () => {
    const corrected = draft({
      maxDepthFt: 10,
      runtimeMinutes: 10,
      marineLife: ["Octopus"],
      visibility: "poor",
      current: "strong",
    });
    const lineage = collectDiveLogLineage(corrected, TRANSCRIBED, TRANSCRIBED_FIELDS);
    expect(lineage.transcribedFields).toEqual([]);
    expect(lineage.editedFields).toEqual([...TRANSCRIBED_FIELDS]);
  });
});

describe("diveLogFieldLabel", () => {
  it("has a non-empty label for every field", () => {
    for (const field of DIVE_LOG_FIELD_NAMES) {
      expect(diveLogFieldLabel(field)).toBeTruthy();
    }
  });

  it("matches the mockups' field labels", () => {
    expect(diveLogFieldLabel("maxDepthFt")).toBe("Max depth");
    expect(diveLogFieldLabel("runtimeMinutes")).toBe("Runtime");
    expect(diveLogFieldLabel("marineLife")).toBe("Marine life");
  });

  it("labels the fields added by plan.md's v5 correction", () => {
    expect(diveLogFieldLabel("buddy")).toBe("Buddy");
    expect(diveLogFieldLabel("tankPressure")).toBe("Tank pressure");
    expect(diveLogFieldLabel("waterTempF")).toBe("Water temp");
    expect(diveLogFieldLabel("exposureSuit")).toBe("Exposure suit");
  });
});
