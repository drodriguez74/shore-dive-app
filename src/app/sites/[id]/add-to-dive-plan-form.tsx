"use client";

import { useState, type FormEvent } from "react";

/**
 * "Add this site to a new plan" (Task 11.5 / Resolved Decision 5's minimum-
 * viable Dive Plan). Deliberately the smallest possible action — a planned
 * date, an optional free-text "diving with" label (the cheap,
 * disclosure-level buddy-system support `plan.md` v5 calls for, not a real
 * multi-diver state model) — not a full dive-plan-editing UI. Only rendered
 * by the caller when a signed-in user is confirmed server-side (see
 * `src/app/sites/[id]/page.tsx`); this component doesn't check auth itself,
 * it just calls the API route, which does (`src/app/api/dive-plans/route.ts`).
 */

export interface AddToDivePlanFormProps {
  siteId: string;
  siteName: string;
}

type SubmitState = "idle" | "saving" | "success" | "error";

export function AddToDivePlanForm({ siteId, siteName }: AddToDivePlanFormProps) {
  const [plannedDate, setPlannedDate] = useState("");
  const [plannedWindow, setPlannedWindow] = useState("");
  const [divingWith, setDivingWith] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!plannedDate) {
      setErrorMessage("Pick a planned date.");
      return;
    }

    setSubmitState("saving");
    try {
      const response = await fetch("/api/dive-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          planned_date: plannedDate,
          planned_window: plannedWindow.trim() || undefined,
          diving_with: divingWith.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}) as { error?: string });
        throw new Error(payload.error ?? `Request failed (${response.status}).`);
      }

      setSubmitState("success");
    } catch (error) {
      console.error("[AddToDivePlanForm] failed to create dive plan", {
        siteId,
        error: error instanceof Error ? error.message : error,
      });
      setSubmitState("error");
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong — try again.");
    }
  }

  if (submitState === "success") {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        Added {siteName} to your dive plan for {plannedDate}.
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2.5 rounded-lg border border-zinc-200 bg-white p-3.5 text-sm dark:border-depth-border dark:bg-depth-1"
    >
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        This creates a private plan only you can see — it doesn&apos;t start a Safe-Return timer or notify
        anyone.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Planned date</span>
        <input
          type="date"
          value={plannedDate}
          onChange={(event) => setPlannedDate(event.target.value)}
          required
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Window <span className="font-normal text-zinc-400">(optional — e.g. &quot;morning, low tide&quot;)</span>
        </span>
        <input
          type="text"
          value={plannedWindow}
          onChange={(event) => setPlannedWindow(event.target.value)}
          maxLength={60}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="Morning, low tide"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Diving with <span className="font-normal text-zinc-400">(optional)</span>
        </span>
        <input
          type="text"
          value={divingWith}
          onChange={(event) => setDivingWith(event.target.value)}
          maxLength={120}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="Buddy's name"
        />
      </label>

      {errorMessage && <p className="text-xs text-red-700 dark:text-red-400">{errorMessage}</p>}

      <button
        type="submit"
        disabled={submitState === "saving"}
        className="self-start rounded-md bg-sky-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitState === "saving" ? "Adding…" : "Add to dive plan"}
      </button>
    </form>
  );
}
