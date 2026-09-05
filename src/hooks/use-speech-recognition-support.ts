"use client";

/**
 * SSR-safe reactive view of browser speech-recognition capability.
 *
 * ## Why `useSyncExternalStore` for a value that never changes
 *
 * `src/hooks/use-geolocation.ts` documents the bug this shape exists to
 * avoid, found live via agent-browser: it used to branch on
 * `typeof navigator` in a `useState` initializer, so the server render
 * computed one answer and the client's first paint computed another — two
 * different initial trees for the same render, i.e. a hydration mismatch.
 * Its fix was to start from a neutral value and resolve inside an effect.
 *
 * That fix works, but it isn't the best available one here. Speech-support
 * detection is *synchronously knowable* on the client, and the
 * effect-then-`setState` shape for synchronously-known browser state trips
 * `react-hooks/set-state-in-effect` under this repo's React Compiler
 * ruleset — the same lint error that pushed `use-safe-return-timer.ts`,
 * `use-post-dive-prompt-settings.ts`, and `post-dive-prompt/storage.ts` to
 * `useSyncExternalStore`. So this follows those three rather than
 * `use-geolocation.ts`: `getServerSnapshot` returns the frozen `pending`
 * constant, `getSnapshot` returns the real, module-cached detection, and
 * React reconciles the difference itself with no effect and no mismatch.
 *
 * `subscribe` is a no-op returning a no-op: capability genuinely cannot
 * change within a page's lifetime, so there is nothing to notify. The
 * store exists for its hydration semantics, not its reactivity.
 *
 * ## The snapshot is for copy; the tap re-checks
 *
 * Consumers must not treat this hook's value as the authority on whether
 * recording can start. It drives labels and the settings capability row.
 * Behaviour goes through `readSpeechRecognitionSupport()` at the moment of
 * the tap, which is synchronous and always correct — so a diver on iOS
 * Safari who taps during the single pre-hydration frame still lands on
 * manual entry rather than a recorder that was never going to work.
 */

import { useSyncExternalStore } from "react";
import {
  detectSpeechRecognitionSupport,
  PENDING_SPEECH_RECOGNITION_SUPPORT,
  type SpeechRecognitionSupport,
  type SpeechRecognitionWindowLike,
} from "@/lib/voice-logging/stt-support";

// Cached at module scope so every consumer shares one object identity —
// useSyncExternalStore requires getSnapshot to be Object.is-stable across
// calls or it re-renders in a loop.
let cachedSupport: SpeechRecognitionSupport | null = null;

/**
 * Synchronous, non-React capability read. Use this in event handlers, where
 * being right matters more than being render-safe.
 */
export function readSpeechRecognitionSupport(): SpeechRecognitionSupport {
  if (typeof window === "undefined") return PENDING_SPEECH_RECOGNITION_SUPPORT;
  if (cachedSupport === null) {
    // `SpeechRecognitionWindowLike` is an all-optional ("weak") type, and
    // TypeScript refuses to assign the real `Window` to one when they share
    // no declared properties — which is precisely the case, since
    // lib.dom.d.ts ships `SpeechRecognitionResult`/`ResultList` but not
    // `SpeechRecognition` itself. The cast asserts the structural shape the
    // detector actually probes for; the `typeof === "function"` checks
    // inside it are what make that safe at runtime.
    cachedSupport = detectSpeechRecognitionSupport(window as unknown as SpeechRecognitionWindowLike);
  }
  return cachedSupport;
}

function subscribe(): () => void {
  return () => {};
}

function getServerSnapshot(): SpeechRecognitionSupport {
  return PENDING_SPEECH_RECOGNITION_SUPPORT;
}

/** Reactive capability, safe to read during render on both server and client. */
export function useSpeechRecognitionSupport(): SpeechRecognitionSupport {
  return useSyncExternalStore(subscribe, readSpeechRecognitionSupport, getServerSnapshot);
}
