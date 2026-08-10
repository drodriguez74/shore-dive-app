"use client";

/**
 * Safe-Return timer state hook.
 *
 * Persists to localStorage (a single small scalar record — plain
 * localStorage is sufficient here per CLAUDE.md/plan.md; IndexedDB is
 * reserved for the structured offline-cache data in Task 12, not this) so
 * the countdown survives a reload or the tab being backgrounded and
 * reopened. Note what this hook does *not* claim: while the tab/PWA is
 * actually backgrounded, this in-JS timer isn't running at all — the
 * "survives a reload" guarantee is about state, not about the alarm firing
 * on schedule while unattended. See the onboarding disclaimer copy in
 * `src/components/safe-return/disclaimer-notice.tsx` for what's honestly
 * promised to the user.
 *
 * The persisted snapshot is modeled as a useSyncExternalStore-compatible
 * store (module-scope cache + subscriber list), not an effect-based
 * "hydrate on mount" flag: calling setState synchronously inside a bare
 * mount effect trips react-hooks/set-state-in-effect, and for good reason —
 * useSyncExternalStore is the primitive React designed for exactly this
 * case (an external, mutable-outside-React source that must read
 * differently on the server, which has no localStorage, vs. the client),
 * and it reconciles that difference itself without a manual flag+effect.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AlertChannel } from "@/lib/safe-return/alert-channel";
import { logger } from "@/lib/safe-return/logger";

export type SafeReturnStatus = "idle" | "running" | "checked-in" | "expired";

interface SafeReturnTimerSnapshot {
  status: SafeReturnStatus;
  durationMs: number;
  startedAt: number | null;
  label: string;
}

const STORAGE_KEY = "shore-dive:safe-return-timer:v1";

const DEFAULT_SNAPSHOT: SafeReturnTimerSnapshot = {
  status: "idle",
  durationMs: 60 * 60 * 1000,
  startedAt: null,
  label: "",
};

function isSafeReturnStatus(value: unknown): value is SafeReturnStatus {
  return value === "idle" || value === "running" || value === "checked-in" || value === "expired";
}

/**
 * Transient, deliberately *not* part of the persisted snapshot: set when
 * `readPersisted()` finds a `status: "running"` record it cannot restore a
 * real countdown from. See `readPersisted()` and `recoveredFromCorruptState`
 * on the hook result for why this is surfaced rather than swallowed.
 */
let corruptRunningStateRecovered = false;

/**
 * Which unrecoverable-running-state case this is, or `null` if the record is
 * restorable. A "running" timer is only meaningful if we can compute elapsed
 * and remaining time from it, which needs both a real start instant and a
 * real positive duration — without either, there is no countdown to resume,
 * only a record that a timer once existed.
 */
function unrestorableRunningReason(durationMs: number, startedAt: number | null): string | null {
  if (startedAt === null) return "missing-started-at";
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "invalid-duration";
  return null;
}

function readPersisted(): SafeReturnTimerSnapshot {
  if (typeof window === "undefined") return DEFAULT_SNAPSHOT;
  corruptRunningStateRecovered = false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SNAPSHOT;
    const parsed = JSON.parse(raw) as Partial<SafeReturnTimerSnapshot>;
    if (typeof parsed.durationMs !== "number" || !isSafeReturnStatus(parsed.status)) {
      return DEFAULT_SNAPSHOT;
    }
    const durationMs = parsed.durationMs;
    const startedAt =
      typeof parsed.startedAt === "number" && Number.isFinite(parsed.startedAt) ? parsed.startedAt : null;

    // A `running` record that can't produce a countdown is corrupt, not
    // expired. Letting it through used to reach `remainingMs` (which
    // short-circuits to 0) and then the expiry effect, which read that as
    // "the countdown is over" and fired the alarm on load — asserting
    // something specific and false ("your timer expired") when the truth is
    // "we lost your timer state". False alarms are how a diver learns to
    // distrust the one alarm that actually matters, so this fails to a
    // known-good idle state instead — and says so in the UI (see
    // `recoveredFromCorruptState`), because a silent reset would trade a
    // false alarm for a false sense of safety, which is worse.
    if (parsed.status === "running") {
      const reason = unrestorableRunningReason(durationMs, startedAt);
      if (reason !== null) {
        corruptRunningStateRecovered = true;
        logger.warn("safe-return.corrupt-running-state-recovered", {
          reason,
          persistedStartedAt: String(parsed.startedAt),
          persistedDurationMs: String(parsed.durationMs),
        });
        return DEFAULT_SNAPSHOT;
      }
    }

    return {
      status: parsed.status,
      durationMs,
      startedAt,
      label: typeof parsed.label === "string" ? parsed.label : "",
    };
  } catch (err) {
    logger.warn("safe-return.storage-read-failed", { error: String(err) });
    return DEFAULT_SNAPSHOT;
  }
}

