/**
 * Onboarding/disclaimer copy for the Safe-Return timer.
 *
 * The core sentence is verbatim from plan.md's "Resolved Spec Decisions" §1:
 * a UI must never imply a guarantee this feature can't back (CLAUDE.md,
 * Engineering standards). Do not soften or summarize this text — if it
 * changes, change it in plan.md first (per CLAUDE.md's drift policy) and
 * mirror it here, not the other way around.
 */

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
    return (
      <p
        role="note"
        className={`text-xs leading-relaxed text-amber-800 dark:text-amber-300 ${className}`}
      >
        Reminder: this alerts only this device — nobody else is notified — and it&apos;s
        less reliable in the background, especially on iPhone.
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
          No emergency contacts, push notifications, or SMS in this version — only a
          sound, a vibration, and a notification on this device.
        </li>
        <li>
          On iPhone, the on-expiry notification only works if you&apos;ve added this
          app to your Home Screen and you&apos;re on iOS 16.4 or later.
        </li>
        <li>Reliability is best while this app stays open and the screen is on.</li>
      </ul>
    </div>
  );
}
