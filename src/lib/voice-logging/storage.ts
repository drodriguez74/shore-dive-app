"use client";

/**
 * localStorage persistence for voice/manual dive-log entries.
 *
 * ## Why localStorage and not Supabase
 *
 * There is no `dive_logs` table in `supabase/migrations/` — deliberately.
 * A schema is effectively permanent in a project with applied-migration
 * discipline, and this entry shape (per-field transcription lineage,
 * retained transcript, privacy mode) is exactly the kind of thing that
 * should settle against real usage before it's frozen into Postgres. So
 * this follows the precedent `post-dive-prompt/storage.ts` already set:
 * device-local for now, with the limitation stated to the user's face
 * rather than buried.
 *
 * TODO(supabase): when a real `dive_logs` table lands, a dive log is
 * COMMUNITY-provenance data under P0-B (self-reported, same tier as a
 * hazard report) and falls under P0-C's PII rules (it ties account
 * identity to dive location and time). Note that migrating *this* data
 * needs a decision the schema alone won't answer — see the retention note
 * below. Implementation notes stay here in code; the user-facing copy in
 * `dive-log-form.tsx` says only what is true today, with no TODO leaking
 * into it (a bug fixed in `post-dive-prompt.tsx` on 2026-08-14 — don't
 * reintroduce it).
 *
 * ## Retention note on the stored transcript
 *
 * `DiveLogEntry.transcript` is retained so a diver can audit a suspicious
 * number against what they actually said — THREAT_MODEL.md §3's mitigation
 * for misrecognised depths. That transcript can also contain a dive buddy's
 * name or a bystander's voice rendered as text, so under P0-C's
 * minimal-retention rule it is: device-local, never transmitted, never
 * logged (see `logger.ts`), and dropped with the entry when the cap below
 * rolls it off. Syncing it to a server later is a **separate consent
 * decision**, not an automatic consequence of building a `dive_logs` table.
 *
 * ## Read/write shape
 *
 * Mirrors `post-dive-prompt/storage.ts` exactly — a single JSON key,
 * defensive parse/validate, every access in try/catch so a storage failure
 * (private browsing, quota) degrades instead of throwing, an append-only
 * array capped so a long-lived install doesn't grow unboundedly, and
 * reactive reads via `useSyncExternalStore` rather than a mount effect
 * (which would both return `[]` on the server and real data on the client —
 * a hydration mismatch — and trip `react-hooks/set-state-in-effect`).
 */

import { useSyncExternalStore } from "react";
import { logger } from "./logger";
import type { DiveLogEntry, DiveLogSubmission } from "./types";

const STORAGE_KEY = "shore-dive:voice-logging:entries:v1";
const MAX_STORED_ENTRIES = 50;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Fill in fields added after the first entries were already on disk.
 *
 * Buddy, tank pressure, water temp, and exposure suit arrived with
 * `plan.md`'s v5 field-list correction, well after divers could already have
 * saved logs under this same storage key. Without this, the stricter
 * validation below would reject every pre-existing entry as malformed and
 * `loadDiveLogEntries()` — which filters silently by design — would erase a
 * diver's logbook on upgrade with no error and no way back.
 *
 * Migrating on read rather than bumping the key is what makes that
 * impossible: the defaults are spread *first* so any value actually present
 * (including a legitimate explicit `null`) wins over them.
 */
function withNewFieldDefaults(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  return {
    buddy: "",
    tankPressureStartPsi: null,
    tankPressureEndPsi: null,
    waterTempF: null,
    exposureSuit: null,
    ...(value as Record<string, unknown>),
  };
}

/**
 * Structural validation on read. Deliberately permissive about *values*
 * (any string passes for `visibility`) and strict about *shapes*: the goal
 * is that a hand-edited or version-skewed localStorage blob can't crash a
 * render by handing the form a `marineLife` that isn't an array, not to
 * re-derive the type system at runtime.
 */
