"use client";

/**
 * Settings toggle for inference-based post-dive prompting (→ TASKS.md T14.3).
 *
 * This is the escape hatch plan.md's Task 14 spec requires: "inference-based
 * triggers are user-tunable/disable-able without losing manual logging."
 * Turning this off must fully silence the *automatic* prompt (see
 * `use-post-dive-prompt-trigger.ts`, which reads this hook and refuses to
 * auto-show regardless of what the trigger signals say) — but it must never
 * block a manual "log conditions now" entry point, which is a separate,
 * always-available action.
 *
 * Persistence follows the same shape as
 * `src/hooks/use-safe-return-timer.ts`'s localStorage-backed external store
 * (module-scope cache + subscriber list read via `useSyncExternalStore`),
 * adapted down to a single boolean instead of a multi-field snapshot. That
 * pattern — not a `useState` + `useEffect` hydration flag — is used
 * deliberately: a plain effect that calls `setState` synchronously on mount
 * to "hydrate" a client-only value trips `react-hooks/set-state-in-effect`
 * and risks a hydration-mismatch flash (server has no localStorage, so a
 * naive initializer would render the default on the server and the real
 * value on the client in the same pass). `useSyncExternalStore` reconciles
 * server/client differences itself, which is exactly this case.
 */

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "shore-dive:post-dive-prompt:auto-enabled:v1";

// Default ON: the trigger this gates (see use-post-dive-prompt-trigger.ts)
// is already conservative by design — it only fires on a real check-in-state
// transition (Safe-Return timer going running -> checked-in, or a dive-plan
// check-in ending), never on bare GPS proximity. So "on by default" doesn't
// violate the zero-noise product philosophy the way a GPS-proximity trigger
// would; this toggle exists as a user-controlled escape hatch (T14.3), not
// because the default behavior is presumed noisy.
const DEFAULT_ENABLED = true;

function readPersisted(): boolean {
  if (typeof window === "undefined") return DEFAULT_ENABLED;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_ENABLED;
    return raw === "true";
  } catch (err) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        scope: "post-dive-prompt",
        event: "settings.storage-read-failed",
        error: String(err),
      }),
    );
    return DEFAULT_ENABLED;
  }
}

let cachedValue: boolean | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): boolean {
  if (cachedValue === null) {
    cachedValue = readPersisted();
  }
  return cachedValue;
}

function getServerSnapshot(): boolean {
  return DEFAULT_ENABLED;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

function commit(next: boolean): void {
  cachedValue = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch (err) {
      // Private browsing / storage-full: the toggle still works in-memory
      // for this session, it just won't survive a reload. Not fatal.
      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          scope: "post-dive-prompt",
          event: "settings.storage-write-failed",
          error: String(err),
        }),
      );
    }
  }
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  // Cross-tab sync, matching use-safe-return-timer.ts's approach: if the
  // toggle changes in another tab, pick it up here instead of showing a
  // stale value.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cachedValue = readPersisted();
    for (const listener of listeners) listener();
  });
}

export interface UsePostDivePromptSettingsResult {
  /** Whether the inference-based (auto) post-dive prompt is allowed to fire. */
  autoPromptEnabled: boolean;
  /** Flip the toggle. Persists immediately. */
  setAutoPromptEnabled: (enabled: boolean) => void;
  /** False until the persisted value is known to reflect the real client-side value (avoids an SSR/client flash). */
  isHydrated: boolean;
}

export function usePostDivePromptSettings(): UsePostDivePromptSettingsResult {
  const autoPromptEnabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const setAutoPromptEnabled = useCallback((enabled: boolean) => {
    commit(enabled);
  }, []);

  return { autoPromptEnabled, setAutoPromptEnabled, isHydrated };
}
