"use client";

/**
 * The structured dive-log form — mockups 04 (confirm/edit) and 05 (manual
 * entry).
 *
 * ## One component, two modes, on purpose
 *
 * Mockup 05 reuses "the *exact same* structured form as confirm/edit — same
 * fields, same layout, same input components — with the
 * 'Transcribed'/'Edited' tags simply absent." Building these as two
 * components would make that promise a coincidence maintained by hand;
 * building it as one mode flag makes it structural. The only differences
 * `mode` produces are the heading, the presence of lineage tags, the raw
 * transcript block, and the draft framing — everything a diver types is
 * identical, which is what "first-class, not an apology screen" has to mean
 * in code and not just in copy.
 *
 * ## The confirm/edit gate, third layer
 *
 * `machine.ts` guarantees no transition reaches `saved` without review;
 * `field-tags.ts` marks each field's lineage. This file carries the copy
 * layer the flow doc asks for: a persistent "Draft" badge in the header
 * *and* a review line immediately above the action row, "so it's visible
 * regardless of scroll position on a small viewport." Both are gated on
 * `mode === "confirm-edit"` — a manually typed entry is not a draft of
 * anything and saying so would be noise.
 *
 * ## Numeric inputs are held as strings
 *
 * `<input type="number">` has intermediate states no number can represent —
 * empty, "-", "1." — and coercing on every keystroke makes a field
 * impossible to clear and backspace through. So the two numeric fields keep
 * a string editing buffer and publish `number | null` upward on change.
 * That also keeps `field-tags.ts`'s edited/transcribed comparison honest:
 * it compares the published values, so typing "58" over "55" and then
 * restoring "55" correctly returns the tag to "Transcribed".
 */

import { useCallback, useId, useState } from "react";
import { computeFieldTag, diveLogFieldLabel, type DiveLogFormMode } from "@/lib/voice-logging/field-tags";
import { diveLogFormHeading, describeManualEntryReason, type ManualEntryReason } from "@/lib/voice-logging/machine";
import { CURRENT_OPTIONS, VISIBILITY_OPTIONS } from "@/components/post-dive-prompt/types";
import {
  draftHasContent,
  EXPOSURE_SUIT_OPTIONS,
  type CurrentStrength,
  type DiveLogDraft,
  type DiveLogFieldName,
  type ExposureSuit,
  type VisibilityRating,
} from "@/lib/voice-logging/types";
import { describeTranscriptionPrivacy } from "@/lib/voice-logging/stt-support";
import type { TranscriptionPrivacyMode } from "@/lib/voice-logging/types";
import { FieldTagBadge } from "./field-tag-badge";

