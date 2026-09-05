"use client";

/**
 * Expired view: the alarm channel is already firing by the time this
 * renders (the hook calls `alertChannel.fire()` on the transition into this
 * state). Two distinct actions are offered on purpose:
 * - "Silence alarm" — stop the noise/vibration without claiming anything
 *   about the diver's safety (e.g. someone else grabbed the phone to quiet it).
 * - The hold-to-confirm "I'm safe" action — the actual T15.5 confirmation
 *   that resolves the timer to checked-in.
 * Conflating the two would let a passive/accidental silence read as "the
 * diver confirmed they're fine," which is exactly the kind of implied
 * guarantee CLAUDE.md's engineering standards warn against.
 *
 * This is also the one Safe-Return surface that carries the DAN emergency
 * hotline as an action rather than as advance reading (`plan.md`, "Safety
 * first" v5 addendum). An expired, unanswered timer is the closest this app
 * ever gets to knowing something may have gone wrong, and whoever is holding
 * the phone at that moment — an overdue diver, or someone on the beach who
 * picked it up — is the person who needs a real number, not a reminder that
 * they should have written one down earlier. Placed below the alarm controls
 * so it never displaces "Silence alarm"/"I'm safe" for a diver who is simply
 * back late, which is the far more common reason this screen is seen.
 */

import type { AlertChannel } from "@/lib/safe-return/alert-channel";
import type { UseSafeReturnTimerResult } from "@/hooks/use-safe-return-timer";
import { DanEmergencyReference } from "./dan-emergency-reference";
import { HoldToConfirmButton } from "./hold-to-confirm-button";
import { StatusPanel } from "./status-panel";

interface ExpiredViewProps {
  timer: UseSafeReturnTimerResult;
  alertChannel: AlertChannel;
}

export function ExpiredView({ timer, alertChannel }: ExpiredViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-rose-500/50 bg-rose-500/10 p-6 text-center dark:border-rose-400/40 dark:bg-rose-400/10">
        <p className="text-lg font-semibold text-rose-800 dark:text-rose-200">
          Timer expired{timer.label ? ` — ${timer.label}` : ""}
        </p>
        <p className="mt-1 text-sm text-rose-800/80 dark:text-rose-200/80">
          You didn&apos;t check in. This device is alerting now — check what actually
          fired below.
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
          What actually fired on this device:
        </p>
        <StatusPanel alertChannel={alertChannel} />
      </div>

      <button
        type="button"
        onClick={timer.silenceAlarm}
        className="w-full min-h-[56px] rounded-2xl border border-zinc-300 px-6 py-3 text-sm font-medium text-zinc-800 dark:border-depth-border dark:text-zinc-200"
      >
        Silence alarm
      </button>

      <HoldToConfirmButton
        label="Hold to check in — I'm safe"
        armedLabel="Press again to confirm you're safe"
        onConfirm={timer.checkIn}
        variant="danger"
      />

      <DanEmergencyReference className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-4 text-rose-900 dark:border-rose-400/30 dark:bg-rose-400/5 dark:text-rose-200" />
    </div>
  );
}
