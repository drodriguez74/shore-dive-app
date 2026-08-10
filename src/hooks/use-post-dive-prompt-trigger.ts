"use client";

/**
 * Trigger logic for the Post-Dive Micro-Prompt Engine (→ TASKS.md T14.1,
 * plan.md Task 14, THREAT_MODEL.md §6).
 *
 * ## The design problem this resolves
 *
 * THREAT_MODEL.md §6 flags the obvious naive implementation — "detect
 * post-dive from GPS/motion" — as a false-positive generator that directly
 * violates the zero-noise promise in Pillar 1: anyone walking near the
 * coast, driving past a dive site, or living near one would get spammed.
 * plan.md's resolution is explicit: gate on an "active dive-plan check-in
 * state," not bare proximity.
 *
 * There is no real dive-plan data model in this codebase yet (that's future
 * work, not this task). So this file defines a small, clean interface for
 * that future state (`DivePlanCheckInState`) and builds the trigger as a
 * pure function against it, so the real dive-plan feature can be wired in
 * later without touching this trigger logic — just by feeding it real state
 * instead of a stub.
 *
 * ## Why the Safe-Return timer's status is used as a second, *already real*
 * signal
 *
 * `DivePlanCheckInState` alone is untestable end-to-end today because
 * nothing produces it yet. `src/hooks/use-safe-return-timer.ts` already
 * exists, is real, and its `status` field genuinely means something close
 * to "the user is/was on a dive":
 *
 * - `idle` → no active dive.
 * - `running` → the user started a countdown before entering the water —
 *   this *is* a form of dive-plan check-in, just not modeled as one yet.
 * - `checked-in` → the user took a deliberate, non-passive confirmation
 *   action (see `HoldToConfirmButton`, T15.5) that they're back and safe.
 *   This is a strong, intentional signal, not an inference from sensors.
 * - `expired` → the countdown ran out with no check-in. This is an
 *   emergency/uncertain state, not a "the dive is over, ask about
 *   visibility" state — deliberately **excluded** as a trigger (see below).
 *
 * So: the transition `running -> checked-in` is treated as a second,
 * legitimate trigger source, on equal footing with a real dive-plan
 * check-in ending. Both require an explicit, user-driven state transition —
 * neither uses GPS, motion, or bare proximity. Nothing here treats "timer
 * reached zero" (`expired`) as a trigger; nagging someone about water
 * visibility while their Safe-Return alarm may be actively firing (or just
 * silenced after a scare) is exactly the kind of noisy, badly-timed prompt
 * this task exists to prevent. If the user later manually resets from
 * `expired`, that is *not* inferred as "dive just ended safely" either —
 * only an explicit check-in counts.
 *
 * ## What actually fires the prompt
 *
 * `evaluatePostDiveTrigger` is a pure function: given the previous and
 * current values of both signals (plus a `now` the caller supplies), it
 * returns whether to fire and which signal fired. It fires on the *edge* (a
 * transition), not on steady state — no ambient GPS polling, no background
 * loop, nothing to fire just because the user happens to be near a site.
 *
 * `usePostDivePromptTrigger` wraps that pure function as a hook consumers
 * can feed live values into. Edge detection (which needs `Date.now()`, an
 * impure call) happens inside a `useEffect`, not during render — this
 * repo's lint config enforces component/hook render purity
 * (`react-hooks/purity`, part of the React Compiler ruleset), which
 * specifically forbids calling `Date.now()` in the render body (the
 * "adjust state while rendering" pattern from React's docs works for pure
 * derivations, but not here since freshness-checking a transition requires
 * the current wall-clock time). The effect writes to a small per-hook-call
 * external store instead of calling a `useState` setter directly in the
 * effect body — the same technique `use-safe-return-timer.ts` uses (its
 * `commit()` call inside an effect) to avoid `react-hooks/set-state-in-effect`,
 * which only tracks `useState`/`useReducer` setters, not arbitrary
 * imperative writes notified via `useSyncExternalStore`.
 *
 * This hook also reads `usePostDivePromptSettings` (→ T14.3) and never
 * surfaces an auto-fire when the user has turned inference off — but a
 * `showManually()` escape hatch is exposed and always works, regardless of
 * the setting, per plan.md's "without losing the ability to manually log."
 */

