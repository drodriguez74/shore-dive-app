"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LDS_STATUS_LABEL, LDS_STATUS_VALUES, type LdsStatusRow, type LdsStatusValue } from "./lds-status";

/**
 * Community submission form for updating an LDS/fill-station's status
 * (T16.3). Always produces a `COMMUNITY`-tagged report: there is no
 * `VERIFIED` option in this form at all, deliberately — not defaulted-away,
 * genuinely absent, so no client bug can send one. The server enforces the
 * same thing independently (`src/app/api/lds/submit/route.ts` hardcodes
 * `provenance`), and `lds_status_insert_own`'s RLS `with check` is the real
 * boundary underneath both.
 *
 * 2026-08-20 — THIS FORM NOW REACHES A REAL BACKEND. It previously called
 * `saveLdsSubmission()`, a `localStorage` stand-in from when there was no
 * live Supabase project, so a diver who filed a report to warn others that a
 * fill station was closed was writing to their own browser and nowhere else
 * (`plan.md` v5 Task 16 addendum named this exact gap). The stand-in module
 * has been deleted rather than left dormant. Two invariants came out of that
 * fix and should not be quietly regressed:
 *
 *  1. **Sign-in is checked before the diver types, not after they submit.**
 *     `lds_status`' insert policy is granted `to authenticated`, so an
 *     anonymous report cannot be filed at all. Letting someone fill out a
 *     form that is guaranteed to fail is the same class of dishonesty as the
 *     bug being fixed, so a signed-out visitor gets a real sign-in prompt in
 *     place of the form — the same `NoticeCard`-style treatment
 *     `src/app/dive-plans/page.tsx` and `/moderation/camera-sources` already
 *     use for a self-service write.
 *  2. **The success message describes what actually happened** — a new
 *     community report, visible to other divers on their next load — with no
 *     claim of instant, guaranteed, or verified propagation.
 *
 * The free-text "notes" field that used to live here is gone. `lds_status`
 * has no notes column (`0001_init.sql`), so the stand-in stored it only in
 * the browser; persisting it would silently drop it. `plan.md` v5 separately
 * flags that field as scope leak ("already leaking scope [toward pricing,
 * classes, rental catalogs] with no stated policy"). Re-adding it needs both
 * a real column and that policy first.
 */

export interface LdsSubmissionFormProps {
  /** The shop this report is about — fixed by the calling row/popup, not
   * freely editable, so a report can't get attributed to the wrong shop.
   * `siteId`+`shopName` together are the same shop-identity key
   * `latestStatusPerShop()` groups the append-only log by. */
  siteId: string | null;
  shopName: string;
  latitude: number;
  longitude: number;
  /** Resolved server-side by the page that renders this form's caller.
   * Gates the form itself (see invariant 1 above); the API route re-checks
   * the real session regardless — this prop is a UX affordance, never the
   * security boundary. */
  isSignedIn: boolean;
  /** Called with the row the server actually inserted, so the caller can
   * merge it into its own marker state and show the new status immediately
   * without a refetch or a full page reload (the same pattern
   * `dive-site-explorer.tsx`'s `handleCandidateAdded` established). */
  onSubmitted?: (marker: LdsStatusRow) => void;
  /** Collapses the form back to its trigger. Separate from `onSubmitted` on
   * purpose: the merge has to happen the moment the write lands, but the
   * diver decides when to dismiss the confirmation. */
  onClose?: () => void;
  className?: string;
}

type SubmitState = "idle" | "saving" | "success";

const CARD_CLASSES =
  "flex flex-col gap-2.5 rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-depth-border dark:bg-depth-1";

export function LdsSubmissionForm({
  siteId,
  shopName,
  latitude,
  longitude,
  isSignedIn,
  onSubmitted,
  onClose,
  className = "",
}: LdsSubmissionFormProps) {
  const [status, setStatus] = useState<LdsStatusValue>("open");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorText(null);

    // Defensive — the <select> only offers valid values, but a
    // provenance-tagged, safety-adjacent write path shouldn't trust that
    // alone. The server validates independently
    // (`parseLdsSubmissionBody`); this just avoids a pointless round trip.
    if (!(LDS_STATUS_VALUES as readonly string[]).includes(status)) {
      setErrorText("Choose a valid status.");
      return;
    }
    // Mirrors `lds_status`' own check constraints, same reasoning.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setErrorText("This shop's coordinates look invalid — can't submit.");
      return;
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setErrorText("This shop's coordinates look invalid — can't submit.");
      return;
    }

    setSubmitState("saving");
    try {
      const response = await fetch("/api/lds/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          name: shopName,
          latitude,
          longitude,
          status,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        marker?: LdsStatusRow;
      };

      if (!response.ok) {
        // The route's messages are written to be shown as-is (rate-limit
        // wording, "sign in required", "that site no longer exists"), so
        // pass them through rather than flattening every failure into one
        // generic string the diver can't act on.
        setSubmitState("idle");
        setErrorText(payload.error ?? `Couldn't save your report (${response.status}) — try again.`);
        return;
      }

      if (!payload.marker) {
        setSubmitState("idle");
        setErrorText("The report may not have saved — reload and check before relying on it.");
        return;
      }

      setSubmitState("success");
      onSubmitted?.(payload.marker);
    } catch (error) {
      // Network/offline path. This app treats the network as absent by
      // default (CLAUDE.md), and a diver at a trailhead with one bar is the
      // expected case, not the edge case — so say plainly that nothing was
      // saved rather than leaving it ambiguous.
      console.error("[LdsSubmissionForm] submit failed", {
        shopName,
        error: error instanceof Error ? error.message : error,
      });
      setSubmitState("idle");
      setErrorText("Couldn't reach the server, so your report wasn't saved. Check your connection and retry.");
    }
  }

  if (!isSignedIn) {
    return (
      <div className={`${CARD_CLASSES} ${className}`}>
        <p className="text-xs font-medium text-black dark:text-zinc-50">Sign in to report a status</p>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          Status reports are attributed to an account so other divers can see one person&apos;s report from
          many, and so a bad report can be traced. Reports stay tagged{" "}
          <span className="font-medium">Community</span> either way.
        </p>
        <Link
          href="/login"
          className="self-start rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (submitState === "success") {
    return (
      <div className={`${CARD_CLASSES} ${className}`}>
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Report saved</p>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {shopName} is now showing <span className="font-medium">{LDS_STATUS_LABEL[status]}</span> as the most
          recent <span className="font-medium">Community</span> report. Other divers see it the next time they
          load the map or the fill-stations list — it doesn&apos;t notify anyone, and it doesn&apos;t make the
          listing Verified.
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="self-start text-xs font-semibold text-violet-700 hover:underline dark:text-violet-400"
          >
            Done
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD_CLASSES} ${className}`}>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Report status for <span className="font-medium text-black dark:text-zinc-50">{shopName}</span>.
        Submitted reports are tagged <span className="font-medium">Community</span> — they can&apos;t mark a
        status as Verified.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Status</span>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as LdsStatusValue)}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-depth-border dark:bg-depth-2"
        >
          {LDS_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {LDS_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </label>

      {errorText && <p className="text-xs text-red-700 dark:text-red-400">{errorText}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitState === "saving"}
          className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitState === "saving" ? "Submitting…" : "Submit report"}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
