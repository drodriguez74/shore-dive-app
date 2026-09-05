import Link from "next/link";
import { PwaInstallNudge } from "@/components/pwa-install-nudge";

/**
 * `TASKS.md T26`, from the 2026-08-13 UX audit: "the single most
 * safety-relevant feature in the app is reachable from the homepage only
 * via one unexplained text link." Replaces that bare `Link` with a real,
 * explained card — what the timer does, its one honest limit stated
 * plainly (matches the disclaimer's own wording on `/safe-return` itself,
 * never softened for the homepage), and the install nudge that limit
 * actually depends on, right where the honesty box names it.
 *
 * Deliberately NOT the Dive Gradient — that's reserved for the actual
 * "Start Timer" action on `/safe-return` itself (`DESIGN_SYSTEM.md` §2.3,
 * "one per screen, at most"); a second gradient moment here for a card that
 * only navigates would dilute it. Uses the same amber safety-callout
 * language `disclaimer-notice.tsx` already established instead.
 */
export function SafeReturnHomeCard() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 dark:border-amber-400/25 dark:bg-amber-400/5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.2 2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-black dark:text-zinc-50">Safe-Return timer</h2>
          <p className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
            An on-device countdown that alerts you if you miss check-in. It only alerts <em>this device</em> — no
            one else is notified, and it&apos;s less reliable in the background, especially on iPhone.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pl-12">
        <Link
          href="/safe-return"
          className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400"
        >
          Start a timer →
        </Link>
        <PwaInstallNudge />
      </div>
    </div>
  );
}
