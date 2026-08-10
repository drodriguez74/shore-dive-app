"use client";

/**
 * Interactive half of the camera_sources moderation queue (T19.2/T19.3).
 * Receives the initial pending/decided rows from the Server Component page
 * (`page.tsx`, which fetches them with the service-role client — see that
 * file for why), and calls the approve/reject route
 * (`src/app/api/camera-sources/[id]/review/route.ts`) on click.
 *
 * Client-side only handles the interaction/optimistic-update layer; it never
 * talks to Supabase directly (the anon-key browser client couldn't see most
 * of this data anyway — RLS limits regular reads to `approved` rows or your
 * own submissions, see `supabase/migrations/0003_camera_sources.sql`).
 */

import { useState } from "react";
import { CameraSourceStatusBadge } from "@/components/camera-source-status-badge";
import type { CameraSource, CameraSourceDecision } from "@/lib/camera-sources/types";

interface ModerationQueueClientProps {
  initialPending: CameraSource[];
  initialDecided: CameraSource[];
}

interface RowState {
  isSubmitting: boolean;
  error: string | null;
}

export function ModerationQueueClient({ initialPending, initialDecided }: ModerationQueueClientProps) {
  const [pending, setPending] = useState<CameraSource[]>(initialPending);
  const [decided, setDecided] = useState<CameraSource[]>(initialDecided);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  async function review(id: string, decision: CameraSourceDecision) {
    setRowStates((prev) => ({ ...prev, [id]: { isSubmitting: true, error: null } }));

    try {
      const response = await fetch(`/api/camera-sources/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { cameraSource: CameraSource }
        | { error: string }
        | null;

      if (!response.ok || !payload || !("cameraSource" in payload)) {
        const message =
          payload && "error" in payload && payload.error
            ? payload.error
            : `Request failed (${response.status}).`;
        setRowStates((prev) => ({ ...prev, [id]: { isSubmitting: false, error: message } }));
        return;
      }

      const updated = payload.cameraSource;
      setPending((prev) => prev.filter((row) => row.id !== id));
      setDecided((prev) => [updated, ...prev]);
      setRowStates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (error) {
      // Network failure calling our own API route — an expected, handleable
      // path (CLAUDE.md: every I/O boundary must fail explicitly), not an
      // uncaught rejection left to surface as a blank/broken button.
      setRowStates((prev) => ({
        ...prev,
        [id]: {
          isSubmitting: false,
          error: error instanceof Error ? error.message : "Network error contacting the review endpoint.",
        },
      }));
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          Pending review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">No candidates waiting on review.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((row) => {
              const state = rowStates[row.id];
              return (
                <li
                  key={row.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-black dark:text-zinc-50">{row.name}</span>
                        <CameraSourceStatusBadge status={row.status} />
                      </div>
                      <p className="mt-1 break-all text-xs text-zinc-500 dark:text-zinc-400">{row.source_url}</p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        Site: {row.site_id ?? "— (unassigned)"} · Submitted{" "}
                        {new Date(row.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={state?.isSubmitting}
                        onClick={() => review(row.id, "approved")}
                        className="rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={state?.isSubmitting}
                        onClick={() => review(row.id, "rejected")}
                        className="rounded-full border border-rose-400 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/60 dark:text-rose-300 dark:hover:bg-rose-500/10"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                  {state?.error && (
                    <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">{state.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Recently decided</h2>
        {decided.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">No decisions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {decided.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">{row.name}</span>{" "}
                  <span className="break-all text-zinc-500 dark:text-zinc-500">{row.source_url}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-zinc-500 dark:text-zinc-400">
                  <CameraSourceStatusBadge status={row.status} />
                  <span>{row.reviewed_at ? new Date(row.reviewed_at).toLocaleString() : "—"}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
