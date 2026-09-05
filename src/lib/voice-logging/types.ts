/**
 * Shared types for the Frictionless Voice Logging pillar (CLAUDE.md Product
 * §3, plan.md's voice-logging pillar, THREAT_MODEL.md §3).
 *
 * ## Relationship to the post-dive micro-prompt (Task 14)
 *
 * `src/components/post-dive-prompt/` is a deliberately *different, smaller*
 * feature: a single-tap conditions card (visibility / current / one
 * marine-life yes-no). Its own `types.ts` header says so explicitly — "if it
 * needs a text field or a multi-step form, it belongs in the voice-logging
 * feature, not here." This is that feature.
 *
 * The two overlap on exactly two enums (visibility rating, current
 * strength), and those are **imported from the micro-prompt module rather
 * than redeclared** — a diver saying "visibility was good" and a diver
 * tapping the "Good" chip must mean the same thing, or the two logs can
 * never be reconciled when a real `dive_logs` table lands. Everything else
 * here (depth, runtime, marine-life list, free-text notes, per-field
 * provenance) is new and belongs only to this pillar.
 *
 * ## Per-field provenance is a hard requirement, not decoration
 *
 * CLAUDE.md: "Transcribed fields require a confirm/edit step before saving —
 * never auto-commit." THREAT_MODEL.md §3 names the specific failure this
 * guards against: `"45 feet" heard as "15 feet"` silently corrupting a
 * logbook that a diver may later plan against. So a saved entry records,
 * per field, whether the value came from a transcript untouched
 * (`transcribed`) or was corrected by the diver (`edited`) — the same
 * lineage discipline `provenance-badge.tsx` applies to site/hazard data,
 * applied to the diver's own log.
 */

import type { CurrentStrength, VisibilityRating } from "@/components/post-dive-prompt/types";

export type { CurrentStrength, VisibilityRating };

/**
 * ## The v5 field-list correction
 *
 * The original build shipped max depth, runtime, marine life, and conditions.
 * `plan.md`'s v5 diver review found that list missing "the two fields most
 * standard logbooks and dive computers treat as basic" — **tank pressure
 * (start/end)** and **buddy name** — plus water temp and exposure suit as
 * worthwhile additions. Those four are added here.
 *
 * **Entry/exit time is deliberately not added**, though the same paragraph
 * lists it as a possibility ("if scope allows"). Three reasons, recorded so
 * the next reader doesn't re-litigate it as an oversight:
 *
 * 1. Runtime already carries the safety-relevant quantity. Entry/exit
 *    timestamps are only *additionally* useful for surface-interval and
 *    repetitive-dive planning, and this app has no repetitive-dive feature
 *    for them to feed — the data would be inert.
 * 2. They are the only fields here that need a real wall-clock date, not
 *    just a value: "4:15" is meaningless without the day, and a logbook
 *    entry saved the next morning would silently attach the wrong one.
 * 3. Two more rows on an already-eleven-row form is a real cost against a
 *    pillar whose whole framing is the absence of friction, for a pair of
 *    fields a diver rarely states in a post-dive voice memo.
 *
 * If repetitive-dive planning ever lands, revisit — that's the feature that
 * would make them earn their place.
 */

/** Every editable field on the structured log form, in render order. */
export type DiveLogFieldName =
  | "site"
  | "buddy"
  | "maxDepthFt"
  | "runtimeMinutes"
  | "tankPressure"
  | "waterTempF"
  | "exposureSuit"
  | "marineLife"
  | "visibility"
  | "current"
  | "notes";

export const DIVE_LOG_FIELD_NAMES: readonly DiveLogFieldName[] = [
  "site",
  "buddy",
  "maxDepthFt",
  "runtimeMinutes",
  "tankPressure",
  "waterTempF",
  "exposureSuit",
  "marineLife",
  "visibility",
  "current",
  "notes",
] as const;

/**
 * Exposure protection worn.
 *
 * A closed option set rather than free text, for the same reason
 * `Visibility` and `Current` are chip-selects: a field whose values need to
 * be comparable across entries can't be a text box, or "3mm", "3 mil", and
 * "shorty" become three different answers to one question.
 *
 * Thickness is deliberately excluded. It varies by garment and by water, and
 * capturing it properly means a second numeric field for a detail that
 * doesn't change any decision the app makes — the suit *type* is what tells
 * a diver whether they were warm enough at this site in this season.
 */
export type ExposureSuit = "none" | "skin" | "shorty" | "wetsuit" | "drysuit";

export const EXPOSURE_SUIT_OPTIONS: readonly { value: ExposureSuit; label: string }[] = [
  { value: "none", label: "None" },
  { value: "skin", label: "Skin" },
  { value: "shorty", label: "Shorty" },
  { value: "wetsuit", label: "Wetsuit" },
  { value: "drysuit", label: "Drysuit" },
] as const;

/**
 * Per-field lineage tag rendered on the confirm/edit screen.
 *
 * - `transcribed` — dashed, muted. Deliberately echoes the `MODEL_INFERRED`
 *   treatment in `provenance-badge.tsx`: extracted, plausible, unconfirmed.
 * - `edited` — solid `sky`. The diver looked at it and changed it.
 * - `null` — no lineage to show (the manual-entry path, or a field the
 *   parser never populated). Absence of a tag is meaningful: it means
 *   "you typed this," not "we're not sure."
 */
export type DiveLogFieldTag = "transcribed" | "edited" | null;

/** How a saved entry was produced. */
export type DiveLogEntryMethod = "voice" | "manual";