// --- External store: the persisted timer snapshot -------------------------

let cachedSnapshot: SafeReturnTimerSnapshot | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): SafeReturnTimerSnapshot {
  if (cachedSnapshot === null) {
    cachedSnapshot = readPersisted();
  }
  return cachedSnapshot;
}

function getServerSnapshot(): SafeReturnTimerSnapshot {
  return DEFAULT_SNAPSHOT;
}

/**
 * Companion store for the transient recovery flag. It shares `listeners`
 * (one notify path, one subscription model) but is read separately so the
 * flag never rides along into `commit()` and therefore never gets persisted
 * — a notice about lost state must not itself become saved state.
 */
function getRecoverySnapshot(): boolean {
  // Force the persisted read to have happened first: the flag is a byproduct
  // of `readPersisted()`, so reading it before the snapshot exists would
  // report `false` on the very load that detected the corruption.
  getSnapshot();
  return corruptRunningStateRecovered;
}

function getRecoveryServerSnapshot(): boolean {
  return false;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/**
 * The only path that mutates timer state: updates the module cache,
 * persists to localStorage, and notifies subscribers so every component
 * reading the store via useSyncExternalStore re-renders.
 */
function commit(next: SafeReturnTimerSnapshot): void {
  cachedSnapshot = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      // Expected, not exceptional, in private browsing / storage-full cases —
      // the timer still works in-memory for this session, it just won't
      // survive a reload. Logged so it's visible if it happens a lot.
      logger.warn("safe-return.storage-write-failed", { error: String(err) });
    }
  }
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  // Cross-tab sync: if another tab starts/checks-in/resets the timer, pick
  // it up here rather than showing a stale status in this tab.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cachedSnapshot = readPersisted();
    for (const listener of listeners) listener();
  });
}

/**
 * True only once mounted on the client. The standard useSyncExternalStore
 * idiom for "am I past hydration" — no effect, no setState, so it can't
 * trip react-hooks/set-state-in-effect, and React reconciles the
 * server-false/client-true difference itself.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export interface UseSafeReturnTimerOptions {
  alertChannel: AlertChannel;
}

export interface UseSafeReturnTimerResult {
  status: SafeReturnStatus;
  durationMs: number;
  startedAt: number | null;
  label: string;
  /** Milliseconds remaining. Only meaningful while `status === "running"`; 0 otherwise. */
  remainingMs: number;
  /** False until the persisted snapshot is known to reflect the real client-side value. */
  isHydrated: boolean;
  /**
   * True when a saved `running` timer was found but couldn't be restored
   * (no usable start time or duration), so the timer was reset to idle and
   * **no alarm was fired**. Surfaced so the UI can say that plainly — a
   * diver who really had a timer going must not be left assuming they're
   * still covered. Cleared by `dismissRecoveryNotice()`, and never persisted.
   */
  recoveredFromCorruptState: boolean;
  /** Dismisses the recovery notice for this session. */
  dismissRecoveryNotice: () => void;
  start: (durationMs: number, label?: string) => void;
  /** Deliberate confirmation that the diver is safe. Stops any in-progress alert. */
  checkIn: () => void;
  /** Stops the in-progress alert sound/vibration without marking the diver as checked in. */
  silenceAlarm: () => void;
  /** Returns to idle so a new timer can be started. */
  reset: () => void;
}

