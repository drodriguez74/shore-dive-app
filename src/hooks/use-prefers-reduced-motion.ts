"use client";

/**
 * SSR-safe `prefers-reduced-motion` subscription.
 *
 * DESIGN_SYSTEM.md §6 makes respecting this a requirement, not optional
 * polish. The mockups get it for free with a global CSS override, but the
 * recording screen's level meter is driven by inline `scaleY` transforms
 * from real audio state rather than by `@keyframes`, so CSS can't switch it
 * off — the component has to know, and render a static readout instead.
 *
 * Same `useSyncExternalStore` shape as `use-post-dive-prompt-settings.ts`
 * and `use-speech-recognition-support.ts`, for the same two reasons: the
 * server has no `matchMedia` (so a `useState` initializer would produce a
 * hydration mismatch), and an effect-plus-`setState` hydration flag trips
 * `react-hooks/set-state-in-effect` under this repo's React Compiler
 * ruleset.
 *
 * Unlike speech-recognition support, this value genuinely *can* change
 * mid-session — a diver can flip the OS accessibility setting with the tab
 * open — so `subscribe` attaches a real listener rather than a no-op.
 *
 * The server default is `false` (motion allowed). That's the safe direction
 * here: a brief frame of animation before hydration corrects it is a much
 * smaller failure than defaulting to `true` and leaving every user with the
 * degraded meter until hydration lands.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  try {
    const list = window.matchMedia(QUERY);
    list.addEventListener("change", onStoreChange);
    return () => list.removeEventListener("change", onStoreChange);
  } catch {
    // Safari <14 exposes only the deprecated addListener API, and some
    // embedded webviews throw on matchMedia entirely. Neither is worth a
    // crash over — motion simply stays enabled.
    return () => {};
  }
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
