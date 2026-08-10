"use client";

/**
 * Shown once, on the start screen, when the hook found a saved `running`
 * timer it couldn't restore (see `use-safe-return-timer.ts`'s
 * `recoveredFromCorruptState`).
 *
 * Deliberately calm and deliberately *not* silent. The alternative behaviors
 * were both worse: firing the alarm asserts something specific and false
 * ("your timer expired") when the truth is only "we lost your timer state",
 * and a false alarm is how a diver learns to distrust the one alarm that
 * matters; resetting silently would leave a diver who really did have a
 * timer running assuming they're still covered when they aren't. So: no
 * alarm, no pretending nothing happened.
 *
 * Visual language is deliberately separate from `DisclaimerNotice`'s amber —
 * amber is the standing safety disclosure and shouldn't be diluted by an
 * informational one-off — and never red: nothing here is an emergency, and
 * nothing here is the diver's fault.
 */

interface RecoveryNoticeProps {
  onDismiss: () => void;
}

export function RecoveryNotice({ onDismiss }: RecoveryNoticeProps) {
  return (
    <div
      role="status"
      aria-label="Previous timer could not be restored"
      className="rounded-2xl border border-sky-500/40 border-l-4 border-l-sky-500 bg-sky-500/10 p-4 text-sky-900 dark:border-sky-400/40 dark:border-l-sky-400 dark:bg-sky-400/10 dark:text-sky-100"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold">A previous timer couldn&apos;t be restored</p>
        <button
          type="button"
          onClick={onDismiss}
          className="-my-1 -mr-1 shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-sky-800/80 underline-offset-4 hover:underline dark:text-sky-200/80"
        >
          Dismiss
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed">
        We found a saved timer from an earlier session, but part of it was missing, so
        there was no countdown left to pick up. No alarm was triggered, and no timer is
        running now. If you&apos;re still diving, start a new one below.
      </p>
    </div>
  );
}
