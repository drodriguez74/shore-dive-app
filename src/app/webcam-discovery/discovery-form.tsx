"use client";

/**
 * Interactive half of the T19.1 manual-trigger surface. Lets a signed-in
 * user submit a small batch of candidate URLs and run them through the
 * real extract -> submit pipeline (`POST /api/webcam-discovery`), then
 * shows the per-candidate outcome. Mirrors
 * `src/app/moderation/camera-sources/queue-client.tsx`'s split (server
 * component does auth/config checks, this client component handles the
 * interactive form) and its "call our own API route, handle the response
 * shape defensively" pattern.
 *
 * This is a discovery-*candidate* form, not a discovery-*source* form --
 * see `page.tsx` and `src/lib/webcam-discovery/discover-candidates.ts` for
 * why there's no "find candidates for me" button here: this codebase
 * deliberately does not autonomously discover URLs (THREAT_MODEL.md §9).
 */

import { useState } from "react";
import type { CandidateSubmissionResult } from "@/lib/webcam-discovery/types";

interface CandidateRow {
  key: number;
  url: string;
  contextText: string;
  suggestedSiteId: string;
}

let nextKey = 1;

function emptyRow(): CandidateRow {
  return { key: nextKey++, url: "", contextText: "", suggestedSiteId: "" };
}

interface RunSummaryResponse {
  ok: boolean;
  considered?: number;
  inserted?: number;
  duplicate?: number;
  failed?: number;
  results?: CandidateSubmissionResult[];
  error?: string;
}

export function DiscoveryForm() {
  const [rows, setRows] = useState<CandidateRow[]>([emptyRow()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RunSummaryResponse | null>(null);

  function updateRow(key: number, field: keyof Omit<CandidateRow, "key">, value: string) {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((row) => row.key !== key)));
  }

  async function runDiscovery() {
    setError(null);
    setSummary(null);

    const candidates = rows
      .filter((row) => row.url.trim().length > 0)
      .map((row) => ({
        url: row.url.trim(),
        ...(row.contextText.trim() ? { contextText: row.contextText.trim() } : {}),
        ...(row.suggestedSiteId.trim() ? { suggestedSiteId: row.suggestedSiteId.trim() } : {}),
      }));

    if (candidates.length === 0) {
      setError("Add at least one candidate URL.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/webcam-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidates }),
      });

      const payload = (await response.json().catch(() => null)) as RunSummaryResponse | null;

      if (!response.ok || !payload) {
        setError(payload?.error ?? `Request failed (${response.status}).`);
        return;
      }

      setSummary(payload);
    } catch (err) {
      // A network failure calling our own API route is an expected,
      // handleable path (CLAUDE.md: every I/O boundary must fail
      // explicitly), not an uncaught rejection left to surface as a
      // blank/broken button.
      setError(err instanceof Error ? err.message : "Network error contacting the discovery endpoint.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Candidate URLs</h2>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                URL (required)
                <input
                  type="text"
                  value={row.url}
                  onChange={(event) => updateRow(row.key, "url", event.target.value)}
                  placeholder="https://example.com/beach-cam.m3u8"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Context (optional -- where/how you found it)
                <input
                  type="text"
                  value={row.contextText}
                  onChange={(event) => updateRow(row.key, "contextText", event.target.value)}
                  placeholder="Municipal parks-department page for La Jolla Cove"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                Suggested site id (optional)
                <input
                  type="text"
                  value={row.suggestedSiteId}
                  onChange={(event) => updateRow(row.key, "suggestedSiteId", event.target.value)}
                  placeholder="uuid of a sites row, if known"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-black dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                disabled={rows.length === 1}
                className="self-start text-xs font-medium text-rose-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-rose-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addRow}
            className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500"
          >
            Add another candidate
          </button>
          <button
            type="button"
            onClick={runDiscovery}
            disabled={isSubmitting}
            className="rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            {isSubmitting ? "Running..." : "Run extract + submit"}
          </button>
        </div>
      </section>

      {error && (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      {summary && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
            Run result -- considered {summary.considered ?? 0}, inserted {summary.inserted ?? 0}, duplicate{" "}
            {summary.duplicate ?? 0}, failed {summary.failed ?? 0}
          </h2>
          <ul className="flex flex-col gap-2">
            {(summary.results ?? []).map((result, index) => (
              <li
                key={`${result.input.url}-${index}`}
                className="rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={result.status} />
                  <span className="break-all font-medium text-zinc-700 dark:text-zinc-300">{result.input.url}</span>
                </div>
                {result.extracted && (
                  <p className="mt-1 text-zinc-500 dark:text-zinc-400">
                    Extracted name: {result.extracted.name} · confidence: {result.extracted.confidence.toFixed(2)}
                  </p>
                )}
                {result.error && <p className="mt-1 text-rose-600 dark:text-rose-400">{result.error}</p>}
              </li>
            ))}
          </ul>
          {(summary.inserted ?? 0) > 0 && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Inserted candidates are <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">pending_review</code>{" "}
              -- see the{" "}
              <a href="/moderation/camera-sources" className="text-sky-600 underline dark:text-sky-400">
                moderation queue
              </a>{" "}
              to approve or reject them. Nothing here is ever auto-published.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: CandidateSubmissionResult["status"] }) {
  const styles: Record<CandidateSubmissionResult["status"], string> = {
    inserted:
      "border-emerald-400 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300",
    duplicate: "border-amber-400 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:text-amber-300",
    failed: "border-rose-400 bg-rose-500/10 text-rose-700 dark:border-rose-500/40 dark:text-rose-300",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles[status]}`}>
      {status}
    </span>
  );
}
