"use client";

import { usePwaInstall } from "@/hooks/use-pwa-install";

/**
 * `TASKS.md T26` — renders nothing until the platform is actually known
 * (`"unknown"`, the SSR-safe default) or once the app is already installed,
 * and otherwise shows exactly the one thing that's actually true for the
 * visitor's real platform: a real install button where the browser supports
 * one, or manual instructions where it doesn't (iOS Safari never fires
 * `beforeinstallprompt` — this is a platform limitation, not a missing
 * feature to apologize for). Never a generic "install our app!" banner that
 * might be a dead end on the visitor's actual browser.
 */
export function PwaInstallNudge({ className = "" }: { className?: string }) {
  const { platform, promptInstall } = usePwaInstall();

  if (platform === "unknown" || platform === "installed" || platform === "unsupported") return null;

  if (platform === "ios") {
    return (
      <p className={`text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 ${className}`}>
        On iPhone, reliable check-in alerts need this app added to your Home Screen first: tap the Share icon in
        Safari, then <span className="font-medium text-zinc-700 dark:text-zinc-300">Add to Home Screen</span>.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={promptInstall}
      className={`min-h-[36px] rounded-full border border-sky-600/40 bg-sky-500/10 px-3.5 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-500/20 dark:border-sky-400/40 dark:text-sky-300 ${className}`}
    >
      Add to Home Screen
    </button>
  );
}
