"use client";

/**
 * Whether this browser has already seen the first-run Welcome screen
 * (`creative/mockups/onboarding/01-welcome.html`, `creative/flows/
 * onboarding.md`) — closes the UX audit's #1 root-cause finding (`TASKS.md`
 * `T25`): the app had no pitch anywhere, a cold visitor landed directly on
 * functional UI with zero explanation of what it is or who it's for.
 *
 * Same `useSyncExternalStore` module-cache pattern as
 * `explorer-preferences.ts`/`use-safe-return-timer.ts` — not a `useState` +
 * mount-effect flag. The server has no `localStorage`, so a naive
 * initializer would render "show welcome" on the server and the real
 * persisted value on the client's first paint, the same hydration-mismatch
 * class of bug already documented at length in `use-geolocation.ts`.
 * `getServerSnapshot` returns `false` (never show welcome during SSR/first
 * paint) so the real homepage is what always renders first — the Welcome
 * overlay, if it belongs, appears additively right after hydration, never
 * blocking or replacing the server-rendered tree.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "shore-dive:has-seen-welcome:v1";

function readPersisted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Private browsing / storage disabled: treat as "not seen yet" this
    // session rather than throwing — worst case the welcome screen shows
    // again next visit, not a functional break.
    return false;
  }
}

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  if (cached === null) cached = readPersisted();
  return cached;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function commit(seen: boolean): void {
  cached = seen;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(seen));
    } catch {
      // Storage full/disabled: the flag still applies for this session in
      // memory (React state below still updates), it just won't survive a
      // reload — not worth surfacing to the diver over a first-run screen.
    }
  }
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  // Cross-tab sync, matching explorer-preferences.ts/use-safe-return-timer.ts:
  // marking the welcome screen seen in one tab shouldn't leave another tab
  // still showing it.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cached = readPersisted();
    for (const listener of listeners) listener();
  });
}

export interface UseHasSeenWelcomeResult {
  hasSeenWelcome: boolean;
  /** False until the persisted value is known to reflect the real
   * client-side value — mirrors `useExplorerPreferences`'s `isHydrated`.
   * `WelcomeGate` must wait on this before deciding whether to render the
   * overlay, or a returning diver would see a one-frame flash of it. */
  isHydrated: boolean;
  markWelcomeSeen: () => void;
}

export function useHasSeenWelcome(): UseHasSeenWelcomeResult {
  const hasSeenWelcome = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const markWelcomeSeen = useCallback(() => {
    commit(true);
  }, []);

  return { hasSeenWelcome, isHydrated, markWelcomeSeen };
}