export function useSafeReturnTimer({ alertChannel }: UseSafeReturnTimerOptions): UseSafeReturnTimerResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const recoveredFromCorruptState = useSyncExternalStore(
    subscribe,
    getRecoverySnapshot,
    getRecoveryServerSnapshot,
  );
  const isHydrated = useIsClient();
  const [now, setNow] = useState<number>(() => Date.now());
  const firedRef = useRef(false);
  const repairedRef = useRef(false);

  // Write the reset back to storage so the unrestorable record can't be
  // re-read (and re-noticed) on the next load. Only runs on the rare
  // recovery path; `commit()` is an external-store write, not a React
  // setState, so this doesn't trip react-hooks/set-state-in-effect. The
  // committed value is `DEFAULT_SNAPSHOT` itself — the same object
  // `readPersisted()` already returned — so subscribers see an unchanged
  // reference and nothing re-renders in a loop.
  useEffect(() => {
    if (!recoveredFromCorruptState) {
      repairedRef.current = false;
      return;
    }
    if (repairedRef.current) return;
    repairedRef.current = true;
    commit(DEFAULT_SNAPSHOT);
  }, [recoveredFromCorruptState]);

  // Tick once a second while running so `remainingMs` stays live. Legitimate
  // effect use (subscribing to an interval, cleaning it up) — the setState
  // happens inside the interval callback, not synchronously in the effect
  // body, so it doesn't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    if (snapshot.status !== "running") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [snapshot.status]);

  const remainingMs = useMemo(() => {
    if (snapshot.status !== "running" || snapshot.startedAt === null) return 0;
    return Math.max(snapshot.durationMs - (now - snapshot.startedAt), 0);
  }, [snapshot, now]);

  // Expiry: covers a live countdown reaching zero, and also reopening the
  // app after expiry already passed while backgrounded/closed — the state
  // is still "running" in that case (nothing ran to flip it), so as soon as
  // we're back in the foreground and can compute a negative remainder, we
  // fire immediately. This is the honest "best effort once foregrounded"
  // behavior disclosed to the user, not a guarantee it fired on schedule.
  // `commit()` here isn't a React setState call (it's an external-store
  // write + subscriber notify), so — unlike the old setSnapshot(...) call —
  // this doesn't trip react-hooks/set-state-in-effect either.
  useEffect(() => {
    if (snapshot.status !== "running") {
      firedRef.current = false;
      return;
    }
    if (remainingMs > 0) return;
    if (firedRef.current) return;
    firedRef.current = true;

    commit({ ...snapshot, status: "expired" });

    alertChannel
      .fire({
        title: "Safe-Return timer expired",
        body: snapshot.label
          ? `You didn't check in for "${snapshot.label}". If you're safe, open the app and check in.`
          : "You didn't check in. If you're safe, open the app and check in.",
        timestamp: Date.now(),
      })
      .catch((err) => {
        logger.error("safe-return.alert-fire-failed", { error: String(err) });
      });
  }, [snapshot, remainingMs, alertChannel]);

  const start = useCallback(
    (durationMs: number, label = "") => {
      firedRef.current = false;
      // Acting on the notice ends it: once there's a real timer again, "a
      // previous timer couldn't be restored" is stale information. The
      // `commit()` below notifies subscribers, so no separate notify here.
      corruptRunningStateRecovered = false;
      alertChannel.stop();
      const startedAt = Date.now();
      commit({ status: "running", durationMs, startedAt, label });
      setNow(startedAt);
    },
    [alertChannel],
  );

  const checkIn = useCallback(() => {
    alertChannel.stop();
    commit({ ...getSnapshot(), status: "checked-in" });
  }, [alertChannel]);

  const silenceAlarm = useCallback(() => {
    alertChannel.stop();
  }, [alertChannel]);

  const reset = useCallback(() => {
    alertChannel.stop();
    firedRef.current = false;
    corruptRunningStateRecovered = false;
    commit(DEFAULT_SNAPSHOT);
  }, [alertChannel]);

  const dismissRecoveryNotice = useCallback(() => {
    if (!corruptRunningStateRecovered) return;
    corruptRunningStateRecovered = false;
    for (const listener of listeners) listener();
  }, []);

  return {
    status: snapshot.status,
    durationMs: snapshot.durationMs,
    startedAt: snapshot.startedAt,
    label: snapshot.label,
    remainingMs,
    isHydrated,
    recoveredFromCorruptState,
    dismissRecoveryNotice,
    start,
    checkIn,
    silenceAlarm,
    reset,
  };
}