function isValidEntry(value: unknown): value is DiveLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.loggedAt === "number" &&
    (typeof v.siteId === "string" || v.siteId === null) &&
    typeof v.site === "string" &&
    typeof v.buddy === "string" &&
    (typeof v.maxDepthFt === "number" || v.maxDepthFt === null) &&
    (typeof v.runtimeMinutes === "number" || v.runtimeMinutes === null) &&
    (typeof v.tankPressureStartPsi === "number" || v.tankPressureStartPsi === null) &&
    (typeof v.tankPressureEndPsi === "number" || v.tankPressureEndPsi === null) &&
    (typeof v.waterTempF === "number" || v.waterTempF === null) &&
    (typeof v.exposureSuit === "string" || v.exposureSuit === null) &&
    isStringArray(v.marineLife) &&
    (typeof v.visibility === "string" || v.visibility === null) &&
    (typeof v.current === "string" || v.current === null) &&
    typeof v.notes === "string" &&
    (v.entryMethod === "voice" || v.entryMethod === "manual") &&
    isStringArray(v.transcribedFields) &&
    isStringArray(v.editedFields) &&
    (typeof v.transcript === "string" || v.transcript === null) &&
    (typeof v.recordingMs === "number" || v.recordingMs === null) &&
    (typeof v.transcriptionPrivacyMode === "string" || v.transcriptionPrivacyMode === null)
  );
}

/** Reads all persisted entries, newest first. Never throws — returns [] on any failure. */
export function loadDiveLogEntries(): DiveLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(withNewFieldDefaults).filter(isValidEntry);
  } catch (err) {
    logger.warn("storage.read-failed", { error: String(err) });
    return [];
  }
}

function newEntryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Append a submission and persist it.
 *
 * Never throws: a failed write (private browsing, quota exhausted) is
 * logged and swallowed, and the caller still receives the fully-formed
 * entry so the UI can show what was captured rather than losing it to an
 * exception. The returned entry is therefore **best-effort saved** — the
 * confirmation screen's copy says "saved on this device", which stays true
 * for the overwhelmingly common case without promising durability the
 * browser doesn't guarantee.
 */
export function saveDiveLogEntry(submission: DiveLogSubmission): DiveLogEntry {
  const entry: DiveLogEntry = {
    ...submission.draft,
    id: newEntryId(),
    loggedAt: Date.now(),
    siteId: submission.siteId,
    entryMethod: submission.entryMethod,
    transcribedFields: submission.transcribedFields,
    editedFields: submission.editedFields,
    transcript: submission.transcript,
    recordingMs: submission.recordingMs,
    transcriptionPrivacyMode: submission.transcriptionPrivacyMode,
  };

  if (typeof window === "undefined") return entry;

  try {
    const existing = loadDiveLogEntries();
    const next = [entry, ...existing].slice(0, MAX_STORED_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notifyEntriesChanged(next);
    logger.info("storage.entry-saved", {
      entryMethod: entry.entryMethod,
      transcribedFieldCount: entry.transcribedFields.length,
      editedFieldCount: entry.editedFields.length,
      transcriptLength: entry.transcript?.length ?? 0,
      recordingMs: entry.recordingMs,
      transcriptionPrivacyMode: entry.transcriptionPrivacyMode,
    });
  } catch (err) {
    logger.warn("storage.write-failed", { error: String(err) });
  }

  return entry;
}

// --- Reactive read access -------------------------------------------------

let cachedEntries: DiveLogEntry[] | null = null;
const listeners = new Set<() => void>();
// Stable reference (not a fresh [] per call) — useSyncExternalStore requires
// getServerSnapshot to return an Object.is-equal value across calls, or it
// warns/loops during hydration reconciliation.
const EMPTY_ENTRIES: DiveLogEntry[] = [];

function notifyEntriesChanged(next: DiveLogEntry[]): void {
  cachedEntries = next;
  for (const listener of listeners) listener();
}

function getSnapshot(): DiveLogEntry[] {
  if (cachedEntries === null) {
    cachedEntries = loadDiveLogEntries();
  }
  return cachedEntries;
}

function getServerSnapshot(): DiveLogEntry[] {
  return EMPTY_ENTRIES;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

if (typeof window !== "undefined") {
  // Cross-tab sync, matching use-safe-return-timer.ts and
  // post-dive-prompt/storage.ts.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cachedEntries = loadDiveLogEntries();
    for (const listener of listeners) listener();
  });
}

/** Reactive view of persisted entries, newest first — re-renders the caller on save. */
export function useDiveLogEntries(): DiveLogEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
