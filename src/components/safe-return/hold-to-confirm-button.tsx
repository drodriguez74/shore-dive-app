"use client";

/**
 * A confirmation control that requires a deliberate action, not a single
 * passive tap/dismiss — used for check-in (T15.5) so it can't be triggered
 * by an accidental brush against the screen in a pocket or dive bag.
 *
 * Two input paths, both deliberate:
 * - Pointer (mouse/touch): press and hold for `holdMs`, shown as a filling
 *   progress bar. Releasing early cancels — a quick tap does nothing.
 * - Keyboard/assistive tech: a timed hold gesture has no keyboard
 *   equivalent, so Enter/Space use a two-step "press to arm, press again
 *   within a few seconds to confirm" sequence instead. Still two deliberate
 *   actions, just not a timed one.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface HoldToConfirmButtonProps {
  label: string;
  armedLabel?: string;
  holdMs?: number;
  onConfirm: () => void;
  variant?: "safe" | "danger";
  className?: string;
  disabled?: boolean;
}

const DEFAULT_HOLD_MS = 1500;
const KEYBOARD_ARM_WINDOW_MS = 3000;

export function HoldToConfirmButton({
  label,
  armedLabel = "Press again to confirm",
  holdMs = DEFAULT_HOLD_MS,
  onConfirm,
  variant = "safe",
  className = "",
  disabled = false,
}: HoldToConfirmButtonProps) {
  const [progress, setProgress] = useState(0);
  const [armed, setArmed] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const armTimeoutRef = useRef<number | null>(null);

  const cancelHold = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    startedAtRef.current = null;
    setProgress(0);
  }, []);

  // A locally-scoped recursive step function (rather than a `useCallback`
  // referencing itself) — avoids relying on a memoized identity for
  // recursion, which the React Compiler's hooks lint flags as a
  // before-declaration access even though it's safe at call time.
  const beginHold = useCallback(() => {
    if (disabled) return;
    startedAtRef.current = performance.now();

    const step = () => {
      if (startedAtRef.current === null) return;
      const elapsed = performance.now() - startedAtRef.current;
      const pct = Math.min(elapsed / holdMs, 1);
      setProgress(pct);
      if (pct >= 1) {
        cancelHold();
        onConfirm();
        return;
      }
      rafIdRef.current = requestAnimationFrame(step);
    };

    rafIdRef.current = requestAnimationFrame(step);
  }, [disabled, holdMs, onConfirm, cancelHold]);

  const clearArmTimeout = useCallback(() => {
    if (armTimeoutRef.current !== null) {
      window.clearTimeout(armTimeoutRef.current);
      armTimeoutRef.current = null;
    }
  }, []);

  const handleKeyboardActivate = useCallback(() => {
    if (disabled) return;
    if (armed) {
      clearArmTimeout();
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    armTimeoutRef.current = window.setTimeout(() => setArmed(false), KEYBOARD_ARM_WINDOW_MS);
  }, [armed, disabled, onConfirm, clearArmTimeout]);

  useEffect(() => {
    return () => {
      cancelHold();
      clearArmTimeout();
    };
  }, [cancelHold, clearArmTimeout]);

  // Danger uses `rose`, not `red` — see DESIGN_SYSTEM.md §2.2: `rose` is the
  // danger semantic going forward, consistent with expired-view.tsx.
  //
  // Light-mode colors are explicit, not inherited from the dark-mode values —
  // fixed 2026-08-08 after the aesthetic review (and a direct visual check:
  // screenshotted this exact button in forced light mode) found the previous
  // classes (bg-*-950/40 + text-*-100, no light-mode override beyond the
  // border) rendered as low-contrast pale-on-pale in light mode. This is the
  // single most safety-critical control in the app — contrast here isn't
  // cosmetic.
  const colors =
    variant === "danger"
      ? "border-rose-500/60 bg-rose-50 text-rose-900 dark:border-rose-400/50 dark:bg-rose-950/40 dark:text-rose-100"
      : "border-emerald-500/60 bg-emerald-50 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-950/40 dark:text-emerald-100";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={armed}
      className={`relative min-h-[56px] w-full select-none overflow-hidden rounded-2xl border px-6 py-4 text-base font-semibold tracking-tight disabled:cursor-not-allowed disabled:opacity-50 ${colors} ${className}`}
      onPointerDown={(event) => {
        event.preventDefault();
        beginHold();
      }}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleKeyboardActivate();
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Spacebar") {
          event.preventDefault();
          handleKeyboardActivate();
        }
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 bg-white/20"
        style={{
          width: `${progress * 100}%`,
          transition: progress === 0 ? "width 150ms ease-out" : "none",
        }}
      />
      <span className="relative">{armed ? armedLabel : label}</span>
    </button>
  );
}
