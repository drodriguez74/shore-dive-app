"use client";

import { useEffect, useMemo } from "react";
import { LocalAlarmChannel } from "@/lib/safe-return/alert-channel";
import { useSafeReturnTimer, type UseSafeReturnTimerResult } from "@/hooks/use-safe-return-timer";
import { usePostDivePromptTrigger } from "@/hooks/use-post-dive-prompt-trigger";
import { StartScreen } from "./start-screen";
import { RunningTimerView } from "./running-timer-view";
import { ExpiredView } from "./expired-view";
import { CheckedInView } from "./checked-in-view";

declare global {
  interface Window {
    __safeReturnTimerDebug?: UseSafeReturnTimerResult;
  }
}

/**
 * Top-level Safe-Return timer feature. Owns the one alert channel instance
 * for this session (`LocalAlarmChannel` — v1's only implementation, see
 * `src/lib/safe-return/alert-channel.ts`) and the timer hook, and switches
 * between the start/running/expired/checked-in views by status.
 */
export function SafeReturnTimer() {
  // One LocalAlarmChannel per mount — it owns AudioContext/oscillator state
  // that shouldn't be recreated on every render.
  const alertChannel = useMemo(() => new LocalAlarmChannel(), []);
  const timer = useSafeReturnTimer({ alertChannel });

  // Wires the already-real `running -> checked-in` edge (→ TASKS.md T14,
  // plan.md v5 Priority Triage #4) into the actual Safe-Return flow, not
  // just the /post-dive simulator. `usePostDivePromptTrigger` tracks the
  // previous value of `timer.status` internally (see its own prevSignalsRef)
  // across renders of this always-mounted top-level component, so simply
  // feeding it the live status here is sufficient to detect the edge — no
  // separate previous-status tracking needed at this call site. No
  // `checkInState` is passed: that's the other agent's in-progress
  // dive-plan edge, left untouched per instructions. Deliberately does not
  // fire on `expired` (see the hook's own doc comment) and is silenced
  // automatically when the user disables auto-prompting (T14.3).
  const postDivePrompt = usePostDivePromptTrigger({ safeReturnStatus: timer.status });

  // Dev-only: lets a driver like agent-browser call
  // `window.__safeReturnTimerDebug.start(10_000, "test")` from the console to
  // fire short-duration test runs without going through the minute-granularity
  // UI. `NODE_ENV === "production"` is statically replaced at build time, so
  // this branch (and the debug hook) is dead-code-eliminated from prod bundles.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__safeReturnTimerDebug = timer;
    return () => {
      delete window.__safeReturnTimerDebug;
    };
  }, [timer]);

  if (!timer.isHydrated) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        Loading timer…
      </div>
    );
  }

  switch (timer.status) {
    case "running":
      return <RunningTimerView timer={timer} alertChannel={alertChannel} />;
    case "expired":
      return <ExpiredView timer={timer} alertChannel={alertChannel} />;
    case "checked-in":
      return <CheckedInView timer={timer} postDivePrompt={postDivePrompt} />;
    case "idle":
    default:
      return <StartScreen timer={timer} alertChannel={alertChannel} />;
  }
}
