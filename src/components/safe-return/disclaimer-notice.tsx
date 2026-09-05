/**
 * Onboarding/disclaimer copy for the Safe-Return timer.
 *
 * The core sentence is verbatim from plan.md's "Resolved Spec Decisions" §1:
 * a UI must never imply a guarantee this feature can't back (CLAUDE.md,
 * Engineering standards). Do not soften or summarize this text — if it
 * changes, change it in plan.md first (per CLAUDE.md's drift policy) and
 * mirror it here, not the other way around.
 *
 * Two additions from plan.md's "Safety first" pillar, v5 addendum:
 *
 * 1. **The buddy limit.** The timer is *silently* solo-only — nothing in the
 *    state machine or schema distinguishes "I checked in" from "we both
 *    surfaced," and a buddy who isn't carrying a phone can't be represented
 *    at all. v1 stays one-device-per-countdown by decision (no rebuild), so
 *    the honesty has to live in the copy instead: a diver must not read a
 *    green "checked in" as covering two people. Both variants carry this,
 *    for the same reason both already carry the no-one-else-is-notified
 *    limit — a diver who starts a timer in one session and reads the compact
 *    reminder in another must not get a materially different disclosure.
 * 2. **The DAN reference** (`DanEmergencyReference`) — the real resource for
 *    a real dive emergency, since this app is not one. Full variant only;
 *    see that file's header for why the number is single-sourced, and the
 *    note on the compact variant below for why it isn't repeated there.
 */

import { DanEmergencyReference } from "./dan-emergency-reference";

interface DisclaimerNoticeProps {
  /**
   * "full" — the onboarding gate shown before starting a timer (default).
   * "compact" — a persistent reminder strip shown during running/expired
   * states, where a diver may not have seen the full gate in this session.
   */
  variant?: "full" | "compact";
  className?: string;
}

export function DisclaimerNotice({ variant = "full", className = "" }: DisclaimerNoticeProps) {
  if (variant === "compact") {
    // No DAN block here by design. This strip sits directly above the
    // hold-to-check-in button on a running timer, where the one action that
    // matters is checking in; a phone number competing for that tap would be
    // in the way, and the surface where a diver actually needs the number —
    // an expired, unanswered timer — renders it in full (`ExpiredView`).
    return (
      <p
        role="note"
        className={`text-xs leading-relaxed text-amber-800 dark:text-amber-300 ${className}`}
      >
        Reminder: this alerts only this device — nobody else is notified — and it&apos;s
        less reliable in the background, especially on iPhone. Checking in confirms
        only you, not your buddy.
      </p>
    );
  }

  return (
    <div
      role="note"
      aria-label="Safe-Return timer disclaimer"
      className={`rounded-2xl border border-amber-500/40 border-l-4 border-l-amber-500 bg-amber-500/10 p-4 text-amber-900 dark:border-amber-400/40 dark:border-l-amber-400 dark:bg-amber-400/10 dark:text-amber-200 ${className}`}
    >
      <p className="text-sm font-semibold">Before you start this timer</p>
      <p className="mt-2 text-sm leading-relaxed">
        This timer alerts you, in this app, if you miss your check-in. It does not
        notify anyone else, and it&apos;s less reliable if you close the app or lock
        your phone — especially on iPhone. Tell a real person your dive plan before
        you go.
      </p>
      <ul className="mt-3 space-y-1 text-xs leading-relaxed text-amber-800/90 dark:text-amber-300/90">
        <li>
          This timer tracks one diver on one device. Checking in confirms that
          <em> you</em> surfaced — it does not confirm your buddy did, and there is no
          way to include a buddy who isn&apos;t carrying their own phone.
        </li>
        <li>
          No emergency contacts, push notifications, or SMS in this version — only a
          sound, a vibration, and a notification on this device.
        </li>
        <li>
          On iPhone, the on-expiry notification only works if you&apos;ve added this
          app to your Home Screen and you&apos;re on iOS 16.4 or later.
        </li>
        <li>Reliability is best while this app stays open and the screen is on.</li>
      </ul>

      <DanEmergencyReference className="mt-3 border-t border-amber-500/30 pt-3 text-amber-800/90 dark:border-amber-400/25 dark:text-amber-300/90" />
    </div>
  );
}
