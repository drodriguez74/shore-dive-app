/**
 * Per-field lineage tags for the confirm/edit form — the *visual* half of
 * the confirm/edit gate.
 *
 * `creative/flows/voice-logging.md` enforces "never auto-commit" three
 * redundant ways, "deliberately redundant so no single design choice is
 * load-bearing on its own." `machine.ts` owns the structural half (no state
 * transition reaches `saved` without passing through review). This module
 * owns the second: every field carries a dashed, muted "Transcribed" tag
 * that flips to a solid `sky` "Edited" tag the moment the diver changes it,
 * "echoing (deliberately, not coincidentally) the visual language
 * `provenance-badge.tsx` already uses for `MODEL_INFERRED`."
 *
 * It lives outside the component because it is a real comparison, not
 * formatting: `marineLife` is an array (needs order-sensitive element
 * comparison, not `===`), numeric fields can round-trip through an empty
 * string in a controlled `<input type="number">`, and "the diver edited it
 * back to exactly what was transcribed" has to resolve to `transcribed`
 * rather than sticking on `edited` — otherwise the tag stops meaning "this
 * value differs from what was heard" and starts meaning "this field was
 * touched at some point", which is not a fact worth showing anyone.
 */

import type { DiveLogDraft, DiveLogFieldName, DiveLogFieldTag } from "./types";

export type DiveLogFormMode = "confirm-edit" | "manual-entry";

function fieldValue(draft: DiveLogDraft, field: DiveLogFieldName): unknown {
  switch (field) {
    case "site":
      return draft.site.trim();
    case "buddy":
      return draft.buddy.trim();
    case "maxDepthFt":
      return draft.maxDepthFt;
    case "runtimeMinutes":
      return draft.runtimeMinutes;
    /*
      Tank pressure is one *field* made of two numbers, not two fields. The
      row renders one label and one tag, so the comparison has to consider
      both halves together: correcting only the surfacing pressure still
      means "this row differs from what was heard", which is what the tag
      claims. Returning a pair also rides on `valuesEqual`'s existing
      element-wise array comparison rather than needing a special case.
    */
    case "tankPressure":
      return [draft.tankPressureStartPsi, draft.tankPressureEndPsi];
    case "waterTempF":
      return draft.waterTempF;
    case "exposureSuit":
      return draft.exposureSuit;
    case "marineLife":
      return draft.marineLife;
    case "visibility":
      return draft.visibility;
    case "current":
      return draft.current;
    case "notes":
      return draft.notes.trim();
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

/** True when the diver has changed `field` away from its transcribed value. */
export function isFieldEdited(current: DiveLogDraft, initial: DiveLogDraft, field: DiveLogFieldName): boolean {
  return !valuesEqual(fieldValue(current, field), fieldValue(initial, field));
}

export interface ComputeFieldTagInput {
  field: DiveLogFieldName;
  mode: DiveLogFormMode;
  current: DiveLogDraft;
  initial: DiveLogDraft;
  /** Fields the parser populated. A field absent from this list has no lineage to show. */
  transcribedFields: readonly DiveLogFieldName[];
}

/**
 * The tag to render next to a field's label, or null for no tag.
 *
 * Manual entry always returns null — mockup 05 reuses "the *exact same*
 * structured form... with the 'Transcribed'/'Edited' tags simply absent
 * (there's nothing to attribute)." Absence is itself informative there: an
 * untagged field means "you typed this", which is a stronger provenance
 * claim than either tag, not a weaker one.
 *
 * A field the parser never filled is also untagged even on the voice path,
 * for the same reason — the diver typed it, and calling that "Edited" would
 * imply a transcribed value it was edited *from*.
 */
export function computeFieldTag(input: ComputeFieldTagInput): DiveLogFieldTag {
  if (input.mode === "manual-entry") return null;
  if (!input.transcribedFields.includes(input.field)) return null;
  return isFieldEdited(input.current, input.initial, input.field) ? "edited" : "transcribed";
}

export interface DiveLogLineage {
  /** Transcribed fields the diver reviewed and left as heard. */
  transcribedFields: DiveLogFieldName[];
  /** Transcribed fields the diver corrected. */
  editedFields: DiveLogFieldName[];
}

/**
 * Split the parser's fields into "left as heard" and "corrected" at save
 * time, for persistence on the entry.
 *
 * Worth keeping rather than discarding once the form closes: it is the only
 * signal that would ever show whether the extractor is trustworthy in the
 * field. A high correction rate on `maxDepthFt` specifically is the
 * observable symptom of THREAT_MODEL.md §3's misrecognition finding, and
 * without this it would be invisible.
 */
export function collectDiveLogLineage(
  current: DiveLogDraft,
  initial: DiveLogDraft,
  transcribedFields: readonly DiveLogFieldName[],
): DiveLogLineage {
  const transcribed: DiveLogFieldName[] = [];
  const edited: DiveLogFieldName[] = [];

  for (const field of transcribedFields) {
    if (isFieldEdited(current, initial, field)) {
      edited.push(field);
    } else {
      transcribed.push(field);
    }
  }

  return { transcribedFields: transcribed, editedFields: edited };
}

/** Human label for a field, shared by the form and the saved-entry list. */
export function diveLogFieldLabel(field: DiveLogFieldName): string {
  switch (field) {
    case "site":
      return "Site";
    case "buddy":
      return "Buddy";
    case "maxDepthFt":
      return "Max depth";
    case "runtimeMinutes":
      return "Runtime";
    case "tankPressure":
      return "Tank pressure";
    case "waterTempF":
      return "Water temp";
    case "exposureSuit":
      return "Exposure suit";
    case "marineLife":
      return "Marine life";
    case "visibility":
      return "Visibility";
    case "current":
      return "Current";
    case "notes":
      return "Notes";
  }
}
