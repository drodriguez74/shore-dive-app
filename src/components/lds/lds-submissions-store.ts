/**
 * Local persistence for community LDS status submissions (T16.3).
 *
 * No live Supabase project yet, so there's no real write path to insert
 * into `lds_status`. This stores submissions in `localStorage` instead —
 * same pattern already used in this codebase for client-only persistence
 * (see `src/hooks/use-safe-return-timer.ts`) — so the interaction shape
 * (submit -> validate -> persist -> visible) is real even though the
 * backend isn't.
 *
 * TODO(Task 16 backend): once `lds_status` exists in a real Supabase
 * project and RLS (`supabase/migrations/0002_rls.sql`) is applied, replace
 * `saveLdsSubmission` with a real `insert` through the Supabase client.
 * Per `supabase/README.md`'s "RLS: self-service writes are capped at
 * COMMUNITY" — every insert/update policy's `with check` clause forces
 * `provenance = 'COMMUNITY'`, so a self-submitted row can never claim
 * `VERIFIED` even if a client tried to send that value. This module mirrors
 * that constraint client-side (`provenance` is not a caller-supplied field
 * on `LdsSubmissionInput`) so the UI can't even offer the option, but the
 * real enforcement point is the database RLS policy, not this code — don't
 * treat this client-side cap as the security boundary once a backend
 * exists.
 *
 * Modeled as an append — each submission is pushed onto the stored array,
 * never overwriting a prior one — consistent with `lds_status` being an
 * append-only verification log (see `lds-status.ts`'s header comment and
 * `supabase/README.md`).
 */

import type { LdsProvenance, LdsStatusValue } from "./lds-status";

const STORAGE_KEY = "shore-dive:lds-submissions:v1";

/** Fields a caller (the submission form) actually provides. Deliberately
 * excludes `provenance` — see module doc above — and `id`/`created_at`/
 * `last_verified_at`, which this module stamps itself so a caller can't
 * backdate or forge a submission's timestamp. */
export interface LdsSubmissionInput {
  site_id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  status: LdsStatusValue;
  /** Free-text context from the submitter. Not a column on `lds_status`
   * itself (the migration only has `status`) — stored alongside for local
   * display only; drop or move to a real notes column if one gets added
   * server-side. */
  note?: string;
  /** Null until real auth is wired into this flow — v1 has Google sign-in
   * (P0-A) but this form isn't gated behind it yet. */
  created_by: string | null;
}

export interface LdsSubmissionRecord extends LdsSubmissionInput {
  id: string;
  provenance: LdsProvenance;
  last_verified_at: string;
  created_at: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function loadLdsSubmissions(): LdsSubmissionRecord[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LdsSubmissionRecord[]) : [];
  } catch (error) {
    console.error("[lds-submissions-store] failed to read submissions from localStorage", {
      error: error instanceof Error ? error.message : error,
    });
    return [];
  }
}

/**
 * Appends one submission, always tagged `COMMUNITY` (see module doc — a
 * self-submitter can never mint `VERIFIED`). Returns the persisted record,
 * or `null` if the write failed (e.g. private-browsing storage denial) —
 * callers should surface that to the user rather than silently pretending
 * it succeeded.
 */
export function saveLdsSubmission(input: LdsSubmissionInput): LdsSubmissionRecord | null {
  const nowIso = new Date().toISOString();
  const record: LdsSubmissionRecord = {
    ...input,
    id: `lds-submission-${nowIso}-${Math.random().toString(36).slice(2, 8)}`,
    provenance: "COMMUNITY",
    last_verified_at: nowIso,
    created_at: nowIso,
  };

  if (!isBrowser()) return record;

  try {
    const existing = loadLdsSubmissions();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, record]));
    return record;
  } catch (error) {
    console.error("[lds-submissions-store] failed to persist submission to localStorage", {
      shopName: input.name,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