/**
 * Where the browser's speech recognition actually ran.
 *
 * This exists because the obvious assumption is wrong in a way that matters
 * for THREAT_MODEL.md §3's consent finding: the Web Speech API is **not
 * guaranteed to be on-device**. Chrome historically streams audio to a
 * remote Google speech service, and Safari's implementation is
 * server-backed by default too. Only Chrome 138+'s `processLocally` mode,
 * gated on `SpeechRecognition.availableOnDevice()`, is genuinely local.
 *
 * The UI must never claim more privacy than the resolved mode supports —
 * see `describeTranscriptionPrivacy()` in `stt-support.ts`.
 */
export type TranscriptionPrivacyMode = "on-device" | "browser-service" | "unknown";

/** The editable draft — what the confirm/edit and manual-entry forms bind to. */
export interface DiveLogDraft {
  /** Free-text site name. Never parsed from speech (see `parse-transcript.ts`). */
  site: string;
  /**
   * Dive buddy's name, free text.
   *
   * **This is a third party's name, and it is PII that the diver's own
   * consent does not cover.** THREAT_MODEL.md §3 already flags a buddy's
   * voice reaching a third party without consent; a buddy's *name* in a
   * structured field is the same finding in a more durable form. It is
   * therefore held to `storage.ts`'s retention rules exactly as the raw
   * transcript is — device-local, never transmitted, never logged (see
   * `logger.ts`, which records field *counts*, never values) — and syncing
   * it to a server later is a separate consent decision, not an automatic
   * consequence of a `dive_logs` table existing.
   *
   * Not pre-filled from anything: there is no buddy/`diving_with` context in
   * the app today, and inventing one would be a data source that doesn't
   * exist.
   */
  buddy: string;
  /**
   * Max depth in feet. Feet is the stored unit; a spoken metric depth is
   * converted at parse time (see `parse-transcript.ts`) rather than stored
   * ambiguously — a logbook with mixed, unlabelled units is exactly the
   * silent-corruption failure THREAT_MODEL.md §3 warns about.
   */
  maxDepthFt: number | null;
  /** Total runtime in whole minutes. */
  runtimeMinutes: number | null;
  /**
   * Starting tank pressure in psi.
   *
   * psi is the stored unit for the same reason feet is for depth — a spoken
   * `bar` value is converted at parse time rather than stored unlabelled.
   *
   * Start and end are two independent nullable numbers, not a required pair:
   * a diver who remembers going in with 3000 but not what they surfaced with
   * has given a real, partial fact, and rejecting it would be the form
   * telling a diver their memory is invalid. Every field in this draft is
   * optional; this one is optional twice.
   */
  tankPressureStartPsi: number | null;
  /** Ending tank pressure in psi. Independently nullable — see the start field. */
  tankPressureEndPsi: number | null;
  /** Water temperature in °F. Metric input is converted at parse time. */
  waterTempF: number | null;
  /** Exposure protection worn. */
  exposureSuit: ExposureSuit | null;
  /** Free-text sighting labels, e.g. `["Garibaldi", "Leopard shark (maybe)"]`. */
  marineLife: string[];
  visibility: VisibilityRating | null;
  current: CurrentStrength | null;
  notes: string;
}

/** A saved logbook entry. */
export interface DiveLogEntry extends DiveLogDraft {
  id: string;
  /** Client clock at save time. */
  loggedAt: number;
  /** Dive site this pertains to, when a real dive-plan/site context supplied one. */
  siteId: string | null;
  entryMethod: DiveLogEntryMethod;
  /** Transcript-derived fields the diver reviewed and left unchanged. */
  transcribedFields: DiveLogFieldName[];
  /** Transcript-derived fields the diver corrected before saving. */
  editedFields: DiveLogFieldName[];
  /**
   * The raw transcript, retained so a diver can audit a suspicious number
   * against what they actually said — the mitigation THREAT_MODEL.md §3
   * asks for. Null on the manual path (there was never a recording).
   * Device-local only; see `storage.ts` for the retention note.
   */
  transcript: string | null;
  /** Recording length in ms, or null on the manual path. */
  recordingMs: number | null;
  /** Where transcription ran, or null on the manual path. */
  transcriptionPrivacyMode: TranscriptionPrivacyMode | null;
}

/** A draft plus the lineage bookkeeping needed to save it. */
export interface DiveLogSubmission {
  draft: DiveLogDraft;
  siteId: string | null;
  entryMethod: DiveLogEntryMethod;
  transcribedFields: DiveLogFieldName[];
  editedFields: DiveLogFieldName[];
  transcript: string | null;
  recordingMs: number | null;
  transcriptionPrivacyMode: TranscriptionPrivacyMode | null;
}

/** An empty draft. `site` is pre-fillable from a known dive-plan context. */
export function emptyDiveLogDraft(site = ""): DiveLogDraft {
  return {
    site,
    buddy: "",
    maxDepthFt: null,
    runtimeMinutes: null,
    tankPressureStartPsi: null,
    tankPressureEndPsi: null,
    waterTempF: null,
    exposureSuit: null,
    marineLife: [],
    visibility: null,
    current: null,
    notes: "",
  };
}

/** True when a draft has at least one field worth saving. Guards the Save button. */
export function draftHasContent(draft: DiveLogDraft): boolean {
  return (
    draft.site.trim() !== "" ||
    draft.buddy.trim() !== "" ||
    draft.maxDepthFt !== null ||
    draft.runtimeMinutes !== null ||
    draft.tankPressureStartPsi !== null ||
    draft.tankPressureEndPsi !== null ||
    draft.waterTempF !== null ||
    draft.exposureSuit !== null ||
    draft.marineLife.length > 0 ||
    draft.visibility !== null ||
    draft.current !== null ||
    draft.notes.trim() !== ""
  );
}
