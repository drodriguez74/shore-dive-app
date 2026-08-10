"use client";

/** Running-timer view: T15.5's deliberate-confirmation check-in lives here. */

import type { AlertChannel } from "@/lib/safe-return/alert-channel";
import type { UseSafeReturnTimerResult } from "@/hooks/use-safe-return-timer";
import { formatDuration } from "@/lib/safe-return/format";
import { DisclaimerNotice } from "./disclaimer-notice";
import { HoldToConfirmButton } from "./hold-to-confirm-button";
import { StatusPanel } from "./status-panel";

interface RunningTimerViewProps {
  timer: UseSafeReturnTimerResult;
  alertChannel: AlertChannel;
}

export function RunningTimerView({ timer, alertChannel }: RunningTimerViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-200 bg-white py-10 dark:border-depth-border dark:bg-depth-1">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {timer.label ? timer.label : "Safe-Return timer running"}
        </p>
        <p className="font-display text-6xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
          {formatDuration(timer.remainingMs)}
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">time remaining</p>
      </div>

      <DisclaimerNotice variant="compact" />

      <HoldToConfirmButton
        label="Hold to check in — I'm safe"
        armedLabel="Press again to confirm you're safe"
        onConfirm={timer.checkIn}
        variant="safe"
      />

      <div>
        <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          What happens if this expires:
        </p>
        <StatusPanel alertChannel={alertChannel} />
      </div>
    </div>
  );
}