import { useCallback, useRef, useState, useSyncExternalStore, useEffect } from "react";
import type { SafeReturnStatus } from "@/hooks/use-safe-return-timer";
import { usePostDivePromptSettings } from "@/hooks/use-post-dive-prompt-settings";

/**
 * Minimal, forward-compatible stand-in for a real dive-plan model (not yet
 * built — this is the interface a future dive-plan feature should conform
 * to, not a placeholder to throw away). `isActive` is true while the diver
 * is checked into a planned dive; `checkedInAt` is set when the plan's
 * *active* state most recently ended (i.e. when `isActive` flips to
 * `false`) — it is not the time the dive started.
 */
export interface DivePlanCheckInState {
  isActive: boolean;
  siteId: string | null;
  checkedInAt: number | null;
}

export type PostDivePromptTriggerSource = "dive-plan-check-in" | "safe-return-checked-in" | "manual";

export interface EvaluatePostDiveTriggerInput {
  previousCheckInState: DivePlanCheckInState | undefined;
  checkInState: DivePlanCheckInState | undefined;
  previousSafeReturnStatus: SafeReturnStatus | undefined;
  safeReturnStatus: SafeReturnStatus | undefined;
  /** Current time, injectable for testing. */
  now: number;
  /**
   * How recently `checkInState.checkedInAt` must have happened for a
   * dive-plan transition to still count as "just ended." Guards against a
   * stale/rehydrated state object (e.g. reopening the app days later) being
   * misread as a fresh transition. Default 15 minutes.
   */
  recentWindowMs?: number;
}

export interface PostDiveTriggerDecision {
  fire: boolean;
  source: PostDivePromptTriggerSource | null;
}

const DEFAULT_RECENT_WINDOW_MS = 15 * 60 * 1000;

function checkInStateEquals(
  a: DivePlanCheckInState | undefined,
  b: DivePlanCheckInState | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.isActive === b.isActive && a.siteId === b.siteId && a.checkedInAt === b.checkedInAt;
}

/**
 * Pure decision function — no React, no I/O, fully unit-testable. Fires at
 * most once per call for a single detected edge; callers are responsible
 * for not re-evaluating against the same (previous, current) pair twice.
 */
export function evaluatePostDiveTrigger(input: EvaluatePostDiveTriggerInput): PostDiveTriggerDecision {
  const recentWindowMs = input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS;

  // Primary signal: an active dive-plan check-in just ended. This is the
  // conservative, spec-mandated gate from plan.md/THREAT_MODEL.md §6 — not
  // bare GPS proximity.
  const prevPlan = input.previousCheckInState;
  const plan = input.checkInState;
  if (
    prevPlan?.isActive === true &&
    plan?.isActive === false &&
    plan.checkedInAt !== null &&
    input.now - plan.checkedInAt <= recentWindowMs &&
    input.now - plan.checkedInAt >= 0
  ) {
    return { fire: true, source: "dive-plan-check-in" };
  }

  // Secondary, already-real signal: the Safe-Return timer transitioning
  // from `running` to `checked-in` — a deliberate, explicit confirmation
  // the diver is back, not an inference from sensors. Deliberately does NOT
  // treat `expired` as a trigger (see file header).
  if (input.previousSafeReturnStatus === "running" && input.safeReturnStatus === "checked-in") {
    return { fire: true, source: "safe-return-checked-in" };
  }

  return { fire: false, source: null };
}

// --- Per-hook-call external store for the derived visible/source state ----
// (see file header for why this isn't a plain useState written inside the
// effect below).

interface TriggerVisibilityState {
  visible: boolean;
  source: PostDivePromptTriggerSource | null;
}

const HIDDEN_STATE: TriggerVisibilityState = { visible: false, source: null };

