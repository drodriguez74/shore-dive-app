"use client";

/**
 * localStorage persistence for post-dive condition logs (→ TASKS.md T14.2).
 *
 * TODO(supabase): this is a stand-in, not the real store. Once a
 * `dive_logs`-style table exists (see P0-B's provenance model — a
 * self-reported condition log is COMMUNITY-provenance data, same tier as a
 * hazard report), submissions here should be written to Supabase instead,
 * scoped to the authenticated user (P0-C's PII/retention rules apply — a
 * log is tied to account identity + dive-plan location). Until then,
 * everything lives in this browser's localStorage only: it is not synced,
 * not backed up, and is lost if the user clears site data or switches
 * devices. That limitation is deliberately surfaced in the UI
 * (`post-dive-prompt.tsx`), not just left as a code comment.
 *
 * The read/write shape follows `src/hooks/use-safe-return-timer.ts`'s
 * pattern (JSON in a single localStorage key, defensive parse/validate,
 * wrapped in try/catch so a storage failure degrades gracefully instead of
 * throwing), adapted from a single scalar snapshot to an append-only array
 * capped at a max length so a long-lived install doesn't grow this key
 * unboundedly.
 *
 * `usePostDiveConditionLogs` exposes the list reactively via
 * `useSyncExternalStore`, for the same reason `use-safe-return-timer.ts` and
 * `use-post-dive-prompt-settings.ts` do: reading localStorage directly in a
 * component's render body would return `[]` during SSR (no `window`) but
 * real data on the client, producing a hydration mismatch on first paint.
 * `useSyncExternalStore` reconciles that difference; a `useState` +
 * mount-`useEffect` load would also trip `react-hooks/set-state-in-effect`.
 */

import { useSyncExternalStore } from "react";
import { logger } from "./logger";
import type { PostDiveConditionLog, PostDiveConditionLogDraft } from "./types";

const STORAGE_KEY = "shore-dive:post-dive-prompt:logs:v1";
const MAX_STORED_LOGS = 50;

function isValidLog(value: unknown): value is PostDiveConditionLog {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.loggedAt === "number" &&
    (typeof v.siteId === "string" || v.siteId === null) &&
    (v.visibility === null || typeof v.visibility === "string") &&
    (v.current === null || typeof v.current === "string") &&
    (typeof v.sawNotableMarineLife === "boolean" || v.sawNotableMarineLife === null) &&
    typeof v.source === "string"
  );
}

/** Reads all persisted logs, newest first. Never throws — returns [] on any failure. */
export function loadPostDiveConditionLogs(): PostDiveConditionLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidLog);
  } catch (err) {
    logger.warn("storage.read-failed", { error: String(err) });
    return [];
  }
}

/**
 * Appends a new log entry and persists it. Never throws — a failed write
 * (private browsing, storage full) is logged and swallowed so a condition
 * submission never crashes the prompt; the UI should treat the returned
 * entry as best-effort saved.
 */
export function savePostDiveConditionLog(draft: PostDiveConditionLogDraft): PostDiveConditionLog {
  const entry: PostDiveConditionLog = {
    ...draft,
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    loggedAt: Date.now(),
  };

  if (typeof window === "undefined") return entry;

  try {
    const existing = loadPostDiveConditionLogs();
    const next = [entry, ...existing].slice(0, MAX_STORED_LOGS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notifyLogsChanged(next);
  } catch (err) {
    logger.warn("storage.write-failed", { error: String(err) });
  }

  return entry;
}

// --- Reactive read access ---------------------------------------------

let cachedLogs: PostDiveConditionLog[] | null = null;
const listeners = new Set<() => void>();
// Stable reference (not a fresh [] per call) — useSyncExternalStore requires
// getServerSnapshot to return an Object.is-equal value across calls, or it
// warns/loops during hydration reconciliation.
const EMPTY_LOGS: PostDiveConditionLog[] = [];

function notifyLogsChanged(next: PostDiveConditionLog[]): void {
  cachedLogs = next;
  for (const listener of listeners) listener();
}

function getSnapshot(): PostDiveConditionLog[] {
  if (cachedLogs === null) {
    cachedLogs = loadPostDiveConditionLogs();
  }
  return cachedLogs;
}

function getServerSnapshot(): PostDiveConditionLog[] {
  return EMPTY_LOGS;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

if (typeof window !== "undefined") {
  // Cross-tab sync, matching the pattern in use-safe-return-timer.ts and
  // use-post-dive-prompt-settings.ts.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cachedLogs = loadPostDiveConditionLogs();
    for (const listener of listeners) listener();
  });
}

/** Reactive view of the persisted log list, newest first — re-renders the caller when a new log is saved. */
export function usePostDiveConditionLogs(): PostDiveConditionLog[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
