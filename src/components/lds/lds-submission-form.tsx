"use client";

import { useState, type FormEvent } from "react";
import { LDS_STATUS_LABEL, type LdsStatusValue } from "./lds-status";
import { saveLdsSubmission } from "./lds-submissions-store";

/**
 * Community submission form for updating an LDS/fill-station's status
 * (T16.3) — "this fill station is open/closed, air availability, etc."
 * Always produces a `COMMUNITY`-tagged submission (P0-B.4's moderated write
 * path: per `supabase/README.md`'s RLS design, a self-submitter can never
 * write `VERIFIED` directly). There's no `VERIFIED` option in this form at
 * all, deliberately — not just defaulted, so there's no path for a client
 * bug to send it.
 *
 * No live backend yet — see `lds-submissions-store.ts` for the localStorage
 * stand-in and its TODO for the real Supabase write path.
 */

const STATUS_OPTIONS: LdsStatusValue[] = ["open", "closed", "limited", "unknown"];

export interface LdsSubmissionFormProps {
  /** The shop this submission is about — fixed by the calling marker/popup,
   * not freely editable, so a report can't accidentally get attributed to
   * the wrong shop. `siteId`+`shopName` together are the same shop-identity
   * key `latestStatusPerShop()` in `lds-status.ts` groups the append-only
   * log by. */
  siteId: string | null;
  shopName: string;
  latitude: number;
  longitude: number;
  /** Called after a successful local save, so the caller (e.g. the map
   * popup) can close the form / refresh its view. */
  onSubmitted?: () => void;
  className?: string;
}

type SubmitState = "idle" | "saving" | "success" | "error";

export function LdsSubmissionForm({
  siteId,
  shopName,
  latitude,
  longitude,
  onSubmitted,
  className = "",
}: LdsSubmissionFormProps) {
  const [status, setStatus] = useState<LdsStatusValue>("unknown");
  const [note, setNote] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    if (!STATUS_OPTIONS.includes(status)) {
      // Defensive — the <select> below only ever offers valid values, but a
      // provenance-tagged, safety-adjacent write path shouldn't trust that
      // alone (CLAUDE.md: "no unmoderated write path to provenance-tagged
      // data" — validate at every boundary, not just the UI control).
      setValidationError("Choose a valid status.");
      return;
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      // Mirrors the `lds_status` table's own check constraints — fail the
      // same way the database would rather than send a row that's certain
      // to be rejected once a real backend exists.
      setValidationError("This shop's coordinates look invalid — can't submit.");
      return;
    }

    setSubmitState("saving");
    try {
      const saved = saveLdsSubmission({
        site_id: siteId,
        name: shopName,
        latitude,
        longitude,
        status,
        note: note.trim() || undefined,
        // TODO(P0-A): attribute to the signed-in user once this form is
        // gated behind auth — no session wired into this component yet.
        created_by: null,
      });

      if (!saved) {
        setSubmitState("error");
        return;
      }

      setSubmitState("success");
      setNote("");
      onSubmitted?.();
    } catch (error) {
      console.error("[LdsSubmissionForm] submit failed", {
        shopName,
        error: error instanceof Error ? error.message : error,
      });
      setSubmitState("error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex flex-col gap-2.5 rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Report status for <span className="font-medium text-black dark:text-zinc-50">{shopName}</span>. Submitted
        reports are tagged <span className="font-medium">Community</span> — they can&apos;t mark a status as
        Verified.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Status</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as LdsStatusValue)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          {STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {LDS_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Notes <span className="font-normal text-zinc-400">(optional — e.g. air fill availability, hours)</span>
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={280}
          rows={2}
          className="resize-none rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="Nitrox available, cash only, closes early on Sundays..."
        />
      </label>

      {validationError && <p className="text-xs text-red-700 dark:text-red-400">{validationError}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitState === "saving"}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitState === "saving" ? "Submitting…" : "Submit report"}
        </button>
        {submitState === "success" && (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">
            Saved on this device. No live backend yet — this doesn&apos;t reach other users.
          </span>
        )}
        {submitState === "error" && (
          <span className="text-xs text-red-700 dark:text-red-400">Couldn&apos;t save — try again.</span>
        )}
      </div>
    </form>
  );
}