function createVisibilityStore() {
  let state: TriggerVisibilityState = HIDDEN_STATE;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => state,
    subscribe: (onStoreChange: () => void) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    show: (source: PostDivePromptTriggerSource | null) => {
      state = { visible: true, source };
      notify();
    },
    hide: () => {
      state = HIDDEN_STATE;
      notify();
    },
  };
}

export interface UsePostDivePromptTriggerOptions {
  /** Live Safe-Return timer status, if the consumer has one mounted. Optional — omit if not applicable. */
  safeReturnStatus?: SafeReturnStatus;
  /** Live dive-plan check-in state, once a real one exists. Optional — omit until that data model lands. */
  checkInState?: DivePlanCheckInState;
  recentWindowMs?: number;
}

export interface UsePostDivePromptTriggerResult {
  /** Whether the prompt should currently be visible (auto- or manually-triggered). */
  visible: boolean;
  /** What caused the current `visible === true` state, or null when hidden. */
  source: PostDivePromptTriggerSource | null;
  /** Dismiss without logging. Always available. */
  dismiss: () => void;
  /** Call after a successful log submission — same as dismiss, but a distinct call site reads clearer. */
  markLogged: () => void;
  /**
   * Manually open the prompt regardless of the auto-prompt setting. This is
   * the "without losing the ability to manually log" escape hatch T14.3
   * requires — it always works, even with inference-based prompting
   * disabled.
   */
  showManually: () => void;
  /** Mirrors the settings toggle, for UI that wants to explain why auto-fire is/isn't possible. */
  autoPromptEnabled: boolean;
}

export function usePostDivePromptTrigger(
  options: UsePostDivePromptTriggerOptions = {},
): UsePostDivePromptTriggerResult {
  const { safeReturnStatus, checkInState, recentWindowMs } = options;
  const { autoPromptEnabled } = usePostDivePromptSettings();

  // A single per-hook-call store holds both auto- and manually-triggered
  // visibility — one store, one source of truth, so there's no separate
  // "which one wins" merge logic. Created once via useState's lazy
  // initializer (not useRef): this repo's lint config enforces
  // `react-hooks/refs` (part of the React Compiler ruleset), which forbids
  // reading `ref.current` during render at all — including the common
  // "lazily initialize a ref on first render" idiom. `useState(() => ...)`
  // is the React-sanctioned way to create a stable instance once; unlike a
  // ref, state values are meant to be read during render.
  const [store] = useState(() => createVisibilityStore());

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => HIDDEN_STATE);

  // Previous-signal tracking lives in a ref (not state) — it's write-only
  // bookkeeping for edge detection, never read during render, so it doesn't
  // need to participate in React's render/commit cycle at all.
  const prevSignalsRef = useRef<{
    safeReturnStatus: SafeReturnStatus | undefined;
    checkInState: DivePlanCheckInState | undefined;
  }>({ safeReturnStatus, checkInState });

  useEffect(() => {
    const prev = prevSignalsRef.current;
    const changed =
      prev.safeReturnStatus !== safeReturnStatus || !checkInStateEquals(prev.checkInState, checkInState);
    if (!changed) return;

    const decision = evaluatePostDiveTrigger({
      previousSafeReturnStatus: prev.safeReturnStatus,
      safeReturnStatus,
      previousCheckInState: prev.checkInState,
      checkInState,
      now: Date.now(),
      recentWindowMs,
    });
    prevSignalsRef.current = { safeReturnStatus, checkInState };

    if (decision.fire && autoPromptEnabled) {
      store.show(decision.source);
    }
  }, [safeReturnStatus, checkInState, autoPromptEnabled, recentWindowMs, store]);

  const dismiss = useCallback(() => {
    store.hide();
  }, [store]);

  const markLogged = dismiss;

  // Always available regardless of autoPromptEnabled — the "without losing
  // the ability to manually log" requirement (T14.3).
  const showManually = useCallback(() => {
    store.show("manual");
  }, [store]);

  return { visible: state.visible, source: state.source, dismiss, markLogged, showManually, autoPromptEnabled };
}
