"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `TASKS.md T26` — the 2026-08-13 UX audit's finding: Safe-Return's own
 * disclaimer tells iPhone users reliability depends on adding the app to the
 * Home Screen, but nothing in the app ever explained how, or prompted them
 * to — confirmed by grep at the time: no `beforeinstallprompt` handling, no
 * "Add to Home Screen" copy anywhere in the codebase. This hook is that
 * missing piece.
 *
 * Three real platform behaviors, not one, because "install" isn't one API:
 * - **Chrome/Edge/Android**: fires `beforeinstallprompt`, which this hook
 *   captures at module load (see below) and replays on demand via
 *   `promptInstall()`. The event is only ever dispatched once per page load
 *   and is unusable after `preventDefault()` unless saved — losing the
 *   reference is a real, common bug this hook exists to not have.
 * - **iOS Safari**: never fires `beforeinstallprompt` at all (confirmed
 *   platform limitation, not a bug to work around) — the only install path
 *   is the manual Share-sheet → "Add to Home Screen" flow, so this hook
 *   surfaces `platform: "ios"` and the UI shows instructions instead of a
 *   button.
 * - **Already installed** (`display-mode: standalone`, or iOS Safari's own
 *   legacy `navigator.standalone`): nudging to install something already
 *   installed is exactly the kind of noise CLAUDE.md's Product section
 *   warns against — `platform: "installed"` tells the caller to render
 *   nothing.
 *
 * `useSyncExternalStore`, not a plain effect + `setState` — the same
 * module-cache pattern `explorer-preferences.ts`/`onboarding/preferences.ts`
 * already establish in this codebase, and the right tool here specifically:
 * everything this hook reads (`matchMedia`, `navigator.userAgent`, whether a
 * `beforeinstallprompt` event has arrived) is synchronously-known browser
 * truth, not an async permission request the way `useGeolocation` is —
 * `useSyncExternalStore`'s `getServerSnapshot` gives the SSR-safe `"unknown"`
 * default for free, without a `setState`-in-effect render cascade.
 */

export type PwaInstallPlatform = "unknown" | "installed" | "android-chrome" | "ios" | "unsupported";

export interface UsePwaInstallResult {
  platform: PwaInstallPlatform;
  /** Only meaningful when `platform === "android-chrome"`. Resolves once the user picks accept/dismiss in the native prompt. */
  promptInstall: () => Promise<void>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Pure, exported for unit testing (`use-pwa-install.test.ts`) — real-device
 * user-agent strings as fixtures, not guessed shapes. iPadOS 13+ reports as
 * "Macintosh" in its UA string but is still a touchscreen, so `maxTouchPoints`
 * is the actual disambiguator Apple's own developer docs recommend, not a
 * guess.
 */
export function detectIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const isIosDevice = /iPad|iPhone|iPod/.test(userAgent) || (userAgent.includes("Macintosh") && maxTouchPoints > 1);
  const isSafariEngine = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|Chrome/.test(userAgent);
  return isIosDevice && isSafariEngine;
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

let deferredEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function computePlatform(): PwaInstallPlatform {
  if (isStandaloneDisplayMode()) return "installed";
  if (deferredEvent) return "android-chrome";
  if (typeof navigator !== "undefined" && detectIosSafari(navigator.userAgent, navigator.maxTouchPoints)) return "ios";
  return "unsupported";
}

function getSnapshot(): PwaInstallPlatform {
  return computePlatform();
}

function getServerSnapshot(): PwaInstallPlatform {
  return "unknown";
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

// Registered once at module load, matching `preferences.ts`'s established
// pattern for this kind of module-scope browser listener — not inside
// `subscribe()`, which would attach a duplicate `window` listener per
// mounted consumer.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredEvent = event as BeforeInstallPromptEvent;
    notifyListeners();
  });
}

export function usePwaInstall(): UsePwaInstallResult {
  const platform = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return;
    try {
      await deferredEvent.prompt();
      await deferredEvent.userChoice;
    } finally {
      // A captured prompt event can only be used once — whether the user
      // accepted or dismissed it, drop the reference so the next snapshot
      // read falls back to "unsupported" (not "installed" — we don't
      // actually know the outcome without inspecting `userChoice`, and
      // re-showing a stale button would just retrigger the same one-shot
      // event incorrectly).
      deferredEvent = null;
      notifyListeners();
    }
  }, []);

  return { platform, promptInstall };
}