export interface DiveLogFormProps {
  mode: DiveLogFormMode;
  draft: DiveLogDraft;
  onChange: (draft: DiveLogDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Confirm/edit only: the parser's untouched output, for edited-vs-transcribed comparison. */
  initialDraft?: DiveLogDraft;
  /** Confirm/edit only: fields the parser populated. */
  transcribedFields?: readonly DiveLogFieldName[];
  /** Confirm/edit only: the raw transcript, shown in a collapsible block. */
  transcript?: string | null;
  /** Confirm/edit only: where transcription ran, for the honest privacy line. */
  privacyMode?: TranscriptionPrivacyMode | null;
  /** Manual entry only: why the diver is here. Null renders no explanation. */
  manualEntryReason?: ManualEntryReason;
}

const CARD = "rounded-2xl border border-zinc-200 bg-white dark:border-depth-border dark:bg-depth-1";
const TEXT_INPUT =
  "w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-sky-500 focus:outline-none dark:border-depth-border dark:text-zinc-100 dark:placeholder:text-zinc-600";

function FieldRow({
  label,
  tag,
  children,
  htmlFor,
}: {
  label: string;
  tag: ReturnType<typeof computeFieldTag>;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {label}
        </label>
        <FieldTagBadge tag={tag} />
      </div>
      {children}
    </div>
  );
}

function ChipRow<T extends string>({
  legend,
  options,
  value,
  onSelect,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onSelect: (next: T | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={legend}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(selected ? null : opt.value)}
            className={`min-h-11 rounded-full border px-3.5 text-sm font-medium transition-colors ${
              selected
                ? "border-sky-500 bg-sky-500/15 text-sky-700 dark:border-sky-400 dark:bg-sky-400/15 dark:text-sky-300"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-depth-border dark:text-zinc-400 dark:hover:border-depth-3"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A `number | null` field held as a string while it's being typed. See the
 * header.
 *
 * `unit` may be empty, which renders no suffix — the tank-pressure pair puts
 * one shared "psi" after both inputs rather than repeating it twice.
 */
function NumberField({
  id,
  value,
  unit,
  ariaLabel,
  onChange,
}: {
  id: string;
  value: number | null;
  unit: string;
  ariaLabel: string;
  onChange: (next: number | null) => void;
}) {
  const [buffer, setBuffer] = useState<string | null>(null);
  const shown = buffer ?? (value === null ? "" : String(value));

  const handle = (next: string) => {
    setBuffer(next);
    const trimmed = next.trim();
    if (trimmed === "") {
      onChange(null);
      return;
    }
    const parsed = Number.parseFloat(trimmed);
    // A partially-typed value ("-", "1.") publishes nothing rather than
    // publishing NaN — the field keeps its last committed value until the
    // diver types something real.
    if (Number.isFinite(parsed)) onChange(Math.round(parsed));
  };

  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={shown}
        aria-label={ariaLabel}
        placeholder="0"
        onChange={(event) => handle(event.target.value)}
        onBlur={() => setBuffer(null)}
        className={`${TEXT_INPUT} tabular-nums`}
      />
      {unit !== "" && <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{unit}</span>}
    </div>
  );
}

/**
 * Starting and ending cylinder pressure — one row, two independently
 * clearable numbers.
 *
 * Neither half is required and neither validates against the other. A diver
 * who remembers going in with 3000 but not what they surfaced with has given
 * a real fact, and the form's job is to keep it, not to demand the other
 * one. That matches every other field here (all optional) and the parser,
 * which fills whichever halves the diver actually said.
 */
function TankPressureField({
  startId,
  endId,
  startPsi,
  endPsi,
  onChange,
}: {
  startId: string;
  endId: string;
  startPsi: number | null;
  endPsi: number | null;
  onChange: (next: { tankPressureStartPsi?: number | null; tankPressureEndPsi?: number | null }) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor={startId} className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Start
        </label>
        <NumberField
          id={startId}
          value={startPsi}
          unit=""
          ariaLabel="Starting tank pressure in psi"
          onChange={(tankPressureStartPsi) => onChange({ tankPressureStartPsi })}
        />
      </div>
      <span aria-hidden="true" className="pb-2.5 text-sm text-zinc-400 dark:text-zinc-500">
        →
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor={endId} className="text-[11px] text-zinc-400 dark:text-zinc-500">
          End
        </label>
        <NumberField
          id={endId}
          value={endPsi}
          unit=""
          ariaLabel="Ending tank pressure in psi"
          onChange={(tankPressureEndPsi) => onChange({ tankPressureEndPsi })}
        />
      </div>
      <span className="pb-2.5 text-sm text-zinc-500 dark:text-zinc-400">psi</span>
    </div>
  );
}

function MarineLifeField({
  values,
  onChange,
}: {
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [pending, setPending] = useState("");

  const add = () => {
    const label = pending.trim();
    if (label === "") return;
    // Case-insensitive dedupe: "octopus" typed under an already-extracted
    // "Octopus" is the same sighting, and two near-identical chips would
    // read as two animals.
    if (!values.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
      onChange([...values, label]);
    }
    setPending("");
  };

  return (
    <div className="flex flex-col gap-2">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((label) => (
            <li
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-500/10 py-1 pl-3 pr-1.5 text-sm text-violet-800 dark:border-violet-500/50 dark:text-violet-200"
            >
              {label}
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() => onChange(values.filter((item) => item !== label))}
                className="flex h-6 w-6 items-center justify-center rounded-full text-violet-600 hover:bg-violet-500/20 dark:text-violet-300"
              >
                <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={pending}
          placeholder="Add a sighting"
          aria-label="Add a marine life sighting"
          onChange={(event) => setPending(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              // Without this the Enter key would submit the surrounding
              // form and save a draft the diver was still filling in.
              event.preventDefault();
              add();
            }
          }}
          className={TEXT_INPUT}
        />
        <button
          type="button"
          onClick={add}
          disabled={pending.trim() === ""}
          className="min-h-11 shrink-0 rounded-xl border border-zinc-300 px-4 text-sm font-medium text-zinc-600 hover:border-zinc-400 disabled:opacity-40 dark:border-depth-border dark:text-zinc-300 dark:hover:border-depth-3"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function RawTranscript({ transcript, privacyMode }: { transcript: string; privacyMode: TranscriptionPrivacyMode }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-depth-border">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-xs font-medium text-zinc-600 dark:text-zinc-300"
      >
        Raw transcript
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={bodyId} className="border-t border-zinc-200 px-3 py-2.5 dark:border-depth-border">
          {/*
            The point of showing this at all: a diver can check a suspicious
            number against what they actually said, rather than trusting the
            extraction blind — THREAT_MODEL.md §3's mitigation for a
            misheard depth.
          */}
          <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">&ldquo;{transcript}&rdquo;</p>
          <p className="mt-2 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
            {describeTranscriptionPrivacy(privacyMode)}
          </p>
        </div>
      )}
    </div>
  );
}

export function DiveLogForm({
  mode,
  draft,
  onChange,
  onSave,
  onCancel,
  initialDraft,
  transcribedFields = [],
  transcript = null,
  privacyMode = null,
  manualEntryReason,
}: DiveLogFormProps) {
  const headingId = useId();
  const depthId = useId();
  const runtimeId = useId();
  const siteId = useId();
  const buddyId = useId();
  const tankStartId = useId();
  const tankEndId = useId();
  const waterTempId = useId();
  const notesId = useId();

  const isReview = mode === "confirm-edit";
  const baseline = initialDraft ?? draft;

  const tagFor = useCallback(
    (field: DiveLogFieldName) =>
      computeFieldTag({ field, mode, current: draft, initial: baseline, transcribedFields }),
    [mode, draft, baseline, transcribedFields],
  );

  const patch = useCallback(
    (changes: Partial<DiveLogDraft>) => onChange({ ...draft, ...changes }),
    [draft, onChange],
  );

  const explanation = manualEntryReason ? describeManualEntryReason(manualEntryReason) : null;

  return (
    <section className={`${CARD} flex flex-col gap-4 p-4`} aria-labelledby={headingId}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="font-display text-lg font-semibold text-black dark:text-zinc-50">
            {diveLogFormHeading(mode)}
          </h2>
          {isReview && (
            <span className="inline-flex items-center rounded-full border border-dashed border-amber-500 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              Draft — not saved yet
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {isReview
            ? "We turned your recording into the draft below. Check each field — nothing saves until you confirm."
            : "Same structured log as voice entry — just typed in."}
        </p>
      </div>

      {explanation && (
        <p className="rounded-xl border border-zinc-200 px-3 py-2.5 text-xs leading-relaxed text-zinc-600 dark:border-depth-border dark:text-zinc-300">
          {explanation}
        </p>
      )}

      {isReview && transcript && <RawTranscript transcript={transcript} privacyMode={privacyMode ?? "unknown"} />}

      <div className="flex flex-col gap-4">
        <FieldRow label={diveLogFieldLabel("site")} tag={tagFor("site")} htmlFor={siteId}>
          <input
            id={siteId}
            type="text"
            value={draft.site}
            placeholder="Where did you dive?"
            onChange={(event) => patch({ site: event.target.value })}
            className={TEXT_INPUT}
          />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("buddy")} tag={tagFor("buddy")} htmlFor={buddyId}>
          <input
            id={buddyId}
            type="text"
            value={draft.buddy}
            placeholder="Who did you dive with?"
            onChange={(event) => patch({ buddy: event.target.value })}
            className={TEXT_INPUT}
          />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("maxDepthFt")} tag={tagFor("maxDepthFt")} htmlFor={depthId}>
          <NumberField
            id={depthId}
            value={draft.maxDepthFt}
            unit="ft"
            ariaLabel="Max depth in feet"
            onChange={(maxDepthFt) => patch({ maxDepthFt })}
          />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("runtimeMinutes")} tag={tagFor("runtimeMinutes")} htmlFor={runtimeId}>
          <NumberField
            id={runtimeId}
            value={draft.runtimeMinutes}
            unit="min"
            ariaLabel="Runtime in minutes"
            onChange={(runtimeMinutes) => patch({ runtimeMinutes })}
          />
        </FieldRow>

        {/*
          No htmlFor: this row owns two inputs, each with its own visible
          sub-label, so pointing the group label at one of them would tell a
          screen reader the row *is* that input.
        */}
        <FieldRow label={diveLogFieldLabel("tankPressure")} tag={tagFor("tankPressure")}>
          <TankPressureField
            startId={tankStartId}
            endId={tankEndId}
            startPsi={draft.tankPressureStartPsi}
            endPsi={draft.tankPressureEndPsi}
            onChange={patch}
          />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("waterTempF")} tag={tagFor("waterTempF")} htmlFor={waterTempId}>
          <NumberField
            id={waterTempId}
            value={draft.waterTempF}
            unit="°F"
            ariaLabel="Water temperature in degrees Fahrenheit"
            onChange={(waterTempF) => patch({ waterTempF })}
          />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("exposureSuit")} tag={tagFor("exposureSuit")}>
          <ChipRow<ExposureSuit>
            legend="Exposure suit"
            options={EXPOSURE_SUIT_OPTIONS}
            value={draft.exposureSuit}
            onSelect={(exposureSuit) => patch({ exposureSuit })}
          />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("marineLife")} tag={tagFor("marineLife")}>
          <MarineLifeField values={draft.marineLife} onChange={(marineLife) => patch({ marineLife })} />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("visibility")} tag={tagFor("visibility")}>
          <ChipRow<VisibilityRating>
            legend="Visibility"
            options={VISIBILITY_OPTIONS}
            value={draft.visibility}
            onSelect={(visibility) => patch({ visibility })}
          />
        </FieldRow>

        <FieldRow label={diveLogFieldLabel("current")} tag={tagFor("current")}>
          <ChipRow<CurrentStrength>
            legend="Current"
            options={CURRENT_OPTIONS}
            value={draft.current}
            onSelect={(current) => patch({ current })}
          />
        </FieldRow>

        <FieldRow label={`${diveLogFieldLabel("notes")} (optional)`} tag={tagFor("notes")} htmlFor={notesId}>
          <textarea
            id={notesId}
            value={draft.notes}
            rows={3}
            placeholder="Anything else worth remembering?"
            onChange={(event) => patch({ notes: event.target.value })}
            className={`${TEXT_INPUT} resize-y`}
          />
        </FieldRow>
      </div>

      {isReview && (
        <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-500/10 px-3 py-2.5 dark:border-amber-500/40">
          <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true">
            <path
              d="M12 3v0a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM12 8v5M12 16h.01"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            Fields are extracted from your recording and may be wrong — check numbers and names before saving.
          </p>
        </div>
      )}

      {/*
        Device-local persistence, stated plainly. Implementation notes about
        the pending Supabase table live in storage.ts's header, never here —
        a leaked TODO in user copy was a real bug in post-dive-prompt.tsx.
      */}
      <p className="text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
        Saved on this device only for now — not yet synced to an account.
      </p>

      <div className="flex flex-col gap-2">
        {isReview && (
          <p className="text-center text-[11px] text-zinc-500 dark:text-zinc-400">
            This is a draft — review before saving.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-xl border border-zinc-300 px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-depth-border dark:text-zinc-300 dark:hover:bg-depth-2"
          >
            {isReview ? "Discard draft" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!draftHasContent(draft)}
            className="min-h-12 flex-[1.4] rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            Save log
          </button>
        </div>
      </div>
    </section>
  );
}
